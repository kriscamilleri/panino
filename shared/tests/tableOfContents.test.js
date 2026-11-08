import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
    EMPTY_TOC_TEXT,
    applyTocOptions,
    buildTocMarkdown,
    documentOutline,
    findTocs,
    insertToc,
    isTocStale,
    parseTocConfig,
    refreshTocs,
    removeToc,
    tocOptions,
    tocStatus,
} from '../tableOfContents.js';
import { renderDocumentHtml } from '../markdownRender.js';

const state = (value, caret = value.length) => ({ value, selectionStart: caret, selectionEnd: caret });
const NUMBERED = { min: 2, max: 3, numbered: true, title: 'Contents' };
const plain = new MarkdownIt();

/** A built table renders as nested lists only: no <ol>, nothing escaping its parent. */
function expectOnlyNestedBullets(body) {
    const html = plain.render(body);
    expect(html).not.toContain('<ol');
    return html;
}

describe('the marker config', () => {
    it('reads and validates settings', () => {
        expect(parseTocConfig(null)).toEqual({ min: null, max: null, numbered: true, title: 'Contents' });
        expect(parseTocConfig({ v: 1, min: 1, max: 4, numbered: false, title: '' })).toEqual({ min: 1, max: 4, numbered: false, title: '' });
        expect(parseTocConfig({ v: 2 })).toBeNull();
        expect(parseTocConfig({ v: 1, min: 4, max: 2 })).toBeNull();
        expect(parseTocConfig({ v: 1, min: 0 })).toBeNull();
        expect(parseTocConfig({ v: 1, numbered: 'yes' })).toBeNull();
        expect(parseTocConfig({ v: 1, title: 'x'.repeat(81) })).toBeNull();
        expect(parseTocConfig([1])).toBeNull();
        expect(parseTocConfig(undefined)).toBeNull();
    });
});

