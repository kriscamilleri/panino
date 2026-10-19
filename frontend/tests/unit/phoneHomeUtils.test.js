import { describe, it, expect } from 'vitest';
import { toSnippetLines, toSummary, stripInline, buildCaptureDocument } from '@/utils/markdownSnippet';
import { buildHomeSections, splitIntoColumns, normalizeHomeFilter, isInboxDocument } from '@/utils/homeView';

describe('stripInline', () => {
    it('keeps only readable text', () => {
        expect(stripInline('**Bold** and _it_ with `code`, [a link](http://x) ![img](y.png) <b>tag</b> ~~gone~~'))
            .toBe('Bold and it with code, a link tag gone');
        expect(stripInline('snake_case_name stays')).toBe('snake_case_name stays');
        expect(stripInline('Hi {{ author }}')).toBe('Hi author');
    });
});

describe('toSnippetLines', () => {
    it('drops the generated title heading and markdown syntax', () => {
        const lines = toSnippetLines('# First Document\n\n# 30-09-26\n\nSome **bold** text.', { title: 'First Document' });
        expect(lines).toEqual([
            { kind: 'text', text: '30-09-26' },
            { kind: 'text', text: 'Some bold text.' },
        ]);
    });

    it('keeps checklist state and bullets', () => {
        expect(toSnippetLines('- [x] Passport\n- [ ] Rail *pass*\n* item\n1. first')).toEqual([
            { kind: 'task', text: 'Passport', checked: true },
            { kind: 'task', text: 'Rail pass', checked: false },
            { kind: 'bullet', text: 'item' },
            { kind: 'bullet', text: 'first' },
        ]);
    });

    it('skips fences, front matter, images, rules and page breaks', () => {
        const source = '---\ntitle: x\n---\n```js\nconst a = 1;\n```\n![pic](a.png)\n***\n\\pagebreak\n> quoted line\n| a | b |\n|---|---|\n| 1 | 2 |';
        expect(toSnippetLines(source).map((line) => line.text)).toEqual(['quoted line', 'a · b', '1 · 2']);
    });

    it('stops at the line limit and never returns raw markers', () => {
        const source = Array.from({ length: 20 }, (_, i) => `## Heading ${i}`).join('\n');
        const lines = toSnippetLines(source, { maxLines: 8 });
        expect(lines).toHaveLength(8);
        expect(lines.every((line) => !line.text.includes('#'))).toBe(true);
    });
});

describe('toSummary', () => {
    it('joins lines on one row and truncates with an ellipsis', () => {
        expect(toSummary('# T\n\nOne\n- [x] done', { title: 'T' })).toBe('One · ☑ done');
        const long = toSummary('word '.repeat(100), { maxLength: 20 });
        expect(long.length).toBeLessThanOrEqual(20);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('buildCaptureDocument', () => {
    it('uses a typed title as the heading', () => {
        expect(buildCaptureDocument({ title: 'Idea', body: 'Call Sam' }))
            .toEqual({ title: 'Idea', content: '# Idea\n\nCall Sam\n' });
    });

    it('derives the title from the first line without markdown', () => {
        expect(buildCaptureDocument({ body: '- [ ] **Buy** milk\n- [ ] eggs' }))
            .toEqual({ title: 'Buy milk', content: '- [ ] **Buy** milk\n- [ ] eggs\n' });
        const long = buildCaptureDocument({ body: 'x'.repeat(120) });
        expect(long.title.length).toBe(80);
    });

    it('refuses to save nothing, including an empty first checkbox', () => {
        expect(buildCaptureDocument({ title: ' ', body: '\n ' })).toBeNull();
        expect(buildCaptureDocument({ body: '- [ ] ' })).toBeNull();
    });
});

describe('homeView', () => {
    const personal = 'user:me';
    const docs = [
        { id: 'a', dbKey: personal, folderId: null, isPinned: false, displayedDate: '2026-10-01' },
        { id: 'b', dbKey: personal, folderId: 'f', isPinned: true, displayedDate: '2026-10-03' },
        { id: 'c', dbKey: 'space:s', folderId: null, isPinned: false, displayedDate: '2026-10-05' },
        { id: 'd', dbKey: personal, folderId: null, isPinned: true, displayedDate: '2026-10-02' },
    ];

    it('splits pinned and others, newest first', () => {
        const { pinned, others } = buildHomeSections(docs, 'all', personal);
        expect(pinned.map((doc) => doc.id)).toEqual(['b', 'd']);
        expect(others.map((doc) => doc.id)).toEqual(['c', 'a']);
    });

    it('filters the Inbox, shared and pinned views', () => {
        const ids = (filter) => {
            const sections = buildHomeSections(docs, filter, personal);
            return [...sections.pinned, ...sections.others].map((doc) => doc.id);
        };
        expect(ids('inbox')).toEqual(['d', 'a']);
        expect(ids('shared')).toEqual(['c']);
        expect(ids('pinned')).toEqual(['b', 'd']);
        expect(isInboxDocument(docs[2], personal)).toBe(false);
    });

    it('normalizes unknown filters to all', () => {
        expect(normalizeHomeFilter('bogus')).toBe('all');
        expect(normalizeHomeFilter('inbox')).toBe('inbox');
    });

    it('puts each card into the shorter column', () => {
        const [left, right] = splitIntoColumns([10, 2, 2, 2, 5], (height) => height);
        expect(left).toEqual([10]);
        expect(right).toEqual([2, 2, 2, 5]);
    });
});
