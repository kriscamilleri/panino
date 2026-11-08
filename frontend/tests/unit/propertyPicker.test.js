// The property picker's rules (docs/specs/active/advanced-search.md §5.4): the keys and values
// it offers, the part it writes for each condition (quoting included), and that every part it
// writes parses back to the same condition.
import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '@panino/content-merge/search-text';
import {
    appendPart,
    buildPropertyPart,
    conditionNeedsValue,
    isDateKey,
    mergePropertyKeys,
    mergePropertyValues,
    PICKER_CONDITIONS,
} from '@/utils/propertyPicker';

describe('property picker', () => {
    it('offers the keys of every database, most used first, then the built-ins', () => {
        const keys = mergePropertyKeys([
            [{ key: 'status', count: 3 }, { key: 'Owner', count: 1 }, { key: 'word_count', count: 9 }, { key: 'tags', count: 8 }],
            [{ key: 'owner', count: 4 }, { key: 'due', count: 1 }],
        ]);
        expect(keys.map((entry) => [entry.key, entry.count, entry.builtIn])).toEqual([
            ['owner', 5, false],
            ['status', 3, false],
            ['due', 1, false],
            ['word_count', 0, true],
            ['created_on', 0, true],
            ['modified_on', 0, true],
        ]);
        expect(mergePropertyKeys([]).every((entry) => entry.builtIn)).toBe(true);
    });

    it('offers the values seen, ignoring case, most used first', () => {
        expect(mergePropertyValues([[{ value: 'Draft', count: 2 }], [{ value: 'draft', count: 1 }, { value: 'final', count: 2 }]]))
            .toEqual([{ value: 'Draft', count: 3 }, { value: 'final', count: 2 }]);
    });

    it('uses a date field for the built-in dates and keys whose values are all dates', () => {
        expect(isDateKey('created_on', [])).toBe(true);
        expect(isDateKey('modified_on', [])).toBe(true);
        expect(isDateKey('due', [{ value: '2026-12-01' }, { value: '2026-11-08T10:00:00Z' }])).toBe(true);
        expect(isDateKey('due', [{ value: '2026-12-01' }, { value: 'soon' }])).toBe(false);
        expect(isDateKey('due', [])).toBe(false);
        expect(isDateKey('word_count', [{ value: '2026-12-01' }])).toBe(false);
    });

    it('writes one part per condition, in the plainest form that parses back', () => {
        const expected = {
            is: 'prop:status=draft',
            'is-not': 'prop:status!=draft',
            contains: 'prop:status~draft',
            'starts-with': 'prop:status^=draft',
            'more-than': 'prop:status>draft',
            'less-than': 'prop:status<draft',
            'at-least': 'prop:status>=draft',
            'at-most': 'prop:status<=draft',
            set: 'prop:"status exists"',
            'not-set': 'prop:"status missing"',
        };
        for (const condition of PICKER_CONDITIONS) {
            const built = buildPropertyPart({ key: 'status', condition: condition.id, value: 'draft' });
            expect(built, condition.id).toEqual({ ok: true, part: expected[condition.id] });
            expect(conditionNeedsValue(condition.id)).toBe(!['set', 'not-set'].includes(condition.id));
        }
    });

    it('quotes values and keys with spaces, and every part it writes parses to the same condition', () => {
        const cases = [
            [{ key: 'status', condition: 'is', value: 'in progress' }, 'prop:status="in progress"', { key: 'status', operator: '=', value: 'in progress' }],
            [{ key: 'genre', condition: 'is', value: 'rock and roll' }, 'prop:genre="rock and roll"', { key: 'genre', operator: '=', value: 'rock and roll' }],
            [{ key: 'due date', condition: 'at-most', value: '2026-12-01' }, 'prop:"due date"<="2026-12-01"', { key: 'due date', operator: '<=', value: '2026-12-01' }],
            [{ key: 'due date', condition: 'set' }, 'prop:"due date exists"', { key: 'due date', operator: 'exists' }],
            [{ key: 'word_count', condition: 'more-than', value: '500' }, 'prop:word_count>500', { key: 'word_count', operator: '>', value: '500' }],
            [{ key: 'created_on', condition: 'at-least', value: '2026-11-01' }, 'prop:created_on>=2026-11-01', { key: 'created_on', operator: '>=', value: '2026-11-01' }],
            [{ key: 'url', condition: 'starts-with', value: 'a=b' }, 'prop:url^=a=b', { key: 'url', operator: '^=', value: 'a=b' }],
        ];
        for (const [input, part, condition] of cases) {
            expect(buildPropertyPart(input), part).toEqual({ ok: true, part });
            const parsed = parseSearchQuery(`budget ${part}`);
            expect(parsed.notices).toEqual([]);
            expect(parsed.parts[1].condition).toEqual(condition);
        }
    });

    it('refuses what it cannot write, with the reason', () => {
        expect(buildPropertyPart({ key: '', condition: 'is', value: 'x' })).toEqual({ ok: false, error: 'Choose a property.' });
        expect(buildPropertyPart({ key: 'status', condition: 'is', value: '  ' })).toEqual({ ok: false, error: 'Enter a value.' });
        expect(buildPropertyPart({ key: 'status', condition: 'is', value: 'say "hi"' }).ok).toBe(false);
        expect(buildPropertyPart({ key: 'a:b', condition: 'is', value: 'x' }).ok).toBe(false);
        expect(buildPropertyPart({ key: 'status', condition: 'nope', value: 'x' })).toEqual({ ok: false, error: 'Choose a condition.' });
        // Specific reasons instead of "This condition cannot be searched."
        expect(buildPropertyPart({ key: 'title', condition: 'is', value: 'a  b' }).error).toMatch(/^Values with repeated spaces or tabs can't be searched exactly/);
        expect(buildPropertyPart({ key: 'title', condition: 'is', value: 'a\tb' }).error).toMatch(/^Values with repeated spaces or tabs/);
        expect(buildPropertyPart({ key: 'a=b', condition: 'is', value: 'x' }).error).toBe("Property names with =, <, >, !, ~ or ^ can't be searched.");
        expect(buildPropertyPart({ key: 'title', condition: 'contains', value: 'a b' })).toEqual({ ok: true, part: 'prop:title~"a b"' });
    });

    it('adds the part to the end of the query', () => {
        expect(appendPart('  budget ', 'prop:status=draft')).toBe('budget prop:status=draft');
        expect(appendPart('', 'prop:status=draft')).toBe('prop:status=draft');
    });
});