describe('building the list', () => {
    const doc = '# Plan\n\n## Intro\n\n### Background\n\n## Budget\n\n### Q&A\n';

    it('writes outline numbers by default (§4.2)', () => {
        const body = buildTocMarkdown(documentOutline(doc), NUMBERED);
        expect(body).toBe([
            '**Contents**',
            '',
            '- 1 [Intro](#intro)',
            '  - 1.1 [Background](#background)',
            '- 2 [Budget](#budget)',
            '  - 2.1 [Q&A](#qa)',
            '',
        ].join('\n'));
        expectOnlyNestedBullets(body);
    });

    it('numbers past nine without padding: 10, 1.10, 10.1', () => {
        const lines = ['# T'];
        for (let i = 1; i <= 12; i += 1) {
            lines.push(`## H${i}`);
            if (i === 1) for (let j = 1; j <= 11; j += 1) lines.push(`### S${j}`);
            if (i === 10) lines.push('### Ten one');
        }
        const body = buildTocMarkdown(documentOutline(lines.join('\n\n')), NUMBERED);
        expect(body).toContain('- 10 [H10](#h10)\n  - 10.1 [Ten one](#ten-one)');
        expect(body).toContain('  - 1.10 [S10](#s10)\n  - 1.11 [S11](#s11)');
        expect(body).toContain('- 12 [H12](#h12)');
        const html = expectOnlyNestedBullets(body);
        expect(html.match(/<ul>/g)).toHaveLength(3);
    });

    it('gives six components for six levels', () => {
        const doc6 = ['# a', '## b', '### c', '#### d', '##### e', '###### f'].join('\n\n');
        const body = buildTocMarkdown(documentOutline(doc6), { min: 1, max: 6, numbered: true, title: '' });
        expect(body.split('\n')[5]).toBe('          - 1.1.1.1.1.1 [f](#f)');
        expectOnlyNestedBullets(body);
    });

    it('nests a skipped level one step: H2 → H4 reads 1.1', () => {
        const body = buildTocMarkdown(documentOutline('## A\n\n#### Deep\n\n### Mid\n'), { min: 2, max: 4, numbered: true, title: '' });
        expect(body).toBe('- 1 [A](#a)\n  - 1.1 [Deep](#deep)\n  - 1.2 [Mid](#mid)\n');
    });

    it('gives excluded headings no number', () => {
        const body = buildTocMarkdown(documentOutline('## One\n\n> ## Quoted\n\n## Two <!-- omit from toc -->\n\n## Three\n'), NUMBERED);
        expect(body).toContain('- 1 [One](#one)\n- 2 [Three](#three)');
    });

    it('is unaffected by headings that start with digits', () => {
        const body = buildTocMarkdown(documentOutline('## 2024 plans\n\n### 1. First\n\n## 3) Third\n'), NUMBERED);
        const html = expectOnlyNestedBullets(body);
        expect(html).toContain('<li>1 <a href="#2024-plans">2024 plans</a>');
        expect(html).toContain('<li>2 <a href="#3-third">3) Third</a>');
    });

    it('writes plain bullets with numbered: false, and numbers a bare marker', () => {
        expect(buildTocMarkdown(documentOutline(doc), { ...NUMBERED, numbered: false, title: '' })).toBe(
            '- [Intro](#intro)\n  - [Background](#background)\n- [Budget](#budget)\n  - [Q&A](#qa)\n',
        );
        expect(buildTocMarkdown(documentOutline(doc), parseTocConfig(null))).toContain('- 1 [Intro]');
    });

    it('writes a placeholder without headings, and dedupes slugs', () => {
        expect(buildTocMarkdown([], NUMBERED)).toBe(`**Contents**\n\n${EMPTY_TOC_TEXT}\n`);
        const body = buildTocMarkdown(documentOutline('## Overview\n\n```\n## Not a heading\n```\n\n## Overview\n'), NUMBERED);
        expect(body).toContain('[Overview](#overview)\n- 2 [Overview](#overview-1)');
        expect(body).not.toContain('Not a heading');
    });

    it('adapts the default levels: H2–H3, or H1–H2 with several H1s', () => {
        expect(insertToc(state('# A\n\n## B\n')).value).toContain('{"v":1,"min":2,"max":3}');
        expect(insertToc(state('# A\n\n# B\n')).value).toContain('{"v":1,"min":1,"max":2}');
    });
});

