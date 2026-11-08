// Tags in front matter (docs/specs/active/tag-system.md §3): which forms are read, how
// names are canonicalised, and that hostile input is read in linear time.
import { describe, expect, it } from 'vitest';
import {
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_DOCUMENT,
    canonicalTagName,
    parseFrontMatter,
    readTagEntries,
    readTags,
    tagDisplayName,
} from '../frontMatter.js';

describe('readTags', () => {
    it('reads a list on the following lines, indented or not', () => {
        expect(readTags('---\ntitle: Notes\ntags:\n  - work\n  - urgent\n---\nBody')).toEqual(['work', 'urgent']);
        expect(readTags('---\ntags:\n- work\n- urgent\nstatus: draft\n---\n')).toEqual(['work', 'urgent']);
    });

    it('stops the list at the next key and skips blank lines, comments and empty items', () => {
        const markdown = '---\ntags:\n  - a\n\n  # note\n  -\n  - b\nauthor: Kris\n  - c\n---\n';
        expect(readTags(markdown)).toEqual(['a', 'b']);
    });

    it('reads a single string as one tag', () => {
        expect(readTags('---\ntags: work\n---\n')).toEqual(['work']);
        expect(readTags('---\ntags: to do\n---\n')).toEqual(['to do']);
    });

    it('reads the inline list form, with quotes and commas inside them', () => {
        expect(readTags('---\ntags: [work, urgent]\n---\n')).toEqual(['work', 'urgent']);
        expect(readTags('---\ntags: ["q3, plan", \'Ops\', ]\n---\n')).toEqual(['q3, plan', 'ops']);
        expect(readTags('---\ntags: []\n---\n')).toEqual([]);
    });

    it('unquotes values and ignores comments', () => {
        expect(readTags('---\ntags: "Work" # main\n---\n')).toEqual(['work']);
        expect(readTags("---\ntags:\n  - 'a b' # x\n  - \"c\"\n---\n")).toEqual(['a b', 'c']);
        expect(readTags('---\ntags: ~\n---\n')).toEqual([]);
        expect(readTags('---\ntags: null\n---\n')).toEqual([]);
    });

    it('finds the key case-insensitively, at the top level only', () => {
        expect(readTags('---\nTags:\n  - X\n---\n')).toEqual(['x']);
        expect(readTags('---\nmeta:\n  tags: nested\n---\n')).toEqual([]);
    });

    it('canonicalises case and white space, dedupes and keeps the first spelling', () => {
        expect(readTagEntries('---\ntags:\n  - Work\n  - WORK\n  - "  To   Do "\n  - to do\n---\n')).toEqual([
            { name: 'work', label: 'Work' },
            { name: 'to do', label: 'To Do' },
        ]);
    });

    it('has no tags without a closed, YAML-shaped block', () => {
        expect(readTags('')).toEqual([]);
        expect(readTags(null)).toEqual([]);
        expect(readTags('# Title\n\ntags: work')).toEqual([]);
        expect(readTags('---\ntags:\n  - work\n')).toEqual([]);
        expect(readTags('---\n\nSome prose here.\n\ntags: work\n\n---\n')).toEqual([]);
        expect(readTags('Intro\n---\ntags: work\n---\n')).toEqual([]);
    });

    it('ignores names over the limit instead of cutting them', () => {
        const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
        const fits = 'y'.repeat(MAX_TAG_LENGTH);
        expect(readTags(`---\ntags:\n  - ${long}\n  - ${fits}\n---\n`)).toEqual([fits]);
    });

    it('reads at most the per-Document cap', () => {
        const items = Array.from({ length: MAX_TAGS_PER_DOCUMENT + 20 }, (_, i) => `  - t${i}`).join('\n');
        expect(readTags(`---\ntags:\n${items}\n---\n`)).toHaveLength(MAX_TAGS_PER_DOCUMENT);
        const inline = Array.from({ length: MAX_TAGS_PER_DOCUMENT + 20 }, (_, i) => `t${i}`).join(', ');
        expect(readTags(`---\ntags: [${inline}]\n---\n`)).toHaveLength(MAX_TAGS_PER_DOCUMENT);
    });

    it('leaves the shared parser as it was', () => {
        const markdown = '---\ntitle: Plan\ntags:\n  - a\n---\nBody';
        expect(parseFrontMatter(markdown).metadata).toEqual({ title: 'Plan' });
        expect(parseFrontMatter('---\ntags: work\n---\n').metadata).toEqual({ tags: 'work' });
    });

    it('reads hostile 2 MiB lines in linear time', () => {
        const huge = 2 * 1024 * 1024;
        const spaces = ' '.repeat(huge);
        const quotes = '"'.repeat(huge);
        const commas = ','.repeat(huge);
        const started = performance.now();
        readTags(`---\ntags: a${spaces}b\n---\n`);
        readTags(`---\ntags: [${quotes}]\n---\n`);
        readTags(`---\ntags: [${commas}]\n---\n`);
        readTags(`---\ntags: ['${'a'.repeat(huge)}]\n---\n`);
        readTags(`---\ntags:\n  - ${'#'.repeat(huge)}\n  - ${' #'.repeat(huge / 2)}\n---\n`);
        readTags(`---\nkey: v\n${'a'.repeat(huge)}:\ntags: x\n---\n`);
        canonicalTagName(spaces);
        expect(performance.now() - started).toBeLessThan(2000);
    });
});

