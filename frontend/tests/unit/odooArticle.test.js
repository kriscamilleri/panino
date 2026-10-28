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