describe('hostile headings (§9)', () => {
    it('can only become text', () => {
        const doc = [
            '## <img src=x onerror=alert(1)>',
            '## [a](javascript:alert(1))',
            '## {{ x }}',
            '## <!-- /panino:toc -->',
            '## **bold** `code` _x_',
        ].join('\n\n');
        const inserted = insertToc(state(doc, 0), { variables: { globals: { x: '<script>alert(1)</script> {{ y }}' } } }).value;
        const [toc] = findTocs(inserted);
        expect(toc.block.closed).toBe(true);
        const html = renderDocumentHtml(inserted.slice(0, toc.block.end));
        expect(html).not.toMatch(/<img|<script|href="javascript|<strong>bold/);
        // An HTML-only heading is listed by its source text, escaped (U16).
        expect(inserted).toContain('[\\<img src=x onerror=alert(1)>](#section)')
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(findTocs(inserted)).toHaveLength(1);
    });

    it('stays linear on a 2 MiB heading', () => {
        const started = Date.now();
        const doc = `## ${'[*_<{{&'.repeat(300000)}\n`;
        const result = insertToc(state(doc));
        expect(isTocStale(result.value)).toBe(false);
        expect(Date.now() - started).toBeLessThan(8000);
    });
});

describe('insert, refresh, options and remove', () => {
    it('inserts after the caret line, after a leading H1, or after front matter', () => {
        const doc = '# Plan\n\nIntro text\n\n## Intro\n';
        const atCaret = insertToc(state(doc, doc.indexOf('Intro text')), { atCaret: true }).value;
        expect(atCaret.startsWith('# Plan\n\nIntro text\n\n<!-- panino:toc')).toBe(true);
        const noCaret = insertToc(state(doc, doc.length)).value;
        expect(noCaret.startsWith('# Plan\n\n<!-- panino:toc {"v":1,"min":2,"max":3} -->\n**Contents**\n\n- 1 [Intro](#intro)\n<!-- /panino:toc -->\n\nIntro text')).toBe(true);
        const front = insertToc(state('---\ntitle: x\n---\n## A\n')).value;
        expect(front.startsWith('---\ntitle: x\n---\n\n<!-- panino:toc')).toBe(true);
        const top = insertToc(state('Text\n\n## A\n')).value;
        expect(top.startsWith('<!-- panino:toc')).toBe(true);
        expect(top).toContain('<!-- /panino:toc -->\n\nText');
    });

    it('never inserts inside a fence', () => {
        const doc = '## A\n\n```\ncode\n```\n';
        const next = insertToc(state(doc, doc.indexOf('code')), { atCaret: true }).value;
        expect(next).toContain('```\ncode\n```\n\n<!-- panino:toc');
    });

    it('refreshes stale tables and leaves text outside byte-identical', () => {
        const start = insertToc(state('# Plan\n\n## Intro\n')).value;
        const edited = `${start}\n## Risks\n\noutside *text*  \n`;
        expect(isTocStale(edited)).toBe(true);
        const { state: next, changed } = refreshTocs(state(edited, edited.length));
        expect(changed).toBe(true);
        expect(next.value).toContain('- 2 [Risks](#risks)');
        const [toc] = findTocs(next.value);
        expect(next.value.slice(toc.block.end)).toBe(edited.slice(findTocs(edited)[0].block.end));
        expect(next.value.slice(0, toc.block.bodyStart)).toBe(edited.slice(0, findTocs(edited)[0].block.bodyStart));
        expect(isTocStale(next.value)).toBe(false);
        // Up to date: nothing to write.
        expect(refreshTocs(next).changed).toBe(false);
    });

    it('renumbers when an earlier heading is inserted', () => {
        const doc = insertToc(state('# T\n\n## B\n\n## C\n')).value;
        const edited = doc.replace('## B', '## A\n\n## B');
        expect(isTocStale(edited)).toBe(true);
        const refreshed = refreshTocs(state(edited)).state.value;
        expect(refreshed).toContain('- 1 [A](#a)\n- 2 [B](#b)\n- 3 [C](#c)');
    });

    it('ignores trailing whitespace and normalizes CRLF only inside the block', () => {
        const doc = insertToc(state('# T\n\n## A\n')).value;
        expect(isTocStale(doc.replace('[A](#a)', '[A](#a)   '))).toBe(false);
        const crlf = doc.replaceAll('\n', '\r\n');
        expect(isTocStale(crlf)).toBe(false);
    });

    it('refreshes every table and refuses damaged ones', () => {
        const doc = '## A\n\n<!-- panino:toc -->\n<!-- /panino:toc -->\n\n<!-- panino:toc {"v":1,"min":2,"max":2,"numbered":false} -->\n<!-- /panino:toc -->\n\n<!-- panino:toc {oops} -->\n<!-- /panino:toc -->\n\n<!-- panino:toc -->\n';
        const status = tocStatus(doc);
        expect(status).toMatchObject({ count: 4, stale: true });
        expect(status.damaged.map((toc) => toc.problem)).toEqual(['damaged', 'unclosed']);
        const result = refreshTocs(state(doc));
        expect(result.damaged).toHaveLength(2);
        expect(result.state.value).toContain('<!-- panino:toc -->\n**Contents**\n\n- 1 [A](#a)\n<!-- /panino:toc -->');
        expect(result.state.value).toContain('"numbered":false} -->\n**Contents**\n\n- [A](#a)\n<!-- /panino:toc -->');
        expect(result.state.value).toContain('<!-- panino:toc {oops} -->\n<!-- /panino:toc -->');
    });

    it('rewrites the marker on Options and refreshes that table', () => {
        const doc = insertToc(state('# T\n\n## A\n\n### B\n\n#### C\n')).value;
        const next = applyTocOptions(state(doc), 0, { min: 1, max: 4, numbered: false, title: '' });
        expect(next.value).toContain('<!-- panino:toc {"v":1,"min":1,"max":4,"numbered":false,"title":""} -->\n- [T](#t)\n  - [A](#a)\n    - [B](#b)\n      - [C](#c)\n<!-- /panino:toc -->');
        expect(tocOptions(next.value)).toEqual({ min: 1, max: 4, numbered: false, title: '' });
        const back = applyTocOptions(next, 0, { min: 2, max: 3, numbered: true, title: 'Contents' });
        expect(back.value).toContain('{"v":1,"min":2,"max":3} -->\n**Contents**\n\n- 1 [A](#a)\n  - 1.1 [B](#b)\n');
        expect(applyTocOptions(state('x'), 0, NUMBERED)).toBeNull();
    });

    it('escapes a title and keeps it out of the outline', () => {
        const doc = insertToc(state('## A\n'), { settings: { title: 'In <b>side</b> *x*' } }).value;
        expect(doc).toContain('"title":"In \\u003cb\\u003eside\\u003c/b\\u003e *x*"');
        expect(doc).toContain('**In \\<b>side\\</b> \\*x\\***');
        expect(documentOutline(doc).map((h) => h.text)).toEqual(['A']);
    });

    it('removes a table with its markers', () => {
        const doc = insertToc(state('# T\n\n## A\n')).value;
        expect(removeToc(state(doc, 0)).value).toBe('# T\n\n## A\n');
        expect(removeToc(state('x'))).toBeNull();
    });
});

describe('rendering a table', () => {
    it('wraps a closed, valid table in a nav and adds the numbered class only when numbered', () => {
        const numbered = renderDocumentHtml(insertToc(state('# T\n\n## A\n')).value);
        expect(numbered).toContain('<nav class="pn-toc pn-toc-numbered" aria-label="Table of contents">\n<p><strong>Contents</strong></p>\n<ul>\n<li>1 <a href="#pn-a" data-pn-heading="a">A</a></li>\n</ul>\n</nav>');
        const bullets = renderDocumentHtml('<!-- panino:toc {"v":1,"min":2,"max":3,"numbered":false} -->\n- [A](#a)\n<!-- /panino:toc -->\n\n## A');
        expect(bullets).toContain('<nav class="pn-toc" aria-label="Table of contents">');
    });

    it('leaves damaged, unclosed and fenced markers as they are', () => {
        expect(renderDocumentHtml('<!-- panino:toc {oops} -->\n- x\n<!-- /panino:toc -->')).not.toContain('<nav');
        expect(renderDocumentHtml('<!-- panino:toc -->\n- x\n')).not.toContain('<nav');
        expect(renderDocumentHtml('```\n<!-- panino:toc -->\n```\n<!-- /panino:toc -->')).not.toContain('<nav');
        expect(renderDocumentHtml('> <!-- panino:toc -->\n> - x\n> <!-- /panino:toc -->')).not.toContain('<nav');
    });

    it('never puts marker JSON into HTML', () => {
        const html = renderDocumentHtml('<!-- panino:toc {"v":1,"title":"\\u003cscript\\u003e"} -->\n- x\n<!-- /panino:toc -->');
        expect(html).toContain('<nav class="pn-toc pn-toc-numbered" aria-label="Table of contents">');
        expect(html).not.toContain('script');
    });

    it('has heading ids that match the table links', () => {
        const html = renderDocumentHtml(insertToc(state('# T\n\n## Été 2026\n\n## Été 2026\n')).value);
        expect(html).toContain('<a href="#pn-été-2026" data-pn-heading="été-2026">');
        expect(html).toContain('<h2 id="pn-été-2026">');
        expect(html).toContain('<h2 id="pn-été-2026-1">');
    });
});
