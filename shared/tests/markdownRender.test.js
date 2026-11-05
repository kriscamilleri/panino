import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyDocumentVariables, createDocumentRenderer, normalizeVariableName, renderDocumentHtml } from '../markdownRender.js';
import { parseFrontMatter } from '../frontMatter.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const FIXTURE_MARKDOWN = fs.readFileSync(path.join(fixtures, 'document.md'), 'utf8');
export const FIXTURE_HTML = fs.readFileSync(path.join(fixtures, 'document.html'), 'utf8');
/** The variables the fixture's expected HTML was rendered with. */
export const FIXTURE_VARIABLES = {
    globals: { Author: 'Kris', customer: 'ignored by front matter' },
    now: new Date('2026-10-28T09:30:00Z'),
    formatDate: () => '2026-10-28',
    formatTime: () => '09:30',
};

describe('the shared Document renderer', () => {
    it('renders the fixture exactly as recorded', () => {
        expect(renderDocumentHtml(applyDocumentVariables(FIXTURE_MARKDOWN, FIXTURE_VARIABLES))).toBe(FIXTURE_HTML);
    });

    it('fills variables with front matter over globals over built-ins, and leaves unknown ones', () => {
        const md = '---\nName: Ada\n---\n\n{{ name }} {{ NAME }} {{  name  }} {{ GLOBAL_DATE }} {{ global_time }} {{ missing }} {{ }}';
        const out = applyDocumentVariables(md, {
            globals: new Map([['name', 'Grace'], ['global_date', 'never']]),
            now: new Date('2026-01-02T03:04:05Z'),
            formatDate: () => 'D',
            formatTime: () => 'T',
        });
        // The body keeps the blank line that followed the block.
        expect(out).toBe('\nAda Ada Ada never T {{ missing }} {{ }}');
        expect(applyDocumentVariables('', {})).toBe('');
        expect(applyDocumentVariables('plain', {})).toBe('plain');
    });

    it('uses the locale date and time by default', () => {
        const now = new Date('2026-05-06T07:08:09');
        expect(applyDocumentVariables('{{GLOBAL_DATE}}|{{GLOBAL_TIME}}', { now })).toBe(`${now.toLocaleDateString()}|${now.toLocaleTimeString()}`);
    });

    it('normalizes variable names', () => {
        expect(normalizeVariableName('  Customer   Name ')).toBe('customer name');
        expect(normalizeVariableName(undefined)).toBe('');
    });

    it('hands out independent renderers with task lists, linkify and typographer on', () => {
        const a = createDocumentRenderer();
        const b = createDocumentRenderer();
        a.renderer.rules.paragraph_open = () => '<p class="mine">';
        expect(a.render('x')).toBe('<p class="mine">x</p>\n');
        expect(b.render('x')).toBe('<p>x</p>\n');
        expect(b.render('- [x] done')).toContain('class="task-list-item-checkbox" checked=""');
        expect(b.render('see https://a.b')).toContain('<a href="https://a.b">');
        expect(b.render('"q"')).toBe('<p>“q”</p>\n');
    });

    it('reads front matter the way the Preview does', () => {
        expect(parseFrontMatter('---\na: 1\nb: two words\n---\nbody')).toEqual({ metadata: { a: '1', b: 'two words' }, body: 'body' });
        expect(parseFrontMatter('no block')).toEqual({ metadata: {}, body: 'no block' });
    });
});

describe('the shared styled renderer and PDF request', () => {
    it('puts the style map on elements and opens external links in a new tab', async () => {
        const { applyStyleMap } = await import('../styledRenderer.js');
        const md = applyStyleMap(createDocumentRenderer(), { h1: 'color: red', p: 'margin: 0', a: 'color: blue', img: 'width: 50%', table: 'width: 100%' }, {
            rewriteImageSrc: (src) => `${src}?token=x`,
        });
        const html = md.render('# T\n\nHi [in](/doc) [out](https://x.y)\n\n![a](/images/1)\n\n| c |\n|---|\n| 1 |');
        expect(html).toContain('<h1 style="color: red">T</h1>');
        expect(html).toContain('<p style="margin: 0">');
        expect(html).toContain('<a href="/doc" style="color: blue">in</a>');
        expect(html).toContain('<a href="https://x.y" style="color: blue" target="_blank" rel="noopener noreferrer">out</a>');
        expect(html).toContain('<img src="/images/1?token=x" alt="a" style="width: 50%">');
        expect(html).toContain('<table style="width: 100%">');
        // Another renderer stays plain.
        expect(createDocumentRenderer().render('# T')).toBe('<h1>T</h1>\n');
    });

    it('builds the PDF request with sanitized fragments and a normalized paper size', async () => {
        const { buildPdfRequest, normalizePaperSize } = await import('../pdfRequest.js');
        const request = buildPdfRequest({
            html: '<p>x</p>', cssStyles: 'p{}', printStyles: { pageSize: 'Letter', printHeaderHtml: '<b>h</b>' }, sanitize: (s) => s.replace(/<b>/g, ''), pageSize: 'nonsense',
        });
        expect(request).toEqual({ htmlContent: '<p>x</p>', cssStyles: 'p{}', printStyles: { pageSize: 'A4', printHeaderHtml: 'h</b>', printFooterHtml: '' } });
        expect(normalizePaperSize('Letter')).toBe('Letter');
        expect(normalizePaperSize(undefined)).toBe('A4');
    });

    it('resolves a Document’s print style from front matter, then folders, then the default', async () => {
        const { resolveStylePreset, readDocumentStyleNames, assignmentId } = await import('../stylePresets.js');
        const presets = [{ id: 'p1', kind: 'print', name: 'Quote' }, { id: 'p2', kind: 'print', name: 'Memo' }, { id: 'v1', kind: 'preview', name: 'Quote' }];
        const assignments = new Map([[assignmentId('folder', 'f-sub', 'print'), 'p2']]);
        const names = readDocumentStyleNames('---\nprint-style: "Quote"\n---\n\nbody');
        expect(resolveStylePreset({ kind: 'print', documentStyleName: names.print, folderTrail: ['f-sub'], presets, assignments })).toMatchObject({ preset: { id: 'p1' }, source: 'document' });
        expect(resolveStylePreset({ kind: 'print', folderTrail: ['f-sub', 'f-root'], presets, assignments })).toMatchObject({ preset: { id: 'p2' }, source: 'folder', folderId: 'f-sub' });
        expect(resolveStylePreset({ kind: 'print', folderTrail: ['f-root'], presets, assignments })).toEqual({ preset: null, source: 'default' });
    });
});
