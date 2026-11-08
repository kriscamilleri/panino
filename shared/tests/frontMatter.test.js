// The front matter block: when the `---` lines at the top are front matter and when they
// are thematic breaks in the text, and reading it in linear time.
import { describe, expect, it } from 'vitest';
import { findFrontMatterBlock, parseFrontMatter, removeFrontMatterKeys, setFrontMatterValues } from '../frontMatter.js';

describe('front matter block', () => {
    it('reads `key: value` lines between two `---` lines at the top', () => {
        expect(parseFrontMatter('---\na: 1\nb: two words\n---\nbody')).toEqual({ metadata: { a: '1', b: 'two words' }, body: 'body' });
        expect(parseFrontMatter('\n\n---\r\nstatus: draft\r\n---\r\n\r\nText')).toEqual({ metadata: { status: 'draft' }, body: '\nText' });
    });

    it('keeps YAML shapes it does not read inside the block', () => {
        const markdown = '---\ntitle: Plan\ntags:\n  - a\n- b\n# a comment\nauthor:\n  name: Kris\n---\nBody';
        expect(parseFrontMatter(markdown)).toEqual({ metadata: { title: 'Plan', name: 'Kris' }, body: 'Body' });
    });

    it('treats `---` rules around ordinary text as text, not front matter', () => {
        // The review's case: a rule, prose, a "Note:" line and a rule.
        const ruled = '---\n\nIntro.\n\nNote: remember this\n\n---\n\n# Body';
        expect(parseFrontMatter(ruled)).toEqual({ metadata: {}, body: ruled });
        expect(findFrontMatterBlock(ruled.split('\n'))).toEqual({ start: -1, end: -1 });
        // A heading between rules is text too, and so is a block with no key at all.
        expect(parseFrontMatter('---\n# Title\n---\nText').metadata).toEqual({});
        expect(parseFrontMatter('---\n---\nText').metadata).toEqual({});
    });

    it('does not empty a Document that starts with a rule and has no second one', () => {
        // The Preview and PDF render `body`; an unclosed block used to swallow the Document.
        const markdown = '---\n\nHello world.\n\nMore text.';
        expect(parseFrontMatter(markdown)).toEqual({ metadata: {}, body: markdown });
        expect(parseFrontMatter('---\nstatus: draft\n').body).toBe('---\nstatus: draft\n');
    });

    it('writes a new block above a leading rule instead of into the text', () => {
        const ruled = '---\n\nIntro.\n\n---\n\nBody';
        expect(setFrontMatterValues(ruled, { status: 'draft' })).toBe(`---\nstatus: draft\n---\n\n${ruled}`);
        expect(removeFrontMatterKeys(ruled, ['Intro.'])).toBe(ruled);
    });

    it('sets and removes keys in a block, ignoring case', () => {
        const markdown = '---\nStatus: draft\npriority: 2\n---\n\nBody';
        expect(setFrontMatterValues(markdown, { status: 'final', owner: 'Sam' })).toBe('---\nstatus: final\npriority: 2\nowner: Sam\n---\n\nBody');
        expect(removeFrontMatterKeys(markdown, ['STATUS'])).toBe('---\npriority: 2\n---\n\nBody');
        expect(removeFrontMatterKeys(markdown, ['status', 'priority'])).toBe('Body');
    });

    it('reads a block with very long lines in linear time', () => {
        // `^([^:\n]+?)\s*:` backtracked on a long line without a colon: 92 ms at 16 KB.
        const long = `a${' '.repeat(2 * 1024 * 1024)}b`;
        const started = performance.now();
        parseFrontMatter(`---\nkey: v\n${long}\n---\nBody`);
        parseFrontMatter(`---\nkey: v\n  ${long}\n---\nBody`);
        setFrontMatterValues(`---\nkey: v\n  ${long}\n---\nBody`, { other: 'x' });
        expect(performance.now() - started).toBeLessThan(2000);
    });
});
