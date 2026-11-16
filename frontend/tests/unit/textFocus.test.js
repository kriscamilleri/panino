import { describe, expect, it } from 'vitest';
import {
    BLOCK_LINE_LIMIT,
    SENTENCE_WINDOW,
    analyzeText,
    findBlock,
    findSentence,
    focusRange,
    lineIndexAt,
    lineStarts,
    maskForSegmentation,
    regexSentenceSegments,
} from '@/utils/textFocus';

/** The text of the region holding the offset of `marker`'s first character. */
function blockAt(text, marker, delta = 0) {
    const offset = text.indexOf(marker) + delta;
    const block = findBlock(text, offset);
    return { ...block, text: text.slice(block.start, block.end) };
}

function sentenceAt(text, offset, options = {}) {
    const block = findBlock(text, offset);
    const sentence = findSentence(text, offset, block, options);
    return text.slice(sentence.start, sentence.end);
}

describe('lineStarts / lineIndexAt', () => {
    it('indexes every line start', () => {
        expect(lineStarts('')).toEqual([0]);
        expect(lineStarts('a\nbc\n')).toEqual([0, 2, 5]);
    });

    it('finds the line at the boundaries', () => {
        const starts = lineStarts('ab\ncd\nef');
        expect(lineIndexAt(starts, 0)).toBe(0);
        expect(lineIndexAt(starts, 2)).toBe(0); // on the \n itself
        expect(lineIndexAt(starts, 3)).toBe(1); // just after the \n
        expect(lineIndexAt(starts, 8)).toBe(2); // the end
    });
});

describe('analyzeText', () => {
    it('finds front matter and fences, including an unclosed fence', () => {
        const text = '---\ntitle: x\n---\n```js\ncode\n```\n~~~\nopen';
        const index = analyzeText(text);
        expect(index.frontMatterEnd).toBe(2);
        expect(index.fences).toEqual([{ open: 3, close: 5 }, { open: 6, close: -1 }]);
    });

    it('does not take a lone leading --- as front matter', () => {
        expect(analyzeText('---\nno close').frontMatterEnd).toBe(-1);
    });

    it('closes a fence only with the same character and enough length', () => {
        const index = analyzeText('````\n```\n~~~~\n````');
        expect(index.fences).toEqual([{ open: 0, close: 3 }]);
    });
});

