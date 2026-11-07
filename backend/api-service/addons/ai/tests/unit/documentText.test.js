// Pure text helpers of the Documents area (docs/specs/proposed/ai-api-expansion.md §4.1).
import { describe, expect, it } from 'vitest';
import {
    applyEdit,
    compareNoCase,
    countOccurrences,
    decodeListCursor,
    documentStats,
    encodeListCursor,
    findHeadings,
    headingPlainText,
    insertContent,
    parseHeadings,
    parseSearchTerms,
    referencedImageIds,
    sliceLines,
    slugify,
    termMatches,
    termsIn,
} from '../../documentText.js';
import { encodeDocumentCursor } from '../../keyUtils.js';

const ID_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ID_B = 'ffffffff-1111-4222-8333-444444444444';

describe('documentStats', () => {
    it('counts like the editor status bar', () => {
        expect(documentStats('')).toEqual({ wordCount: 0, characterCount: 0, lineCount: 0 });
        expect(documentStats(null)).toEqual({ wordCount: 0, characterCount: 0, lineCount: 0 });
        expect(documentStats('one two\n three')).toEqual({ wordCount: 3, characterCount: 14, lineCount: 2 });
        expect(documentStats('a\n').lineCount).toBe(2);
    });

    it('slices 1-based inclusive line ranges', () => {
        expect(sliceLines('a\nb\nc\nd', 2, 3)).toBe('b\nc');
        expect(sliceLines('a\nb', 1, 2)).toBe('a\nb');
    });
});

describe('referencedImageIds', () => {
    it('finds every link form getImageUsage counts, once each, lower case', () => {
        const body = [
            `![a](/images/${ID_A})`,
            `![b](/api/images/${ID_B.toUpperCase()}?space=0000)`,
            `<img src="https://panino.sh/api/images/${ID_A}">`,
            '![c](/images/not-a-uuid)',
            '![d](https://example.com/photo.png)',
        ].join('\n');
        expect(referencedImageIds(body)).toEqual([ID_A, ID_B]);
        expect(referencedImageIds('')).toEqual([]);
        expect(referencedImageIds(`/images/${ID_A} /images/${ID_B}`, 1)).toEqual([ID_A]);
    });
});

describe('slugs', () => {
    it.each([
        ['Hello World', 'hello-world'],
        ['Hello  World', 'hello--world'],
        ['Foo & Bar', 'foo--bar'],
        ['C++ code', 'c-code'],
        ['snake_case and-dash', 'snake_case-and-dash'],
        ['Привет мир', 'привет-мир'],
        ['Ünïcödé Heading', 'ünïcödé-heading'],
        ['😄 emoji', '-emoji'],
        ['!!!', 'section'],
        ['', 'section'],
    ])('slugify(%j) is %j (GitHub rules)', (text, slug) => {
        expect(slugify(text)).toBe(slug);
    });

    it('caps a slug at 200 characters', () => {
        expect(slugify('x'.repeat(300))).toHaveLength(200);
    });

    it('strips inline Markdown before slugging', () => {
        expect(headingPlainText('**Bold** and [link](https://x.test/a) `code`')).toBe('Bold and link code');
        expect(headingPlainText('snake_case_name')).toBe('snake_case_name');
        expect(headingPlainText('_emphasis_ and ~~gone~~')).toBe('emphasis and gone');
        expect(headingPlainText('A \\# literal')).toBe('A # literal');
    });

    it('de-duplicates like github-slugger', () => {
        const slugs = parseHeadings('# Intro\n## Intro\n## Intro-1\n## Intro').map((heading) => heading.slug);
        expect(slugs).toEqual(['intro', 'intro-1', 'intro-1-1', 'intro-2']);
    });
});

describe('parseHeadings', () => {
    it('reads ATX headings with levels, closing hashes, lines and section ends', () => {
        const body = '# Title\n\nIntro\n\n## Budget ##\n\nMoney\n\n### Detail\n\nMore\n\n## Plan\n\nSteps';
        expect(parseHeadings(body).map(({ level, text, line, endLine }) => ({ level, text, line, endLine }))).toEqual([
            { level: 1, text: 'Title', line: 1, endLine: 15 },
            { level: 2, text: 'Budget', line: 5, endLine: 12 },
            { level: 3, text: 'Detail', line: 9, endLine: 12 },
            { level: 2, text: 'Plan', line: 13, endLine: 15 },
        ]);
    });

    it('is not fooled by hashtags, indented code, or seven hashes', () => {
        expect(parseHeadings('#hashtag\n    # indented code\n####### seven\n#\n## C#')).toEqual([
            expect.objectContaining({ level: 1, text: '', line: 4 }),
            expect.objectContaining({ level: 2, text: 'C#', line: 5 }),
        ]);
    });

    it('ignores headings in fenced code, HTML comments and front matter', () => {
        const body = [
            '---',
            'title: x',
            '# not a heading',
            '---',
            '# Real',
            '````bash',
            '# install',
            '```',
            '## still code: a shorter run does not close',
            '````',
            '~~~~',
            '# tilde code',
            '~~~',
            '# still tilde code',
            '~~~~',
            '- ```',
            '  # in a list fence',
            '  ```',
            '<!--',
            '# commented',
            '-->',
            '## After',
        ].join('\n');
        expect(parseHeadings(body).map((heading) => [heading.text, heading.line])).toEqual([['Real', 5], ['After', 22]]);
    });

    it('reads setext headings, but not thematic breaks or list continuations', () => {
        const body = 'Main title\n==========\n\nSub\nheading\n---\n\n---\n\n- item\n---\n\nPara\n\n***\nText\n-----';
        const headings = parseHeadings(body);
        expect(headings.map(({ level, text, line, headingEndLine }) => ({ level, text, line, headingEndLine }))).toEqual([
            { level: 1, text: 'Main title', line: 1, headingEndLine: 2 },
            { level: 2, text: 'Sub heading', line: 4, headingEndLine: 6 },
            { level: 2, text: 'Text', line: 16, headingEndLine: 17 },
        ]);
    });

    it('handles CRLF bodies', () => {
        expect(parseHeadings('# One\r\n\r\ntext\r\n## Two\r\n').map((heading) => heading.text)).toEqual(['One', 'Two']);
    });
});

