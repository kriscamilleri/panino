import { describe, it, expect } from 'vitest';
import { toSnippetLines, toSummary, stripInline, buildCaptureDocument } from '@/utils/markdownSnippet';
import { buildHomeSections, splitIntoColumns, normalizeHomeFilter, sortDocuments, normalizeSort, describeSort } from '@/utils/homeView';

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
        { id: 'a', name: 'banana', dbKey: personal, folderId: null, isPinned: false, displayedDate: '2026-10-01', createdDate: '2026-01-04' },
        { id: 'b', name: 'Apple', dbKey: personal, folderId: 'f', isPinned: true, displayedDate: '2026-10-03', createdDate: '2026-01-01' },
        { id: 'c', name: 'cherry', dbKey: 'space:s', folderId: null, isPinned: false, displayedDate: '2026-10-05', createdDate: '2026-01-03' },
        { id: 'd', name: 'Date 10', dbKey: personal, folderId: null, isPinned: true, displayedDate: '2026-10-02', createdDate: '2026-01-02' },
    ];
    const ids = (list) => list.map((doc) => doc.id);

    it('splits pinned and others, newest modified first by default', () => {
        const { pinned, others } = buildHomeSections(docs, 'all', personal);
        expect(ids(pinned)).toEqual(['b', 'd']);
        expect(ids(others)).toEqual(['c', 'a']);
    });

    it('keeps the chosen order inside each section', () => {
        const { pinned, others } = buildHomeSections(docs, 'all', personal, { field: 'title', direction: 'asc' });
        expect(ids(pinned)).toEqual(['b', 'd']);
        expect(ids(others)).toEqual(['a', 'c']);
    });

    it('filters shared and pinned; the Inbox filter is gone', () => {
        const all = (filter) => {
            const sections = buildHomeSections(docs, filter, personal);
            return ids([...sections.pinned, ...sections.others]);
        };
        expect(all('shared')).toEqual(['c']);
        expect(all('pinned')).toEqual(['b', 'd']);
        expect(normalizeHomeFilter('inbox')).toBe('all');
        expect(normalizeHomeFilter('bogus')).toBe('all');
    });

    it('sorts by title, created and modified in both directions', () => {
        expect(ids(sortDocuments(docs, { field: 'title', direction: 'asc' }))).toEqual(['b', 'a', 'c', 'd']);
        expect(ids(sortDocuments(docs, { field: 'title', direction: 'desc' }))).toEqual(['d', 'c', 'a', 'b']);
        expect(ids(sortDocuments(docs, { field: 'created', direction: 'asc' }))).toEqual(['b', 'd', 'c', 'a']);
        expect(ids(sortDocuments(docs, { field: 'created', direction: 'desc' }))).toEqual(['a', 'c', 'd', 'b']);
        expect(ids(sortDocuments(docs, { field: 'modified', direction: 'asc' }))).toEqual(['a', 'd', 'b', 'c']);
    });

    it('sorts titles naturally and puts missing dates last', () => {
        const titled = [{ id: '1', name: 'Note 10' }, { id: '2', name: 'note 9' }];
        expect(ids(sortDocuments(titled, { field: 'title', direction: 'asc' }))).toEqual(['2', '1']);
        const dated = [{ id: 'x', name: 'x', displayedDate: '' }, { id: 'y', name: 'y', displayedDate: '2026-01-01' }];
        expect(ids(sortDocuments(dated, { field: 'modified', direction: 'asc' }))).toEqual(['y', 'x']);
        expect(ids(sortDocuments(dated, { field: 'modified', direction: 'desc' }))).toEqual(['y', 'x']);
    });

    it('normalizes and describes sorts', () => {
        expect(normalizeSort({ field: 'size', direction: 'up' })).toEqual({ field: 'modified', direction: 'desc' });
        expect(describeSort({ field: 'title', direction: 'desc' }).short).toBe('Title, Z to A');
        expect(describeSort({ field: 'created', direction: 'asc' }).short).toBe('Created, oldest first');
    });

    it('puts each card into the shorter column', () => {
        const [left, right] = splitIntoColumns([10, 2, 2, 2, 5], (height) => height);
        expect(left).toEqual([10]);
        expect(right).toEqual([2, 2, 2, 5]);
    });
});