describe('findBlock (§7.2)', () => {
    const doc = [
        '---',
        'title: Doc',
        '---',
        '# Heading',
        'Para one line one',
        'para one line two',
        '',
        'Setext title',
        '===',
        '',
        '- item one',
        '  continued',
        '  - nested',
        '- item two',
        '',
        '> quote a',
        '> quote b',
        '>',
        '> quote c',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '***',
        '\\pagebreak',
        '```',
        'code a',
        'code b',
        '',
        'code c',
        '```',
        'tail',
    ].join('\n');

    it('takes the whole front matter', () => {
        expect(blockAt(doc, 'title: Doc')).toMatchObject({ kind: 'frontmatter', text: '---\ntitle: Doc\n---' });
    });

    it('takes only the ATX heading line, even with no blank line after it', () => {
        expect(blockAt(doc, '# Heading')).toMatchObject({ kind: 'heading', text: '# Heading' });
    });

    it('takes a paragraph as its run of non-blank lines', () => {
        expect(blockAt(doc, 'para one line two').text).toBe('Para one line one\npara one line two');
        expect(blockAt(doc, 'Para one').kind).toBe('paragraph');
    });

    it('takes a setext heading with its underline, from either line', () => {
        expect(blockAt(doc, 'Setext')).toMatchObject({ kind: 'heading', text: 'Setext title\n===' });
        expect(blockAt(doc, '===')).toMatchObject({ kind: 'heading', text: 'Setext title\n===' });
        expect(blockAt('Title\n---\nnext', 'Title')).toMatchObject({ kind: 'heading', text: 'Title\n---' });
    });

    it('takes a list item with its continuation and deeper items', () => {
        expect(blockAt(doc, 'item one')).toMatchObject({ kind: 'list', text: '- item one\n  continued\n  - nested' });
        expect(blockAt(doc, 'continued').text).toBe('- item one\n  continued\n  - nested');
        expect(blockAt(doc, 'nested').text).toBe('  - nested');
        expect(blockAt(doc, 'item two').text).toBe('- item two');
    });

    it('handles ordered and task items', () => {
        const text = '1. one\n2) two\n   more\n- [ ] task\n- [x] done';
        expect(blockAt(text, 'two').text).toBe('2) two\n   more');
        expect(blockAt(text, 'task').text).toBe('- [ ] task');
    });

    it('splits a blockquote at a bare > line, which is an empty focus', () => {
        expect(blockAt(doc, 'quote b')).toMatchObject({ kind: 'blockquote', text: '> quote a\n> quote b' });
        expect(blockAt(doc, 'quote c').text).toBe('> quote c');
        const bare = doc.indexOf('>\n> quote c');
        const block = findBlock(doc, bare);
        expect(block.start).toBe(block.end);
    });

    it('takes all the lines of a table', () => {
        expect(blockAt(doc, '| 1 |')).toMatchObject({ kind: 'table', text: '| a | b |\n|---|---|\n| 1 | 2 |' });
    });

    it('takes a thematic break and \\pagebreak as single lines', () => {
        expect(blockAt(doc, '***')).toMatchObject({ kind: 'break', text: '***' });
        expect(blockAt(doc, '\\pagebreak')).toMatchObject({ kind: 'break', text: '\\pagebreak' });
    });

    it('takes runs of non-blank lines inside a fence, with the fence line next to them', () => {
        expect(blockAt(doc, 'code a')).toMatchObject({ kind: 'code', text: '```\ncode a\ncode b' });
        expect(blockAt(doc, 'code c').text).toBe('code c\n```');
        // The fence lines themselves join the run next to them.
        expect(findBlock(doc, doc.indexOf('```\ncode a'))).toMatchObject({ kind: 'code' });
        const blankInFence = doc.indexOf('code b') + 'code b\n'.length;
        const block = findBlock(doc, blankInFence);
        expect(block.start).toBe(block.end);
    });

    it('does not light up a long code block all at once', () => {
        const lines = Array.from({ length: 200 }, (_, i) => (i === 100 ? '' : `line ${i}`));
        const text = ['```', ...lines, '```'].join('\n');
        expect(blockAt(text, 'line 150').text.split('\n')).toHaveLength(99 + 1); // lines 101–199 plus the closing fence
    });

    it('gives an empty focus at the caret on a blank line', () => {
        const offset = doc.indexOf('\n\nSetext') + 1;
        const block = findBlock(doc, offset);
        expect(block).toMatchObject({ start: offset, end: offset });
    });

    it('treats the end of the text and an empty text sensibly', () => {
        expect(blockAt(doc, 'tail').text).toBe('tail');
        expect(findBlock(doc, doc.length).end).toBe(doc.length);
        expect(findBlock('', 0)).toMatchObject({ start: 0, end: 0 });
    });

    it('stops a paragraph at a following block', () => {
        const text = 'para\n# head\n- item\n> q';
        expect(blockAt(text, 'para').text).toBe('para');
        expect(blockAt('para\n- item', 'para').text).toBe('para');
    });

    it(`cuts a block off ${BLOCK_LINE_LIMIT} lines from the caret`, () => {
        const text = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n');
        const offset = text.indexOf('line 750');
        const block = findBlock(text, offset);
        expect(block.startLine).toBe(750 - BLOCK_LINE_LIMIT);
        expect(block.endLine).toBe(750 + BLOCK_LINE_LIMIT);
    });

    it('accepts a prebuilt index', () => {
        const index = analyzeText(doc);
        expect(findBlock(doc, doc.indexOf('tail'), index)).toEqual(findBlock(doc, doc.indexOf('tail')));
    });
});