describe('findHeadings', () => {
    const headings = parseHeadings('# Notes\n## Budget 2026\n## **Plan**\n### Plan\n## Budget  2026');

    it('matches text ignoring case, spacing and a leading # marker', () => {
        expect(findHeadings(headings, 'notes').map((h) => h.line)).toEqual([1]);
        expect(findHeadings(headings, '## NOTES').map((h) => h.line)).toEqual([1]);
        expect(findHeadings(headings, 'budget 2026').map((h) => h.line)).toEqual([2, 5]);
        expect(findHeadings(headings, 'budget 2026', 5).map((h) => h.line)).toEqual([5]);
        expect(findHeadings(headings, 'budget 2026', 3)).toEqual([]);
    });

    it('matches the text without inline Markdown, then slugs', () => {
        expect(findHeadings(headings, 'plan').map((h) => h.line)).toEqual([3, 4]);
        expect(findHeadings(headings, '**Plan**').map((h) => h.line)).toEqual([3]);
        expect(findHeadings(headings, 'budget-2026').map((h) => h.line)).toEqual([2]);
        expect(findHeadings(headings, '')).toEqual([]);
        expect(findHeadings(headings, 'missing')).toEqual([]);
    });
});

describe('applyEdit', () => {
    it('replaces exactly one occurrence and reports its line', () => {
        expect(applyEdit('a\nfoo bar\nbaz', 'bar', 'qux')).toEqual({ ok: true, content: 'a\nfoo qux\nbaz', replacements: 1, line: 2 });
    });

    it('refuses no match and several matches, with the count', () => {
        expect(applyEdit('abc', 'x', 'y')).toEqual({ ok: false, reason: 'no_match', matchCount: 0 });
        expect(applyEdit('one one one', 'one', 'two')).toEqual({ ok: false, reason: 'ambiguous', matchCount: 3 });
        expect(countOccurrences('aaaa', 'aa')).toBe(2);
    });

    it('replaces all when asked, deletes with empty text, keeps $ literal', () => {
        expect(applyEdit('one one', 'one', 'two', true)).toMatchObject({ content: 'two two', replacements: 2, line: 1 });
        expect(applyEdit('keep drop keep', ' drop', '')).toMatchObject({ content: 'keep keep' });
        expect(applyEdit('price', 'price', '$& and $1')).toMatchObject({ content: '$& and $1' });
    });

    it('matches LF text in a CRLF body and writes CRLF', () => {
        expect(applyEdit('a\r\nb\r\nc', 'a\nb', 'x\ny')).toMatchObject({ ok: true, content: 'x\r\ny\r\nc' });
    });
});

