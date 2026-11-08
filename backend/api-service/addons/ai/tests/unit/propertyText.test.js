// Pure helpers for Document properties (docs/specs/proposed/ai-api-expansion.md §4.6).
import { describe, expect, it } from 'vitest';
import {
    builtInKeysIn,
    matchesFilter,
    parseFilter,
    readProperties,
    requiredKeys,
    validateProperty,
} from '../../propertyText.js';

const props = (object) => Object.entries(object).map(([key, value]) => ({ key, value }));

describe('readProperties', () => {
    it('reads the front matter block with the shared parser, unquoting values', () => {
        expect(readProperties('---\nstatus: draft\nowner: "Kris"\n---\n\n# Body')).toEqual([
            { key: 'status', value: 'draft' },
            { key: 'owner', value: 'Kris' },
        ]);
    });

    it('reads nothing without a block', () => {
        expect(readProperties('# Just a heading\n\nstatus: draft')).toEqual([]);
        expect(readProperties('')).toEqual([]);
    });
});

describe('parseFilter', () => {
    it('reads conditions joined by AND in any case', () => {
        expect(parseFilter('status = draft and priority >= 2 AND due exists').conditions).toEqual([
            { key: 'status', operator: '=', value: 'draft' },
            { key: 'priority', operator: '>=', value: '2' },
            { key: 'due', operator: 'exists' },
        ]);
    });

    it('keeps quoted values whole, including the word and', () => {
        expect(parseFilter('topic = "Q and A" AND owner != \'Kris\'').conditions).toEqual([
            { key: 'topic', operator: '=', value: 'Q and A' },
            { key: 'owner', operator: '!=', value: 'Kris' },
        ]);
    });

    it('takes the first operator, preferring the longer one at the same place', () => {
        expect(parseFilter('a != b').conditions[0].operator).toBe('!=');
        expect(parseFilter('due <= 2026-12-01').conditions[0]).toEqual({ key: 'due', operator: '<=', value: '2026-12-01' });
        expect(parseFilter('link ~ a=b').conditions[0]).toEqual({ key: 'link', operator: '~', value: 'a=b' });
        expect(parseFilter('code ^= INV').conditions[0].operator).toBe('^=');
    });

    it('refuses what it cannot read', () => {
        for (const filter of ['', 'status', '= draft', 'status =', 'a = 1 AND b = 2 AND c = 3 AND d = 4 AND e = 5 AND f = 6']) {
            expect(parseFilter(filter).ok, filter).toBe(false);
        }
    });
});

