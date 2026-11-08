// The search query language (docs/specs/active/advanced-search.md §4) and the term helpers
// both search engines use: parsing every prefix, quoting, negation, the limits and the
// notices; case folding for every letter; checklists; and linear time on hostile input.
import { describe, expect, it } from 'vitest';
import {
    countWords,
    foldedIncludes,
    hasCasedNonAscii,
    hasChecklistItem,
    likeContains,
    likeShape,
    MAX_QUERY_LENGTH,
    MAX_SEARCH_TERMS,
    parseSearchQuery,
    parseSearchTerms,
    quoteSearchValue,
    termMatches,
    textPartFound,
    tokenizeSearchQuery,
} from '../searchText.js';

const LONG = 2 * 1024 * 1024;
const kinds = (query, options) => parseSearchQuery(query, options).parts.map((part) => {
    const { token: _token, ...rest } = part;
    return rest;
});

describe('parseSearchQuery', () => {
    it('reads words and phrases as before, without repeats', () => {
        const parsed = parseSearchQuery('invoice  "due date"  Acme invoice');
        expect(parsed.terms).toEqual(['invoice', 'due date', 'Acme']);
        expect(parsed.parts.map((part) => [part.type, part.field, part.value, part.negated]))
            .toEqual([['text', 'any', 'invoice', false], ['text', 'any', 'due date', false], ['text', 'any', 'Acme', false]]);
        expect(parsed.notices).toEqual([]);
        // An unclosed quote is dropped, as the first release read it.
        expect(parseSearchQuery('"unclosed phrase').terms).toEqual(['unclosed', 'phrase']);
        expect(parseSearchQuery('"  spaced   out "').terms).toEqual(['spaced out']);
        expect(parseSearchQuery('""  " "').parts).toEqual([]);
    });

    it('reads every prefix, in any case', () => {
        expect(kinds('TITLE:kickoff title:"team sync" In:"Acme Team/Contracts" is:Checklist prop:status=draft')).toEqual([
            { type: 'text', field: 'title', value: 'kickoff', negated: false },
            { type: 'text', field: 'title', value: 'team sync', negated: false },
            { type: 'in', path: ['Acme Team', 'Contracts'], value: 'Acme Team/Contracts', negated: false },
            { type: 'is', value: 'checklist', negated: false },
            { type: 'prop', condition: { key: 'status', operator: '=', value: 'draft' }, value: 'status=draft', negated: false },
        ]);
        expect(kinds('prop:"due <= 2026-12-01" prop:"owner missing"').map((part) => part.condition)).toEqual([
            { key: 'due', operator: '<=', value: '2026-12-01' },
            { key: 'owner', operator: 'missing' },
        ]);
        expect(kinds('in:Projects / 2026')[0]).toMatchObject({ type: 'in', path: ['Projects'] });
        expect(kinds('in:"Projects / 2026"')[0]).toMatchObject({ type: 'in', path: ['Projects', '2026'] });
    });

    it('negates any part with a leading dash', () => {
        expect(kinds('plan -draft -"old plan" -title:x -in:Archive -is:checklist -prop:status=done').map((part) => [part.type, part.negated]))
            .toEqual([['text', false], ['text', true], ['text', true], ['text', true], ['in', true], ['is', true], ['prop', true]]);
        // A dash alone is a word; negations are not search terms to mark.
        expect(parseSearchQuery('a - b -c').terms).toEqual(['a', '-', 'b']);
    });

    it('keeps a word that only looks like a prefix, and a quoted prefix, as text', () => {
        expect(kinds('Note: http://x "title:"')).toEqual([
            { type: 'text', field: 'any', value: 'Note:', negated: false },
            { type: 'text', field: 'any', value: 'http://x', negated: false },
            { type: 'text', field: 'any', value: 'title:', negated: false },
        ]);
    });

    it('puts plain words where the API`s in parameter says, but title: always in the title', () => {
        expect(kinds('a title:b', { field: 'content' }).map((part) => part.field)).toEqual(['content', 'title']);
        expect(kinds('a', { field: 'title' })[0].field).toBe('title');
    });

    it('gives a notice for each part it cannot read, and searches the rest', () => {
        const parsed = parseSearchQuery('budget title: in: is:archived is: tag:urgent prop: prop:status prop:"a=1 AND b=2" prop:created_by=Kris');
        expect(parsed.terms).toEqual(['budget']);
        expect(parsed.parts).toHaveLength(1);
        expect(parsed.notices).toEqual([
            'title: needs a word or phrase, e.g. title:kickoff',
            'in: needs a folder, e.g. in:Projects/2026',
            'is:archived is not known; use is:checklist',
            'is: needs a value, e.g. is:checklist',
            'Tags are not available yet',
            'prop: needs a condition, e.g. prop:status=draft',
            expect.stringMatching(/^prop:status: "status" has no operator/),
            'prop:"a=1 AND b=2" holds 2 conditions; write one prop: part for each',
            'prop:created_by needs revision history, which only the API has; it was left out',
        ]);
        // The API has revision history, so author conditions are kept there.
        expect(parseSearchQuery('prop:created_by=Kris', { context: 'api' }).parts[0].type).toBe('prop');
    });

    it('reads tag: once tags are available', () => {
        expect(kinds('tag:" Urgent "', { tags: true })).toEqual([{ type: 'tag', name: 'urgent', negated: false }]);
    });

    it('needs something to look for besides exclusions', () => {
        const parsed = parseSearchQuery('-draft -in:Archive');
        expect(parsed.hasPositive).toBe(false);
        expect(parsed.notices).toEqual(['Add something to look for; a search cannot be only exclusions (-).']);
        expect(parseSearchQuery('in:Archive').hasPositive).toBe(true);
        expect(parseSearchQuery('').notices).toEqual([]);
    });

    it('keeps the limits: 200 characters and 20 parts', () => {
        const long = parseSearchQuery(`${'a'.repeat(MAX_QUERY_LENGTH)}bcd`);
        expect(long.truncated).toBe(true);
        expect(long.terms[0]).toHaveLength(MAX_QUERY_LENGTH);
        expect(long.notices).toEqual(['Only the first 200 characters are searched.']);
        const many = parseSearchQuery(Array.from({ length: 25 }, (_, i) => `w${i}`).join(' '));
        expect(many.parts).toHaveLength(MAX_SEARCH_TERMS);
        expect(many.partCount).toBe(25);
        expect(many.notices).toEqual(['Only the first 20 parts of the search are used.']);
    });

    it('records where each token is, so chips can rewrite the query', () => {
        expect(tokenizeSearchQuery(' -title:"a b" x')).toEqual([
            { start: 1, end: 13, raw: '-title:"a b"', negated: true, prefix: 'title', value: 'a b', quoted: true },
            { start: 14, end: 15, raw: 'x', negated: false, prefix: null, value: 'x', quoted: false },
        ]);
    });

    it('quotes values that need it', () => {
        expect(quoteSearchValue('Projects')).toBe('Projects');
        expect(quoteSearchValue('Acme Team/Contracts')).toBe('"Acme Team/Contracts"');
        expect(quoteSearchValue('say "hi"')).toBe('"say hi"');
        expect(quoteSearchValue('')).toBe('""');
        for (const value of ['Acme Team', 'x y z', 'plain']) {
            expect(parseSearchQuery(`in:${quoteSearchValue(value)}`).parts[0].value).toBe(value);
        }
    });

    it('parses 2 MiB of hostile text in linear time', () => {
        const inputs = [
            '"'.repeat(LONG),
            `"${'a '.repeat(LONG / 2)}`,
            '-'.repeat(LONG),
            ' '.repeat(LONG),
            'title:'.repeat(LONG / 6),
            `prop:"${'a and '.repeat(LONG / 6)}`,
            'a"b '.repeat(LONG / 4),
        ];
        for (const input of inputs) {
            const started = performance.now();
            tokenizeSearchQuery(input);
            parseSearchQuery(input);
            parseSearchTerms(input);
            expect(performance.now() - started, input.slice(0, 12)).toBeLessThan(3000);
        }
    });
});

