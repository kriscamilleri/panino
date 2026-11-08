// Links in PDFs (docs/specs/active/editor-toc-and-internal-links.md §6.3, §6.8, §12):
// heading ids survive the sanitizer, table of contents entries become internal links,
// and links to other Documents become web-app links only when the caller asks.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { applyDocumentVariables, renderDocumentHtml } from '@panino/content-merge/markdown-render';
import { insertToc } from '@panino/content-merge/table-of-contents';
import { cleanupTestUser, createTestApp, getTestToken, setupTestUser } from '../testHelpers.js';
import { TOC_PRINT_CSS, documentAppUrl, renderPdf, sanitizeDocumentHtml } from '../../pdf.js';
import { appBaseUrl, publicUrlWarnings } from '../../publicUrls.js';

const DOC = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c';
const APP = 'https://app.example.test';

/** Every link annotation in a PDF: URIs, and a count of internal destinations. */
async function linkAnnotations(buffer) {
    const pdf = await PDFDocument.load(buffer);
    const uris = [];
    let internal = 0;
    for (const page of pdf.getPages()) {
        const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
        if (!annots) continue;
        for (let i = 0; i < annots.size(); i += 1) {
            const annot = annots.lookup(i, PDFDict);
            if (annot.lookup(PDFName.of('Dest'))) internal += 1;
            const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
            if (!action) continue;
            const uri = action.lookup(PDFName.of('URI'));
            if (uri) uris.push(uri.decodeText());
            else if (String(action.lookup(PDFName.of('S'))) === '/GoTo') internal += 1;
        }
    }
    return { uris, internal };
}