describe('canonicalTagName', () => {
    it('trims, collapses white space and lower-cases', () => {
        expect(canonicalTagName('  Q3   Plan ')).toBe('q3 plan');
        expect(canonicalTagName('Über')).toBe('über');
        expect(tagDisplayName('  Q3\t Plan ')).toBe('Q3 Plan');
    });

    it('refuses empty, non-text and over-long names', () => {
        expect(canonicalTagName('')).toBeNull();
        expect(canonicalTagName('   ')).toBeNull();
        expect(canonicalTagName(42)).toBeNull();
        expect(canonicalTagName('a'.repeat(MAX_TAG_LENGTH + 1))).toBeNull();
        expect(canonicalTagName(` ${'a'.repeat(MAX_TAG_LENGTH)} `)).toBe('a'.repeat(MAX_TAG_LENGTH));
    });
});

describe('readTags and quoting (review, 2026-11-08)', () => {
    const fm = (lines) => `---\n${lines}\n---\nBody`;

    it('keeps a ` #` inside a quoted name, in every form', () => {
        expect(readTags(fm('tags: "c #1"'))).toEqual(['c #1']);
        expect(readTags(fm('tags:\n  - "issue #12"'))).toEqual(['issue #12']);
        expect(readTags(fm('tags: ["a #b", c]'))).toEqual(['a #b', 'c']);
        expect(readTags(fm('tags:\n  - one # note\n  - "two #2" # note'))).toEqual(['one', 'two #2']);
    });

    it('still drops a comment after a plain value, and keeps an apostrophe inside a plain word', () => {
        expect(readTags(fm('tags: work # later'))).toEqual(['work']);
        expect(readTags(fm("tags: it's # later"))).toEqual(["it's"]);
    });

    it('undoes YAML escapes in quoted names', () => {
        expect(readTags(fm("tags: 'it''s'"))).toEqual(["it's"]);
        expect(readTags(fm('tags: "say \\"hi\\""'))).toEqual(['say "hi"']);
    });

    it('reads no tag from an unclosed inline list, and reads `tags: - work` as a list item', () => {
        expect(readTags(fm('tags: [a, b'))).toEqual([]);
        expect(readTags(fm('tags: - work'))).toEqual(['work']);
    });

    it('stays linear on an unclosed quote and a huge quoted list', () => {
        const long = 'a'.repeat(2 * 1024 * 1024);
        const started = performance.now();
        readTags(fm(`tags: "${long}`));
        readTags(fm(`tags: [${'"x #y", '.repeat(200000)}]`));
        expect(performance.now() - started).toBeLessThan(2000);
    });
});
