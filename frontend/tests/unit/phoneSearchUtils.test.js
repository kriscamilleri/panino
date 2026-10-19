import { describe, it, expect } from 'vitest';
import {
    likePattern,
    highlightSegments,
    searchSnippet,
    hasChecklist,
    normalizeScope,
    readRecentSearches,
    rememberSearch,
} from '@/utils/searchQuery';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
    };
}

describe('searchQuery', () => {
    it('escapes LIKE wildcards and the escape character', () => {
        expect(likePattern('50%_off\\x')).toBe('%50\\%\\_off\\\\x%');
        expect(likePattern('')).toBe('%%');
    });

    it('marks every case-insensitive match', () => {
        expect(highlightSegments('Atami and atami', 'ATAMI')).toEqual([
            { text: 'Atami', match: true },
            { text: ' and ', match: false },
            { text: 'atami', match: true },
        ]);
        expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', match: false }]);
    });

    it('builds a snippet around the match without markdown', () => {
        const body = `# Trip\n\n${'filler '.repeat(30)}book the **Atami** onsen\n- [x] passport`;
        const segments = searchSnippet(body, 'atami', { title: 'Trip', radius: 20 });
        const text = segments.map((segment) => segment.text).join('');
        expect(text.startsWith('…')).toBe(true);
        expect(text).not.toContain('**');
        expect(segments.find((segment) => segment.match).text).toBe('Atami');
    });

    it('treats markup in the body as text, not HTML', () => {
        const segments = searchSnippet('<img src=x onerror=alert(1)> hello', 'hello');
        expect(segments.map((segment) => segment.text).join('')).toBe('hello');
    });

    it('detects checklists and normalizes scopes', () => {
        expect(hasChecklist('- [ ] a')).toBe(true);
        expect(hasChecklist('```\n- [ ] in code\n```')).toBe(false);
        expect(normalizeScope('nope')).toBe('everything');
    });

    it('remembers recent searches newest first, without duplicates', () => {
        const storage = memoryStorage();
        rememberSearch(storage, 'atami');
        rememberSearch(storage, 'rail');
        expect(rememberSearch(storage, 'Atami')).toEqual(['Atami', 'rail']);
        storage.setItem('panino-recent-searches', 'not json');
        expect(readRecentSearches(storage)).toEqual([]);
    });
});