describe('case folding', () => {
    it('matches über, Über and ÜBER, and Greek, in JS', () => {
        for (const text of ['über', 'Über', 'ÜBER']) {
            for (const term of ['über', 'Über', 'ÜBER']) expect(foldedIncludes(`Wir sind ${text}all`, term)).toBe(true);
        }
        expect(foldedIncludes('ΣΟΦΊΑ and wisdom', 'σοφία')).toBe(true);
        expect(foldedIncludes('aber', 'über')).toBe(false);
    });

    it('narrows non-ASCII terms with a LIKE shape and folds ASCII terms in LIKE, as the API does', () => {
        expect(hasCasedNonAscii('Invoice 2026')).toBe(false);
        expect(hasCasedNonAscii('über')).toBe(true);
        expect(likeContains('100%')).toBe('%100\\%%');
        expect(likeShape('Größe')).toBe('%gr__e%');
    });

    it('decides a word or phrase part on the title, the body or both', () => {
        expect(textPartFound({ field: 'any', value: 'ÜBER' }, 'Über uns', '')).toBe(true);
        expect(textPartFound({ field: 'title', value: 'x' }, 'a', 'x')).toBe(false);
        expect(textPartFound({ field: 'content', value: 'a' }, 'a', 'b')).toBe(false);
    });
});

describe('hasChecklistItem', () => {
    it('finds checklist items outside code and front matter', () => {
        expect(hasChecklistItem('- [ ] milk')).toBe(true);
        expect(hasChecklistItem('Intro\n  * [x] done')).toBe(true);
        expect(hasChecklistItem('1. [X] first')).toBe(true);
        expect(hasChecklistItem('> - [ ] quoted')).toBe(true);
        expect(hasChecklistItem('## - [ ] in a heading')).toBe(true);
        expect(hasChecklistItem('- [ ] milk\r\n')).toBe(true);
    });

    it('ignores brackets that are not checklist items', () => {
        expect(hasChecklistItem('array[0] only')).toBe(false);
        expect(hasChecklistItem('- [ ]')).toBe(false);
        expect(hasChecklistItem('- [y] no')).toBe(false);
        expect(hasChecklistItem('-[ ] no space')).toBe(false);
        expect(hasChecklistItem('```\n- [ ] in code\n```')).toBe(false);
        expect(hasChecklistItem('~~~~\n- [ ] in code\n~~~\n~~~~')).toBe(false);
        expect(hasChecklistItem('---\ntask: - [ ] x\n---\nbody')).toBe(false);
        expect(hasChecklistItem('1234567890. [ ] too many digits')).toBe(false);
    });

    it('runs in linear time on 2 MiB lines', () => {
        for (const input of [' '.repeat(LONG), `- ${' '.repeat(LONG)}[ ] x`, '['.repeat(LONG), `>${' >'.repeat(LONG / 2)}`, '#'.repeat(LONG)]) {
            const started = performance.now();
            hasChecklistItem(input);
            expect(performance.now() - started).toBeLessThan(2000);
        }
    });
});

describe('term helpers moved from the API', () => {
    it('counts words and matches as before', () => {
        expect(countWords(' a  b\tc\n')).toBe(3);
        expect(termMatches('alpha\nbeta alpha', ['alpha']).matchCount).toBe(2);
    });
});