describe('findSentence (§7.3)', () => {
    const para = 'First sentence here. Second one is\nwrapped across lines! Third?';

    it('finds each of several sentences, also across a hard wrap', () => {
        expect(sentenceAt(para, 3)).toBe('First sentence here.');
        expect(sentenceAt(para, para.indexOf('wrapped'))).toBe('Second one is\nwrapped across lines!');
        expect(sentenceAt(para, para.length - 2)).toBe('Third?');
    });

    it('keeps the sentence when the caret sits just after its terminator', () => {
        expect(sentenceAt(para, para.indexOf('. Second') + 1)).toBe('First sentence here.');
    });

    it('gives an empty focus after a finished sentence and a space at the end of the block', () => {
        const text = 'One sentence. ';
        const block = findBlock(text, text.length);
        expect(findSentence(text, text.length, block)).toEqual({ start: text.length, end: text.length });
    });

    it('stays on the sentence at the end of an unfinished one', () => {
        const text = 'Writing still ';
        expect(sentenceAt(text, text.length)).toBe('Writing still');
    });

    it('does not split "e.g. the" but does split "Dr. Smith" (pinned ICU behaviour)', () => {
        expect(sentenceAt('Use e.g. the thing. Next.', 10)).toBe('Use e.g. the thing.');
        expect(sentenceAt('Ask Dr. Smith today. Then go.', 1)).toBe('Ask Dr.');
    });

    it('does not end a sentence at dots in inline code, URLs in links or file names', () => {
        const text = 'Open `config.yml` and [the docs](https://example.com/a.md) first. Then run.';
        expect(sentenceAt(text, 2)).toBe('Open `config.yml` and [the docs](https://example.com/a.md) first.');
    });

    it('keeps closing quotes and brackets with the sentence', () => {
        expect(sentenceAt('He said "Stop." Then left.', 3)).toBe('He said "Stop."');
        expect(sentenceAt('See (this.) And that.', 2)).toBe('See (this.)');
    });

    it('splits CJK sentences at 。', () => {
        const text = '第一句。第二句。';
        expect(sentenceAt(text, 5)).toBe('第二句。');
    });

    it('treats headings, table rows and code lines as one unit each', () => {
        expect(sentenceAt('# Title. With dots. Here', 3)).toBe('# Title. With dots. Here');
        const table = '| a. b | c |\n|---|---|\n| d. e | f |';
        expect(sentenceAt(table, table.indexOf('d.'))).toBe('| d. e | f |');
        const code = '```\nx = 1. y = 2.\nz\n```';
        expect(sentenceAt(code, code.indexOf('y'))).toBe('x = 1. y = 2.');
    });

    it('keeps list markers out of the way and keeps items apart', () => {
        const text = '- First item. More here\n- Second item';
        expect(sentenceAt(text, text.indexOf('More'))).toBe('More here');
        expect(sentenceAt(text, 3)).toBe('- First item.');
        expect(sentenceAt('- a\n  - b', 1)).toBe('- a');
    });

    it('works inside blockquotes that wrap', () => {
        const text = '> One here. Two\n> continues.';
        expect(sentenceAt(text, text.indexOf('continues'))).toBe('Two\n> continues.');
    });

    it(`looks only ${SENTENCE_WINDOW} characters either side of the caret`, () => {
        const text = 'a'.repeat(50000);
        const offset = 25000;
        const block = findBlock(text, offset);
        const sentence = findSentence(text, offset, block);
        expect(sentence.start).toBe(offset - SENTENCE_WINDOW);
        expect(sentence.end).toBe(offset + SENTENCE_WINDOW);
    });

    it('falls back to the regex when Intl.Segmenter is missing', () => {
        const options = { segmenter: null };
        expect(sentenceAt(para, 3, options)).toBe('First sentence here.');
        expect(sentenceAt(para, para.indexOf('wrapped'), options)).toBe('Second one is\nwrapped across lines!');
        expect(sentenceAt('第一句。第二句。', 5, options)).toBe('第二句。');
    });

    it('returns an empty region for an empty block', () => {
        expect(findSentence('a\n\nb', 2, findBlock('a\n\nb', 2))).toEqual({ start: 2, end: 2 });
    });
});

