// Queue, deadline and error-message behaviour of POST /render-pdf, with Puppeteer mocked
// so the browser can be made to fail or hang deterministically.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

const browserState = {
    behaviour: 'ok',
    closedContexts: 0,
};

vi.mock('puppeteer', () => {
    // A minimal valid PDF so countPdfPages can parse it if a test enables headers.
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>');
    function makeContext() {
        let onClose = null;
        const context = {
            async newPage() {
                return {
                    async setJavaScriptEnabled() {},
                    async setRequestInterception() {},
                    on() {},
                    async emulateMediaType() {},
                    async setContent() {},
                    pdf() {
                        if (browserState.behaviour === 'throw') return Promise.reject(new Error('internal chromium detail: /secret/path'));
                        if (browserState.behaviour === 'hang') {
                            return new Promise((_, reject) => { onClose = () => reject(new Error('Target closed')); });
                        }
                        return Promise.resolve(new Uint8Array(PDF));
                    },
                };
            },
            async close() {
                browserState.closedContexts += 1;
                if (onClose) onClose();
            },
        };
        return context;
    }
    return {
        default: {
            async launch() {
                return { connected: true, createBrowserContext: async () => makeContext(), close: async () => {} };
            },
        },
    };
});

const { createTestApp, setupTestUser, cleanupTestUser, getTestToken } = await import('../testHelpers.js');
const { PDF_RUNTIME } = await import('../../pdf.js');

const body = {
    htmlContent: '<h1>Queue</h1>',
    cssStyles: 'h1 { color: red }',
    printStyles: { printHeaderHtml: '', printFooterHtml: '' },
};

describe('POST /render-pdf queue and deadline', () => {
    let app, server, testUser, token;
    const saved = { ...PDF_RUNTIME };

    beforeAll(() => {
        ({ app, server } = createTestApp());
    });

    beforeEach(async () => {
        testUser = await setupTestUser('pdf-queue@example.com', 'password123');
        token = getTestToken(testUser.userId);
        browserState.behaviour = 'ok';
        browserState.closedContexts = 0;
    });

    afterEach(() => {
        Object.assign(PDF_RUNTIME, saved);
        if (testUser) cleanupTestUser(testUser.userId);
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    const send = () => request(app).post('/render-pdf').set('Authorization', `Bearer ${token}`).send(body);

    it('returns a PDF with the mocked browser', async () => {
        const response = await send().responseType('blob');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
    });

    it('answers a renderer failure with the fixed message and no detail', async () => {
        browserState.behaviour = 'throw';
        const response = await send();
        expect(response.status).toBe(500);
        expect(response.text).toBe('PDF generation failed');
        expect(response.text).not.toContain('chromium');
        expect(response.text).not.toContain('/secret/path');
    });

    it('times out a hanging job, closes its context, and serves the next job', async () => {
        PDF_RUNTIME.jobTimeoutMs = 200;
        browserState.behaviour = 'hang';
        const started = Date.now();
        const timedOut = await send();
        expect(timedOut.status).toBe(504);
        expect(timedOut.text).toBe('PDF generation timed out');
        expect(Date.now() - started).toBeLessThan(5000);
        expect(browserState.closedContexts).toBeGreaterThanOrEqual(1);

        browserState.behaviour = 'ok';
        const next = await send().responseType('blob');
        expect(next.status).toBe(200);
        expect(next.headers['content-type']).toBe('application/pdf');
    });

    it('rejects requests beyond the queue limit with 503 and Retry-After', async () => {
        PDF_RUNTIME.queueLimit = 1;
        browserState.behaviour = 'hang';
        PDF_RUNTIME.jobTimeoutMs = 400;

        // First request is processed, second waits in the queue, third is refused.
        // supertest requests are lazy: `.then` is what sends them.
        const first = send().then(r => r);
        await new Promise(resolve => setTimeout(resolve, 50));
        const second = send().then(r => r);
        await new Promise(resolve => setTimeout(resolve, 50));
        const third = await send();
        expect(third.status).toBe(503);
        expect(third.headers['retry-after']).toBe(String(PDF_RUNTIME.retryAfterSeconds));
        expect(third.text).toBe('PDF service busy, try again shortly');

        browserState.behaviour = 'ok';
        const [r1, r2] = await Promise.all([first, second]);
        expect(r1.status).toBe(504);
        expect(r2.status).toBe(200);
    });
});
