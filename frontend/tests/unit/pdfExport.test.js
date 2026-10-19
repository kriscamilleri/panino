import { describe, it, expect, vi } from 'vitest';
import { buildPdfRequest, requestPdf, normalizePaperSize, pdfFileName } from '@/utils/pdfExport';

const sanitize = (html) => html.replace(/<script.*?<\/script>/g, '');

describe('pdfExport', () => {
    it('sanitizes every HTML fragment and keeps the saved styles', () => {
        const body = buildPdfRequest({
            html: '<p>hi</p><script>x</script>',
            cssStyles: 'p{}',
            printStyles: { pageSize: 'Letter', printHeaderHtml: '<script>y</script><b>h</b>', h1: 'x' },
            sanitize,
        });
        expect(body).toEqual({
            htmlContent: '<p>hi</p>',
            cssStyles: 'p{}',
            printStyles: { pageSize: 'Letter', printHeaderHtml: '<b>h</b>', printFooterHtml: '', h1: 'x' },
        });
    });

    it('overrides the paper size only with A4 or Letter', () => {
        const options = { html: '', cssStyles: '', printStyles: { pageSize: 'Letter' }, sanitize };
        expect(buildPdfRequest({ ...options, pageSize: 'A4' }).printStyles.pageSize).toBe('A4');
        expect(buildPdfRequest({ ...options, pageSize: 'A4; } </style><script>' }).printStyles.pageSize).toBe('A4');
        expect(normalizePaperSize('Letter')).toBe('Letter');
        expect(normalizePaperSize(undefined)).toBe('A4');
    });

    it('posts the body with the token and returns the blob', async () => {
        const blob = { size: 3 };
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
        const result = await requestPdf({ apiUrl: '/api', token: 't', body: { a: 1 }, fetchImpl });
        expect(result).toBe(blob);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/render-pdf');
        expect(options.headers.Authorization).toBe('Bearer t');
        expect(JSON.parse(options.body)).toEqual({ a: 1 });
    });

    it('rejects with the server text on failure', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, text: async () => 'busy' });
        await expect(requestPdf({ apiUrl: '', token: '', body: {}, fetchImpl })).rejects.toThrow('busy');
    });

    it('makes safe file names', () => {
        expect(pdfFileName('Trip: plan/2027?')).toBe('Trip plan 2027.pdf');
        expect(pdfFileName('  ')).toBe('Document.pdf');
    });
});