describe('maskForSegmentation and regexSentenceSegments', () => {
    it('keeps every offset in place', () => {
        const text = '> - [ ] item `a.b` [x](y.md)\nnext';
        const masked = maskForSegmentation(text, 0, text.length);
        expect(masked).toHaveLength(text.length);
        expect(masked.startsWith('        item')).toBe(true);
        expect(masked).toContain('xxxxx');
        expect(masked).not.toContain('\n');
        expect(masked).not.toContain('y.md');
    });

    it('segments after terminators followed by whitespace', () => {
        expect(regexSentenceSegments('A. B! C')).toEqual([[0, 3], [3, 6], [6, 7]]);
        expect(regexSentenceSegments('no terminator')).toEqual([[0, 13]]);
        expect(regexSentenceSegments('')).toEqual([[0, 0]]);
    });
});

describe('focusRange', () => {
    const text = 'Para one. Two.\n\nPara two here.\n\nPara three.';

    it('is null when dimming is off', () => {
        expect(focusRange(text, { start: 0, end: 0 }, 'off')).toBeNull();
    });

    it('gives the block or the sentence at a collapsed caret', () => {
        expect(focusRange(text, { start: 2, end: 2 }, 'paragraph')).toEqual({ start: 0, end: 14, empty: false });
        expect(focusRange(text, { start: 11, end: 11 }, 'sentence')).toEqual({ start: 10, end: 14, empty: false });
    });

    it('reports an empty focus on a blank line', () => {
        expect(focusRange(text, { start: 15, end: 15 }, 'paragraph')).toMatchObject({ start: 15, end: 15, empty: true });
    });

    it('takes the union of the regions at both ends of a selection that spans blocks', () => {
        const start = 3;
        const end = text.indexOf('two here') + 2;
        expect(focusRange(text, { start, end }, 'paragraph')).toEqual({ start: 0, end: text.indexOf('\n\nPara three'), empty: false });
        expect(focusRange(text, { start: end, end: start }, 'paragraph').start).toBe(0); // reversed selection
    });

    it('ends a triple-click selection on the line it selected', () => {
        const lineEnd = text.indexOf('\n') + 1;
        expect(focusRange(text, { start: 0, end: lineEnd }, 'paragraph')).toEqual({ start: 0, end: 14, empty: false });
    });

    it('clamps offsets outside the text', () => {
        expect(focusRange('abc', { start: -5, end: 99 }, 'paragraph')).toEqual({ start: 0, end: 3, empty: false });
    });
});

describe('tables in linear time', () => {
    it('handles a long run of `|` lines with no delimiter row without scanning each line\'s neighbours', () => {
        // A pasted log or CSV: before the fix every paragraph-scan step rescanned up to 1000 lines.
        const pipes = Array.from({ length: 3000 }, (_, i) => `col ${i} | value ${i}`).join('\n');
        const text = `${pipes}\n\nplain paragraph line\nanother line`;
        const index = analyzeText(text);
        const started = performance.now();
        for (let i = 0; i < 20; i += 1) {
            focusRange(text, { start: text.length - 3, end: text.length - 3 }, 'paragraph', { index });
            focusRange(text, { start: 40000, end: 40000 }, 'paragraph', { index });
        }
        expect(performance.now() - started).toBeLessThan(200);
        // Without a delimiter row the `|` lines are a plain paragraph, not a table.
        expect(findBlock(text, 40000).kind).toBe('paragraph');
    });

    it('still finds a table whose delimiter row is far from the caret line', () => {
        const rows = Array.from({ length: 300 }, (_, i) => `| ${i} | x |`);
        const text = ['| a | b |', '|---|---|', ...rows].join('\n');
        const at = text.length - 2;
        const block = findBlock(text, at);
        expect(block.kind).toBe('table');
        expect(block.start).toBe(0);
    });
});
