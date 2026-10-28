// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderArticleHtml } from '@/utils/odooArticle';

describe('renderArticleHtml', () => {
    it('renders headings, task lists, tables and links without print styling', () => {
        const html = renderArticleHtml('# Title\n\n- [ ] open\n- [x] done\n\n[Odoo](https://odoo.com)\n\n| a |\n|---|\n| 1 |');
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<ul class="contains-task-list">');
        expect(html).toContain('checked="" disabled="" type="checkbox"> done');
        expect(html).toContain('<a href="https://odoo.com">Odoo</a>');
        expect(html).toContain('<td>1</td>');
        expect(html).not.toContain('style=');
    });

    it('strips scripts and event handlers', () => {
        const html = renderArticleHtml('<script>alert(1)</script><p onclick="x()">Hi</p>\n\n<img src=x onerror=alert(1)>');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('onclick');
        expect(html).not.toContain('onerror');
        expect(html).toContain('<p>Hi</p>');
    });

    it('copes with nothing', () => {
        expect(renderArticleHtml('')).toBe('');
        expect(renderArticleHtml(undefined)).toBe('');
    });
});

describe('renderer parity with the API', () => {
    it('renders the shared fixture exactly as recorded', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { applyDocumentVariables } = await import('@panino/content-merge/markdown-render');
        const fixtures = path.resolve(__dirname, '../../../shared/tests/fixtures');
        const markdown = fs.readFileSync(path.join(fixtures, 'document.md'), 'utf8');
        const expected = fs.readFileSync(path.join(fixtures, 'document.html'), 'utf8');
        const body = applyDocumentVariables(markdown, {
            globals: { Author: 'Kris', customer: 'ignored by front matter' },
            now: new Date('2026-10-28T09:30:00Z'),
            formatDate: () => '2026-10-28',
            formatTime: () => '09:30',
        });
        const { renderDocumentHtml } = await import('@panino/content-merge/markdown-render');
        expect(renderDocumentHtml(body)).toBe(expected);
        // What the Odoo send sheet sends is that HTML, sanitized: nothing the sanitizer drops here.
        expect(renderArticleHtml(body)).toBe(expected);
    });
});