describe('matchesFilter', () => {
    const doc = props({ status: 'Draft', priority: '10', due: '2026-11-20', owner: 'Kris Cheesus' });
    const match = (filter) => matchesFilter(doc, parseFilter(filter).conditions);

    it('compares text ignoring case', () => {
        expect(match('status = draft')).toBe(true);
        expect(match('STATUS = DRAFT')).toBe(true);
        expect(match('status != final')).toBe(true);
        expect(match('owner ~ chee')).toBe(true);
        expect(match('owner ^= kris')).toBe(true);
        expect(match('owner ^= chee')).toBe(false);
    });

    it('compares numbers as numbers and ISO dates as dates', () => {
        expect(match('priority > 9')).toBe(true);
        expect(match('priority < 9')).toBe(false);
        expect(match('due >= 2026-11-01')).toBe(true);
        expect(match('due < 2026-11-21T00:00:00Z')).toBe(true);
        // At the precision both sides give, 2026-11-20 and midnight that day are the same day.
        expect(match('due < 2026-11-20T00:00:00Z')).toBe(false);
    });

    it('reads a date without a time as that whole day', () => {
        // The review case: a modified time later on the boundary day.
        const modified = [{ key: 'modified_on', value: '2026-11-07T10:00:00.000Z' }];
        const on = (filter) => matchesFilter(modified, parseFilter(filter).conditions);
        expect(on('modified_on <= 2026-11-07')).toBe(true);
        expect(on('modified_on >= 2026-11-07')).toBe(true);
        expect(on('modified_on = 2026-11-07')).toBe(true);
        expect(on('modified_on != 2026-11-07')).toBe(false);
        expect(on('modified_on < 2026-11-07')).toBe(false);
        expect(on('modified_on > 2026-11-07')).toBe(false);
        expect(on('modified_on > 2026-11-06')).toBe(true);
        // Hours and minutes narrow it; zoned times compare as instants.
        expect(on('modified_on = 2026-11-07T10')).toBe(true);
        expect(on('modified_on < 2026-11-07T10:01')).toBe(true);
        expect(on('modified_on > 2026-11-07T09:59:59Z')).toBe(true);
        expect(on('modified_on < 2026-11-07T11:00:00+01:00')).toBe(false);
        expect(on('modified_on < 2026-11-07T11:00:01+01:00')).toBe(true);
        // Not dates: compared as text.
        expect(matchesFilter([{ key: 'v', value: '2026-11-07x' }], parseFilter('v = 2026-11-07x').conditions)).toBe(true);
    });

    it('handles exists, missing and != on an absent key', () => {
        expect(match('due exists')).toBe(true);
        expect(match('tags missing')).toBe(true);
        expect(match('tags exists')).toBe(false);
        expect(match('tags != x')).toBe(true);
        expect(match('tags = x')).toBe(false);
    });

    it('accepts alternatives for = (an author named by person or key)', () => {
        const withAuthor = [{ key: 'modified_by', value: 'by Kris via Claude (API key)', alternatives: ['Kris', 'Claude'] }];
        expect(matchesFilter(withAuthor, parseFilter('modified_by = claude').conditions)).toBe(true);
        expect(matchesFilter(withAuthor, parseFilter('modified_by = kris').conditions)).toBe(true);
        expect(matchesFilter(withAuthor, parseFilter('modified_by ~ api key').conditions)).toBe(true);
        expect(matchesFilter(withAuthor, parseFilter('modified_by = someone').conditions)).toBe(false);
    });

    it('parses exists and missing without being fooled by the words inside a key', () => {
        expect(parseFilter('due   EXISTS').conditions).toEqual([{ key: 'due', operator: 'exists' }]);
        expect(parseFilter('"has missing" missing').conditions).toEqual([{ key: 'has missing', operator: 'missing' }]);
        expect(parseFilter('dismissing = x').conditions).toEqual([{ key: 'dismissing', operator: '=', value: 'x' }]);
        expect(parseFilter('missing').ok).toBe(false);
    });

    it('parses a long filter in linear time', () => {
        const started = performance.now();
        for (let i = 0; i < 200; i += 1) parseFilter(`a${' '.repeat(990)}b exists`);
        expect(performance.now() - started).toBeLessThan(2000);
    });

    it('needs every condition', () => {
        expect(match('status = draft AND priority > 20')).toBe(false);
    });
});

describe('key helpers', () => {
    it('lists the keys a filter needs present, and the built-ins it uses', () => {
        const { conditions } = parseFilter('Status = x AND gone missing AND other != y AND word_count > 3');
        expect(requiredKeys(conditions)).toEqual(['status', 'word_count']);
        expect(builtInKeysIn(conditions)).toEqual(['word_count']);
    });

    it('validates keys and values for writing', () => {
        expect(validateProperty('status', ' draft ')).toEqual({ ok: true, key: 'status', value: 'draft' });
        for (const [key, value] of [['', 'x'], ['a:b', 'x'], ['-x', 'x'], ['ok', ''], ['ok', 'two\nlines'], ['ok', '---']]) {
            expect(validateProperty(key, value).ok, `${key}=${value}`).toBe(false);
        }
        expect(validateProperty('status', undefined, { requireValue: false })).toEqual({ ok: true, key: 'status' });
    });
});