function withEnv(values, fn) {
    const saved = {};
    for (const key of Object.keys(values)) {
        saved[key] = process.env[key];
        if (values[key] === undefined) delete process.env[key];
        else process.env[key] = values[key];
    }
    try {
        return fn();
    } finally {
        for (const key of Object.keys(saved)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

describe('heading ids through the PDF sanitizer', () => {
    it('keeps pn- ids, which DOMPurify would strip unprefixed (the reason for the prefix)', () => {
        const html = renderDocumentHtml('# Images\n\n## Forms');
        const out = sanitizeDocumentHtml(html);
        expect(out).toContain('<h1 id="pn-images">Images</h1>');
        expect(out).toContain('<h2 id="pn-forms">Forms</h2>');
        expect(sanitizeDocumentHtml('<h1 id="images">Images</h1>')).toBe('<h1>Images</h1>');
    });
});

describe('the app-link hook', () => {
    it('sets the web-app href for a valid Document link and strips data-pn-*', () => {
        const out = sanitizeDocumentHtml(`<a class="pn-doc-link" data-pn-doc="${DOC}" data-pn-heading="budget">Plan</a>`, null, { appLinks: APP });
        expect(out).toBe(`<a class="pn-doc-link" href="${APP}/#/doc/${DOC}?heading=budget">Plan</a>`);
    });

    it('replaces a client-supplied href', () => {
        const out = sanitizeDocumentHtml(`<a href="https://evil.example/x" data-pn-doc="${DOC.toUpperCase()}">Plan</a>`, null, { appLinks: APP });
        expect(out).toBe(`<a href="${APP}/#/doc/${DOC}">Plan</a>`);
    });

    it('prints an invalid id or slug as text', () => {
        expect(sanitizeDocumentHtml('<a href="https://evil.example" data-pn-doc="nope">x</a>', null, { appLinks: APP })).toBe('<a>x</a>');
        expect(sanitizeDocumentHtml(`<a data-pn-doc="${DOC}" data-pn-heading="a b">x</a>`, null, { appLinks: APP })).toBe('<a>x</a>');
    });

    it('gives no href without appLinks, and strips data-pn-* everywhere', () => {
        expect(sanitizeDocumentHtml(`<a href="https://evil.example" data-pn-doc="${DOC}">x</a>`)).toBe('<a>x</a>');
        expect(sanitizeDocumentHtml('<a href="#pn-a" data-pn-heading="a">x</a><span data-pn-doc="1">y</span>')).toBe('<a href="#pn-a">x</a><span>y</span>');
    });

    it('builds the address only from validated parts', () => {
        expect(documentAppUrl(APP, DOC, 'été')).toBe(`${APP}/#/doc/${DOC}?heading=%C3%A9t%C3%A9`);
        expect(documentAppUrl(null, DOC, null)).toBeNull();
        expect(documentAppUrl(APP, 'x', null)).toBeNull();
        expect(documentAppUrl('javascript:alert(1)//', DOC, null)).toBeNull();
    });
});

describe('the app origin', () => {
    it('reads FRONTEND_URL, trimmed, and falls back to localhost in development', () => {
        expect(withEnv({ FRONTEND_URL: ' https://panino.sh/ ', NODE_ENV: 'test' }, appBaseUrl)).toBe('https://panino.sh');
        expect(withEnv({ FRONTEND_URL: undefined, NODE_ENV: 'test' }, appBaseUrl)).toBe('http://localhost:5173');
    });

    it('treats a FRONTEND_URL with a query or fragment as unset (it would break every link)', () => {
        expect(withEnv({ FRONTEND_URL: 'https://host/app?x', NODE_ENV: 'production' }, appBaseUrl)).toBeNull();
        expect(withEnv({ FRONTEND_URL: 'https://host/app#y', NODE_ENV: 'production' }, appBaseUrl)).toBeNull();
        expect(withEnv({ FRONTEND_URL: 'https://host/app', NODE_ENV: 'production' }, appBaseUrl)).toBe('https://host/app');
    });

    it('is null in production when unset or not http(s), and warns once at startup', () => {
        expect(withEnv({ FRONTEND_URL: undefined, NODE_ENV: 'production' }, appBaseUrl)).toBeNull();
        expect(withEnv({ FRONTEND_URL: 'javascript:alert(1)', NODE_ENV: 'production' }, appBaseUrl)).toBeNull();
        expect(withEnv({ FRONTEND_URL: 'ftp://panino.sh', NODE_ENV: 'production' }, appBaseUrl)).toBeNull();
        expect(withEnv({ FRONTEND_URL: undefined, NODE_ENV: 'production' }, publicUrlWarnings)).toEqual([
            'FRONTEND_URL is not set; links to other Documents in PDFs print as plain text.',
        ]);
        expect(withEnv({ FRONTEND_URL: 'https://panino.sh', NODE_ENV: 'production' }, publicUrlWarnings)).toEqual([]);
    });
});

describe('the PDF base stylesheet', () => {
    it('hides numbered-table bullets and nested list gaps, and touches nothing else', () => {
        expect(TOC_PRINT_CSS).toContain('.pn-toc-numbered ul { list-style-type: none !important; }');
        expect(TOC_PRINT_CSS).toContain('.pn-toc ul ul { margin-top: 0 !important; margin-bottom: 0 !important; }');
        expect(TOC_PRINT_CSS).toContain('.pn-toc { break-inside: avoid-page; }');
        for (const rule of TOC_PRINT_CSS.split('\n')) expect(rule.trim().startsWith('.pn-toc')).toBe(true);
    });
});

describe('links in rendered PDFs', () => {
    let app;
    let server;
    let user;

    beforeAll(() => {
        ({ app, server } = createTestApp());
    });
    beforeEach(async () => {
        user = await setupTestUser(`pdf-links-${Date.now()}@example.com`, 'password123');
    });
    afterEach(() => cleanupTestUser(user.userId));
    afterAll(() => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())));

    const markdown = insertToc({ value: `# Plan\n\n## Intro\n\n${'Text.\n\n'.repeat(60)}## Budget\n\nSee [the other plan](panino:doc/${DOC}#budget) and [the intro](#intro).\n`, selectionStart: 0, selectionEnd: 0 }).value;
    const pdfHtml = renderDocumentHtml(applyDocumentVariables(markdown), { documentLinks: 'pdf' });

    it('makes table entries internal links and the Document link a FRONTEND_URL address, whatever the request headers say', async () => {
        const saved = process.env.FRONTEND_URL;
        process.env.FRONTEND_URL = APP;
        try {
            const response = await request(app)
                .post('/render-pdf')
                .set('Authorization', `Bearer ${getTestToken(user.userId)}`)
                .set('Host', 'evil.example')
                .set('X-Forwarded-Host', 'evil.example')
                .set('Origin', 'https://evil.example')
                .send({ htmlContent: pdfHtml, cssStyles: '', printStyles: {} })
                .responseType('blob');
            expect(response.status).toBe(200);
            const { uris, internal } = await linkAnnotations(response.body);
            expect(uris).toEqual([`${APP}/#/doc/${DOC}?heading=budget`]);
            // Two table entries and the in-Document link.
            expect(internal).toBeGreaterThanOrEqual(3);
            for (const uri of uris) {
                expect(uri).not.toContain('dbKey');
                expect(uri).not.toContain(user.userId);
                expect(uri).not.toContain('evil.example');
            }
        } finally {
            if (saved === undefined) delete process.env.FRONTEND_URL;
            else process.env.FRONTEND_URL = saved;
        }
    }, 60000);

    it('prints Document links as text when production has no FRONTEND_URL', async () => {
        const savedUrl = process.env.FRONTEND_URL;
        const savedEnv = process.env.NODE_ENV;
        delete process.env.FRONTEND_URL;
        process.env.NODE_ENV = 'production';
        let response;
        try {
            response = await request(app)
                .post('/render-pdf')
                .set('Authorization', `Bearer ${getTestToken(user.userId)}`)
                .send({ htmlContent: pdfHtml, cssStyles: '', printStyles: {} })
                .responseType('blob');
        } finally {
            process.env.NODE_ENV = savedEnv;
            if (savedUrl !== undefined) process.env.FRONTEND_URL = savedUrl;
        }
        expect(response.status).toBe(200);
        expect((await linkAnnotations(response.body)).uris).toEqual([]);
    }, 60000);

    it('gives a caller that does not pass appLinks no URI annotation, even for data-pn-doc', async () => {
        const result = await renderPdf({ htmlContent: `<p><a href="https://evil.example" data-pn-doc="${DOC}">x</a></p>`, cssStyles: '', printStyles: {} }, { userId: user.userId });
        expect(result.ok).toBe(true);
        expect((await linkAnnotations(result.pdf)).uris).toEqual([]);
    }, 60000);
});
