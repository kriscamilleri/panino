// The search helpers added for the query language (docs/specs/active/advanced-search.md §4, §5):
// chips that write into the query, snippets that mark every term, recent searches cleared on
// sign-out, and the result count line.
import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '@panino/content-merge/search-text';
import {
    chipState,
    clearChips,
    clearRecentSearches,
    folderSearchPath,
    highlightSegments,
    readRecentSearches,
    rememberSearch,
    searchSnippet,
    setChecklistChip,
    setFolderChip,
    setTitlesChip,
    SEARCH_SYNTAX,
} from '@/utils/searchQuery';
import { isSearchShortcut, resultCountLabel } from '@/composables/useDocumentSearch';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

describe('search chips', () => {
    it('Titles turns every plain word and phrase into title:, and back', () => {
        const on = setTitlesChip('budget "team sync" -draft in:Projects', true);
        expect(on).toBe('title:budget title:"team sync" -title:draft in:Projects');
        expect(chipState(on).titles).toBe(true);
        expect(setTitlesChip(on, false)).toBe('budget "team sync" -draft in:Projects');
        expect(chipState('budget title:x').titles).toBe(false);
        expect(chipState('in:Projects').titles).toBe(false);
    });

    it('Checklists adds and removes is:checklist', () => {
        const on = setChecklistChip('milk', true);
        expect(on).toBe('milk is:checklist');
        expect(chipState(on)).toMatchObject({ checklists: true, everything: false });
        expect(setChecklistChip('milk IS:Checklist -is:checklist', false)).toBe('milk -is:checklist');
    });

    it('Folder writes the folder`s in: part first, quoted when needed', () => {
        const path = folderSearchPath({ spaceName: 'Acme Team', segments: ['Contracts', '2026'] });
        expect(path).toBe('Acme Team/Contracts/2026');
        const on = setFolderChip('budget', path, true);
        expect(on).toBe('in:"Acme Team/Contracts/2026" budget');
        expect(chipState(on, path).folder).toBe(true);
        expect(chipState(on, 'Other').folder).toBe(false);
        expect(setFolderChip(on, path, false)).toBe('budget');
        expect(parseSearchQuery(on).parts[0]).toMatchObject({ type: 'in', path: ['Acme Team', 'Contracts', '2026'] });
        expect(folderSearchPath({ segments: ['Projects'] })).toBe('Projects');
    });

    it('Everything clears the other chips and keeps the rest', () => {
        const query = 'in:Projects title:budget is:checklist prop:status=draft';
        expect(clearChips(query, 'Projects')).toBe('budget prop:status=draft');
        expect(chipState('budget', 'Projects').everything).toBe(true);
    });

    it('lists every part of the language in the syntax help', () => {
        expect(SEARCH_SYNTAX.map((row) => row.part)).toEqual(['word', '"a phrase"', 'title:', 'in:', 'is:checklist', 'tag:', 'prop:', '-', 'in:Trash']);
        for (const row of SEARCH_SYNTAX) expect(parseSearchQuery(`x ${row.example}`).notices).toEqual([]);
    });
});

describe('snippets and highlights', () => {
    it('marks every term, overlapping matches once', () => {
        expect(highlightSegments('Budget and plan; BUDGETS', ['budget', 'plan', 'get'])).toEqual([
            { text: 'Budget', match: true },
            { text: ' and ', match: false },
            { text: 'plan', match: true },
            { text: '; ', match: false },
            { text: 'BUDGET', match: true },
            { text: 'S', match: false },
        ]);
        expect(highlightSegments('Über uns', ['ÜBER'])[0]).toEqual({ text: 'Über', match: true });
    });

    it('centres on the first term found in the body', () => {
        const body = `${'filler '.repeat(40)}the plan is here ${'more '.repeat(40)} budget too`;
        const text = searchSnippet(body, ['missing', 'plan', 'budget'], { radius: 10 }).map((segment) => segment.text).join('');
        expect(text).toContain('plan');
        expect(text.startsWith('…')).toBe(true);
    });

    it('cuts a snippet from a 2 MiB body quickly, near the match', () => {
        const body = `${'**a _b '.repeat(150000)}\nthe needle line\n${'x'.repeat(1024 * 1024)}`;
        const started = performance.now();
        const segments = searchSnippet(body, ['needle']);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(segments.find((segment) => segment.match).text).toBe('needle');
    });
});

describe('recent searches and labels', () => {
    it('are cleared on sign-out', () => {
        const storage = memoryStorage();
        rememberSearch(storage, 'atami');
        clearRecentSearches(storage);
        expect(readRecentSearches(storage)).toEqual([]);
        // Storage that throws is ignored.
        expect(() => clearRecentSearches({ removeItem: () => { throw new Error('denied'); } })).not.toThrow();
    });

    it('count results, with + while more pages exist', () => {
        expect(resultCountLabel(0, false)).toBe('No Documents match');
        expect(resultCountLabel(1, false)).toBe('1 Document');
        expect(resultCountLabel(20, true)).toBe('20+ Documents');
    });

    it('know the shortcut on every platform', () => {
        expect(isSearchShortcut({ ctrlKey: true, shiftKey: true, key: 'F' })).toBe(true);
        expect(isSearchShortcut({ metaKey: true, shiftKey: true, key: 'f' })).toBe(true);
        expect(isSearchShortcut({ ctrlKey: true, key: 'f' })).toBe(false);
        expect(isSearchShortcut({ ctrlKey: true, shiftKey: true, altKey: true, key: 'f' })).toBe(false);
    });
});
