import { describe, expect, it } from 'vitest';
import {
    escapeInlineText,
    findMarkerBlocks,
    insertMarkerBlock,
    markerJson,
    parseMarkerLine,
    removeMarkerBlock,
    replaceMarkerBlocks,
    safeInsertionOffset,
} from '../markerBlocks.js';
import { renderDocumentHtml } from '../markdownRender.js';

const state = (value, caret = value.length) => ({ value, selectionStart: caret, selectionEnd: caret });

describe('marker lines', () => {
    it('reads opening and closing markers', () => {
        expect(parseMarkerLine('<!-- panino:toc {"v":1} -->')).toEqual({ kind: 'open', name: 'panino:toc', json: '{"v":1}' });
        expect(parseMarkerLine('<!-- panino:toc -->  ')).toEqual({ kind: 'open', name: 'panino:toc', json: null });
        expect(parseMarkerLine('<!-- /panino:toc -->\r')).toEqual({ kind: 'close', name: 'panino:toc', json: null });
        expect(parseMarkerLine('<!-- odoo:sale.order {"v":1} -->').name).toBe('odoo:sale.order');
    });

    it('rejects anything else', () => {
        expect(parseMarkerLine(' <!-- panino:toc -->')).toBeNull();
        expect(parseMarkerLine('<!-- panino:toc --> trailing')).toBeNull();
        expect(parseMarkerLine('<!-- just a comment -->')).toBeNull();
        expect(parseMarkerLine('<!-- pagebreak -->')).toBeNull();
        expect(parseMarkerLine(`<!-- panino:toc ${'x'.repeat(10000)} -->`)).toBeNull();
    });
});

describe('finding blocks', () => {
    const doc = [
        '# Title',
        '<!-- panino:toc {"v":1} -->',
        'one',
        '<!-- /panino:toc -->',
        '```',
        '<!-- panino:toc -->',
        '```',
        '<!-- panino:toc {bad json} -->',
        'two',
        '<!-- /panino:toc -->',
        '<!-- panino:toc -->',
        'unclosed',
    ].join('\n');

    it('finds several, skips fences, flags damaged JSON and unclosed blocks', () => {
        const blocks = findMarkerBlocks(doc, 'panino:toc');
        expect(blocks).toHaveLength(3);
        expect(blocks[0]).toMatchObject({ closed: true, json: { v: 1 } });
        expect(doc.slice(blocks[0].bodyStart, blocks[0].bodyEnd)).toBe('one\n');
        expect(blocks[0].raw).toBe('<!-- panino:toc {"v":1} -->\none\n<!-- /panino:toc -->');
        expect(blocks[1]).toMatchObject({ closed: true, json: undefined });
        expect(blocks[2]).toMatchObject({ closed: false, json: null, raw: '<!-- panino:toc -->' });
    });

    it('ends an unclosed block where the next one starts', () => {
        const blocks = findMarkerBlocks('<!-- panino:toc -->\na\n<!-- panino:toc -->\nb\n<!-- /panino:toc -->', 'panino:toc');
        expect(blocks.map((b) => b.closed)).toEqual([false, true]);
    });

    it('ignores markers in front matter and handles CRLF', () => {
        const blocks = findMarkerBlocks('---\na: 1\n---\r\n<!-- panino:toc -->\r\nx\r\n<!-- /panino:toc -->\r\n', 'panino:toc');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].closed).toBe(true);
        expect(blocks[0].raw.endsWith('-->')).toBe(true);
    });

    it('stays fast on a 2 MiB line and many markers', () => {
        const started = Date.now();
        findMarkerBlocks(`<!--${' '.repeat(2 * 1024 * 1024)}`);
        findMarkerBlocks('<!-- panino:toc -->\n'.repeat(50000), 'panino:toc');
        expect(Date.now() - started).toBeLessThan(3000);
    });
});

describe('inserting, replacing and removing', () => {
    it('inserts after the caret line as its own paragraph', () => {
        const next = insertMarkerBlock(state('a\nb\nc', 1), 'BLOCK');
        expect(next.value).toBe('a\n\nBLOCK\n\nb\nc');
        expect(next.selectionStart).toBe('a\n\nBLOCK'.length);
        expect(insertMarkerBlock(state(''), 'X').value).toBe('X\n');
    });

    it('never inserts inside a fence, front matter or another block', () => {
        const fenced = 'x\n```\ncode\n```\ny';
        expect(insertMarkerBlock(state(fenced, 7), 'B').value).toBe('x\n```\ncode\n```\n\nB\n\ny');
        const front = '---\na: 1\n---\nbody';
        expect(insertMarkerBlock(state(front, 5), 'B').value).toBe('---\na: 1\n---\n\nB\n\nbody');
        const odoo = 'p\n<!-- odoo:sale.order {"v":1} -->\nrow\n<!-- /odoo:sale.order -->\nq';
        expect(safeInsertionOffset(odoo, odoo.indexOf('row'))).toBe(odoo.indexOf('\nq'));
    });

    it('replaces bodies, leaves text outside byte-identical and moves the caret', () => {
        const value = 'before\n<!-- n:a -->\nold\n<!-- /n:a -->\nafter';
        const caret = value.indexOf('after') + 2;
        const result = replaceMarkerBlocks(state(value, caret), 'n:a', () => 'new body\n');
        expect(result.changed).toBe(true);
        expect(result.state.value).toBe('before\n<!-- n:a -->\nnew body\n<!-- /n:a -->\nafter');
        expect(result.state.value.slice(result.state.selectionStart)).toBe('ter');
        const same = replaceMarkerBlocks(result.state, 'n:a', () => 'new body\n');
        expect(same.changed).toBe(false);
    });

    it('never rewrites damaged or unclosed blocks', () => {
        const value = '<!-- n:a {x} -->\nold\n<!-- /n:a -->\n<!-- n:a -->\nopen';
        const result = replaceMarkerBlocks(state(value), 'n:a', () => 'new\n');
        expect(result.changed).toBe(false);
        expect(result.damaged).toHaveLength(2);
    });

    it('removes a block with its markers', () => {
        const value = 'a\n\n<!-- n:a -->\nx\n<!-- /n:a -->\n\nb';
        const [block] = findMarkerBlocks(value, 'n:a');
        expect(removeMarkerBlock(state(value, 0), block).value).toBe('a\n\nb');
    });
});

describe('escaping inline text', () => {
    it('escapes what could take effect', () => {
        expect(escapeInlineText('a*b_c [d] `e` ~f~ |g| <h> \\i')).toBe('a\\*b_c \\[d\\] \\`e\\` \\~f\\~ \\|g\\| \\<h> \\\\i');
        expect(escapeInlineText('_lead and trail_')).toBe('\\_lead and trail\\_');
        expect(escapeInlineText('Q&A &amp; &#123; &x')).toBe('Q&A &amp;amp; &amp;#123; &x');
        expect(escapeInlineText('{{ x }} {y}')).toBe('&#123;{ x }} {y}');
        expect(escapeInlineText('two\nlines')).toBe('two lines');
    });

    it('can only render as text', () => {
        for (const hostile of ['<img src=x onerror=alert(1)>', '[a](javascript:alert(1))', '<!-- /panino:toc -->', '**x**', '![i](x)']) {
            const html = renderDocumentHtml(`[${escapeInlineText(hostile)}](#x)`);
            expect(html).not.toMatch(/<img|<strong|href="javascript|<!--/);
        }
    });

    it('writes marker JSON that cannot close the comment', () => {
        expect(markerJson({ title: '--> <b>' })).toBe('{"title":"--\\u003e \\u003cb\\u003e"}');
    });
});