describe('insertContent', () => {
    const doc = '# Title\n\nIntro\n\n## Budget\n\nMoney\n\n### Detail\n\nMore\n\n## Plan\n\nSteps\n';
    const at = (body, position, text) => {
        const heading = text ? findHeadings(parseHeadings(body), text)[0] : undefined;
        return insertContent(body, 'NEW', position, heading);
    };

    it('inserts at the start, after front matter when there is some', () => {
        expect(at(doc, 'start')).toEqual({ content: `NEW\n\n${doc}`, line: 1 });
        expect(at('---\na: 1\n---\nBody', 'start')).toEqual({ content: '---\na: 1\n---\n\nNEW\n\nBody', line: 5 });
        expect(at('', 'start')).toEqual({ content: 'NEW', line: 1 });
    });

    it('inserts at the end, dropping trailing blank lines but keeping the final newline', () => {
        expect(at(doc, 'end').content).toBe(`${doc.trimEnd()}\n\nNEW\n`);
        expect(at('a\n\n\n', 'end')).toEqual({ content: 'a\n\nNEW\n', line: 3 });
        expect(at('a', 'end').content).toBe('a\n\nNEW');
    });

    it('inserts before and after a heading', () => {
        expect(at(doc, 'before_heading', 'Plan')).toMatchObject({ content: doc.replace('## Plan', 'NEW\n\n## Plan'), line: 13 });
        expect(at(doc, 'after_heading', 'Budget')).toMatchObject({ content: doc.replace('## Budget\n', '## Budget\n\nNEW\n'), line: 7 });
        expect(at('Title\n=====\ntext', 'after_heading', 'Title').content).toBe('Title\n=====\n\nNEW\n\ntext');
    });

    it('inserts at the end of a section, after its subsections, before the next sibling', () => {
        expect(at(doc, 'end_of_section', 'Budget')).toMatchObject({ content: doc.replace('More\n', 'More\n\nNEW\n'), line: 13 });
        expect(at(doc, 'end_of_section', 'Plan').content).toBe(doc.replace('Steps\n', 'Steps\n\nNEW\n'));
        expect(at('## Empty\n## Next', 'end_of_section', 'Empty').content).toBe('## Empty\n\nNEW\n\n## Next');
    });

    it('keeps list items and table rows together', () => {
        const list = '## Todo\n\n- one\n- two\n\n## Done\n';
        const heading = findHeadings(parseHeadings(list), 'Todo')[0];
        expect(insertContent(list, '- three', 'end_of_section', heading).content).toBe('## Todo\n\n- one\n- two\n- three\n\n## Done\n');
        expect(insertContent(list, '- zero', 'after_heading', heading)).toEqual({ content: '## Todo\n\n- zero\n- one\n- two\n\n## Done\n', line: 3 });
        const done = findHeadings(parseHeadings(list), 'Done')[0];
        expect(insertContent(list, '- three', 'before_heading', done).content).toBe('## Todo\n\n- one\n- two\n- three\n\n## Done\n');
        expect(insertContent('| a |\n| - |\n| 1 |', '| 2 |', 'end').content).toBe('| a |\n| - |\n| 1 |\n| 2 |');
    });

    it('trims blank lines around the inserted text and keeps CRLF', () => {
        expect(insertContent('a\r\nb\r\n', '\n\nX\nY\n\n', 'end').content).toBe('a\r\nb\r\n\r\nX\r\nY\r\n');
    });
});

describe('search terms and snippets', () => {
    it('splits words and keeps quoted phrases whole', () => {
        expect(parseSearchTerms('invoice  "due date"  Acme')).toEqual(['invoice', 'due date', 'Acme']);
        expect(parseSearchTerms('"unclosed phrase')).toEqual(['unclosed', 'phrase']);
        expect(parseSearchTerms('Plan plan PLAN')).toEqual(['Plan']);
        expect(parseSearchTerms('""  " "')).toEqual([]);
        expect(parseSearchTerms('"  spaced   out "')).toEqual(['spaced out']);
    });

    it('counts matches and picks up to three snippets, richest lines first, in order', () => {
        const body = 'nothing\nalpha here\nbeta here\nalpha and beta\nalpha again\nalpha alpha';
        const { matchCount, snippets } = termMatches(body, ['alpha', 'beta']);
        expect(matchCount).toBe(7);
        expect(snippets).toEqual([
            { line: 2, text: 'alpha here' },
            { line: 3, text: 'beta here' },
            { line: 4, text: 'alpha and beta' },
        ]);
        expect(termMatches('none', ['x'])).toEqual({ matchCount: 0, snippets: [] });
        expect(termsIn('Weekly Plan', ['plan', 'weekly', 'x'])).toBe(2);
    });

    it('cuts long lines around the first match', () => {
        const line = `${'x '.repeat(200)}needle${' y'.repeat(200)}`;
        const [snippet] = termMatches(line, ['needle']).snippets;
        expect(snippet.text).toContain('needle');
        expect(snippet.text.length).toBeLessThan(170);
    });
});

describe('list cursors', () => {
    const row = { id: 'n-1', updated_at: '2026-11-01T10:00:00.000Z', created_at: '2026-10-01T10:00:00.000Z', title: 'Plan' };

    it('keeps the first release format for the updated sort', () => {
        expect(encodeListCursor('updated', row)).toBe(encodeDocumentCursor(row));
        expect(decodeListCursor(encodeDocumentCursor(row))).toEqual({ sort: 'updated', value: row.updated_at, id: 'n-1' });
    });

    it('carries the sort for created and title', () => {
        expect(decodeListCursor(encodeListCursor('created', row))).toEqual({ sort: 'created', value: row.created_at, id: 'n-1' });
        expect(decodeListCursor(encodeListCursor('title', row))).toEqual({ sort: 'title', value: 'Plan', id: 'n-1' });
    });

    it('refuses anything else', () => {
        expect(decodeListCursor('not base64 json')).toBeNull();
        expect(decodeListCursor(Buffer.from('["other","a","b"]').toString('base64url'))).toBeNull();
        expect(decodeListCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
        expect(decodeListCursor('')).toBeNull();
    });

    it('orders titles the way SQLite NOCASE does', () => {
        expect(compareNoCase('apple', 'BANANA')).toBeLessThan(0);
        expect(compareNoCase('Plan', 'plan')).toBe(0);
        expect(compareNoCase('Zebra', 'Äpfel')).toBeLessThan(0);
    });
});
