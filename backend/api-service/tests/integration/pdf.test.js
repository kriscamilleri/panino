// Integration tests for PDF generation endpoint
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken } from '../testHelpers.js';

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { PDFDocument } from 'pdf-lib';
import { parseInternalImageSource, renderHtmlToPdf, sanitizeDocumentHtml, PDF_RUNTIME } from '../../pdf.js';

async function pageCount(buffer) {
    return (await PDFDocument.load(buffer)).getPageCount();
}

/** A local HTTP server that records every request it receives. */
async function startProbeServer() {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('not really a png');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

describe('sanitizeDocumentHtml', () => {
    it('keeps <style> elements and style attributes but sanitizes their CSS', () => {
        const out = sanitizeDocumentHtml(
            '<style>@page { margin: 3cm } @import url(http://evil.test/x.css); p { background: url(http://evil.test/a.png); color: red }</style>'
            + '<p style="color: blue; background: url(http://evil.test/b.png)">x</p>',
        );
        expect(out).toContain('<style>');
        expect(out).toContain('@page{margin:3cm}');
        expect(out).toContain('p{color:red}');
        expect(out).toContain('style="color:blue"');
        expect(out).not.toContain('evil.test');
        expect(out).not.toContain('@import');
    });

    it('cannot grow a second attribute from a quote in a style value', () => {
        const out = sanitizeDocumentHtml(`<p style='color: red" onload="alert(1)'>x</p>`);
        // The quote is entity-escaped inside the one style attribute; no second attribute.
        expect(out).toMatch(/^<p style="[^"]*">x<\/p>$/);
        expect(out).not.toMatch(/ onload="/);
    });

    it('removes script and event handlers, and keeps a data: image', () => {
        const out = sanitizeDocumentHtml('<img src="data:image/png;base64,AAAA" onerror="alert(1)"><script>alert(1)</script>');
        expect(out).toBe('<img src="data:image/png;base64,AAAA">');
    });
});

describe('qualified PDF image parsing', () => {
    const imageId = '11111111-1111-4111-8111-111111111111';
    const spaceId = '22222222-2222-4222-8222-222222222222';

    it('accepts canonical relative personal and space images after HTML entity encoding', () => {
        expect(parseInternalImageSource(`/images/${imageId}`)).toEqual({ imageId, spaceId: null });
        expect(parseInternalImageSource(
            `/images/${imageId}?space=${spaceId}&amp;token=signed`,
        )).toEqual({ imageId, spaceId });
    });

    it('accepts absolute links only on a configured origin', () => {
        const saved = {
            INTERNAL_API_URL: process.env.INTERNAL_API_URL,
            PUBLIC_API_BASE_URL: process.env.PUBLIC_API_BASE_URL,
            FRONTEND_URL: process.env.FRONTEND_URL,
        };
        try {
            delete process.env.INTERNAL_API_URL;
            delete process.env.PUBLIC_API_BASE_URL;
            delete process.env.FRONTEND_URL;
            expect(parseInternalImageSource(`https://notes.example/api/images/${imageId}`)).toBeNull();

            // Production serves the API under the frontend's own origin.
            process.env.FRONTEND_URL = 'https://notes.example';
            expect(parseInternalImageSource(`https://notes.example/api/images/${imageId}?token=signed`))
                .toEqual({ imageId, spaceId: null });
            expect(parseInternalImageSource(`https://attacker.test/api/images/${imageId}`)).toBeNull();

            process.env.FRONTEND_URL = 'not a url';
            expect(parseInternalImageSource(`https://notes.example/api/images/${imageId}`)).toBeNull();

            process.env.PUBLIC_API_BASE_URL = 'http://localhost:8000';
            expect(parseInternalImageSource(`http://localhost:8000/images/${imageId}`))
                .toEqual({ imageId, spaceId: null });
        } finally {
            for (const [name, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    });

    it('rejects external lookalikes and noncanonical query strings', () => {
        expect(parseInternalImageSource(`https://attacker.test/images/${imageId}`)).toBeNull();
        expect(parseInternalImageSource(`/images/${imageId}?space=${spaceId}&other=1`)).toBeNull();
    });
});

// `poc/` is a proof of concept and is not part of the production image. pdf.js used to read
// `poc/print-defaults.json` two directories up, which always threw ENOENT in production and
// logged a warning on every boot. Guard against it coming back.
describe('print style defaults are self-contained', () => {
    const source = readFileSync(new URL('../../pdf.js', import.meta.url), 'utf8');
    // Assertions run against code with comments stripped: the removal is explained in a
    // comment that necessarily names the old path, and that explanation should not trip the
    // guard it documents.
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('does not reference the poc directory in code', () => {
        expect(code).not.toMatch(/poc/);
    });

    it('defines PRINT_STYLE_DEFAULTS as a literal, not a file read', () => {
        expect(code).toMatch(/const\s+PRINT_STYLE_DEFAULTS\s*=\s*\{/);
        expect(code).not.toMatch(/loadDefaultPrintStyles/);
        expect(code).not.toMatch(/print-defaults\.json/);
    });

    it('derives DEFAULT_PRINT_STYLES from the constant', () => {
        expect(code).toMatch(
            /const\s+DEFAULT_PRINT_STYLES\s*=\s*\{\s*\.\.\.PRINT_STYLE_DEFAULTS\s*\}/,
        );
    });
});

describe('POST /render-pdf', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('pdf-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should generate a PDF from basic HTML and CSS', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Test Document</h1><p>This is a test.</p>',
                cssStyles: 'h1 { color: blue; }',
                printStyles: {}
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000); // Increase timeout for PDF generation

    it('should apply print styles like headers, footers, and margins', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document with Print Styles</h1><p>Content here.</p>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {
                    headerText: 'Test Header',
                    footerText: 'Page {page} of {total}',
                    marginTop: '20mm',
                    marginBottom: '20mm'
                }
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should sanitize and remove script tags from HTML content', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Test</h1><script>alert("XSS")</script><p>Content</p>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        // The PDF should be generated successfully, with script tags removed
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should reject with 401 for unauthenticated requests', async () => {
        const response = await request(app)
            .post('/render-pdf')
            .send({
                htmlContent: '<h1>Test</h1>',
                cssStyles: '',
                printStyles: {}
            });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 400 for requests missing htmlContent', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                cssStyles: '',
                printStyles: {}
            });

        expect(response.status).toBe(400);
    });

    it('should handle concurrent requests gracefully via the queue', async () => {
        const token = getTestToken(testUser.userId);

        const request1 = request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document 1</h1>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        const request2 = request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document 2</h1>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        const [response1, response2] = await Promise.all([request1, request2]);

        expect(response1.status).toBe(200);
        expect(response1.headers['content-type']).toBe('application/pdf');
        expect(response2.status).toBe(200);
        expect(response2.headers['content-type']).toBe('application/pdf');
    }, 60000); // Longer timeout for concurrent requests

    it('lets nothing in a request reach a local server, from any injection point', async () => {
        const probe = await startProbeServer();
        try {
            const token = getTestToken(testUser.userId);
            const response = await request(app)
                .post('/render-pdf')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    htmlContent: [
                        `<style>@import url(${probe.origin}/style-import.css); body { background: url(${probe.origin}/style-bg.png) }</style>`,
                        `<p style="background: url(${probe.origin}/attr-bg.png)">text</p>`,
                        `<img src="${probe.origin}/img.png">`,
                        `<link rel="stylesheet" href="${probe.origin}/link.css">`,
                        `<iframe src="${probe.origin}/frame"></iframe>`,
                        `<script>fetch('${probe.origin}/script')</script>`,
                        `<p style="color: red&quot;&gt;&lt;img src=${probe.origin}/entity.png&gt;">x</p>`,
                    ].join(''),
                    cssStyles: `a { color: red } </style><img src="${probe.origin}/css-breakout.png"><style> b { background: url(${probe.origin}/css-bg.png) } @import url(${probe.origin}/css-import.css);`,
                    printStyles: {
                        pageMargin: `2cm } </style><img src="${probe.origin}/margin.png"><style> @page { margin: 2cm`,
                        headerFontColor: `#666; background: url(${probe.origin}/header-color.png)`,
                        customCSS: `body { background: url(${probe.origin}/custom.png) }`,
                        h1: `color: red; background: url(${probe.origin}/h1.png)`,
                        printHeaderHtml: `<img src="${probe.origin}/header-img.png"> Header`,
                        printFooterHtml: `<span style="background: url(${probe.origin}/footer.png)">%p</span>`,
                        googleFontFamily: `Lora, </style><img src="${probe.origin}/font.png">`,
                    },
                })
                .responseType('blob');

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('application/pdf');
            // Give any stray request a moment to arrive before asserting.
            await new Promise(resolve => setTimeout(resolve, 300));
            expect(probe.requests).toEqual([]);
        } finally {
            await probe.close();
        }
    }, 30000);

    it('contains the renderer itself: raw HTML with script, link, import and img reaches no server', async () => {
        const probe = await startProbeServer();
        try {
            const html = `<!DOCTYPE html><html><head>
                <link rel="stylesheet" href="${probe.origin}/raw-link.css">
                <style>@import url(${probe.origin}/raw-import.css); body { background: url(${probe.origin}/raw-bg.png) }</style>
                <script>fetch('${probe.origin}/raw-script'); new Image().src = '${probe.origin}/raw-image-js';</script>
                </head><body>
                <img src="${probe.origin}/raw-img.png">
                <iframe src="${probe.origin}/raw-frame"></iframe>
                <object data="${probe.origin}/raw-object"></object>
                <video poster="${probe.origin}/raw-poster.png"></video>
                <p>raw</p></body></html>`;
            const pdf = await renderHtmlToPdf(html, {
                pdfOptions: { format: 'A4', printBackground: true },
                headerFooter: { header: () => `<img src="${probe.origin}/raw-header.png">`, footer: () => '<span class="pageNumber"></span>' },
            });
            expect(pdf.length).toBeGreaterThan(0);
            expect(await pageCount(pdf)).toBe(1);
            await new Promise(resolve => setTimeout(resolve, 300));
            expect(probe.requests).toEqual([]);
        } finally {
            await probe.close();
        }
    }, 30000);

    it('still renders data: images', async () => {
        const token = getTestToken(testUser.userId);
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: `<h1>Image</h1><img src="data:image/png;base64,${png}" style="width: 200px">`,
                cssStyles: '',
                printStyles: {},
            })
            .responseType('blob');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
    }, 30000);

    it('honours a <style> block in the Document: @page margins change the page count', async () => {
        const token = getTestToken(testUser.userId);
        const paragraphs = Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i} ${'lorem ipsum dolor sit amet '.repeat(12)}</p>`).join('');
        const render = async (prefix) => {
            const response = await request(app)
                .post('/render-pdf')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    htmlContent: prefix + paragraphs,
                    cssStyles: 'p { margin: 0 0 1rem 0 }',
                    printStyles: { printHeaderHtml: '', printFooterHtml: '' },
                })
                .responseType('blob');
            expect(response.status).toBe(200);
            return pageCount(response.body);
        };
        const plain = await render('');
        const styled = await render('<style>@page { margin: 7cm 6cm } .two-col { columns: 2 }</style>');
        expect(styled).toBeGreaterThan(plain);
    }, 60000);

    it('falls back to defaults for malformed print-style values and still renders', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Defaults</h1>',
                cssStyles: '',
                printStyles: { pageSize: 'A3', headerFontSize: '999', footerAlign: 'justify', headerHeight: 'calc(1cm)', pageMargin: 'auto' },
            })
            .responseType('blob');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
    }, 30000);

    it('refuses an oversized stylesheet with 413 before parsing it', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({ htmlContent: '<p>x</p>', cssStyles: 'p{col or: x}'.repeat(40000), printStyles: {} });
        expect(response.status).toBe(413);
        expect(response.text).toBe('CSS too large');
    });

    it('times out a slow real render and serves the next request', async () => {
        const saved = PDF_RUNTIME.jobTimeoutMs;
        const token = getTestToken(testUser.userId);
        const heavy = Array.from({ length: 1500 }, (_, i) => `<p style="break-after: page">Page ${i}</p>`).join('');
        try {
            PDF_RUNTIME.jobTimeoutMs = 300;
            const slow = await request(app)
                .post('/render-pdf')
                .set('Authorization', `Bearer ${token}`)
                .send({ htmlContent: heavy, cssStyles: '', printStyles: {} });
            expect(slow.status).toBe(504);
            expect(slow.text).toBe('PDF generation timed out');
        } finally {
            PDF_RUNTIME.jobTimeoutMs = saved;
        }
        const next = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({ htmlContent: '<h1>After timeout</h1>', cssStyles: '', printStyles: {} })
            .responseType('blob');
        expect(next.status).toBe(200);
        expect(next.headers['content-type']).toBe('application/pdf');
    }, 60000);
});
