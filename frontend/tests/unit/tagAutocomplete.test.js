// Where tag autocomplete applies and the edit it makes (tag-system.md §5.4).
import { describe, expect, it } from 'vitest';
import { applyTagCompletion, tagCompletionContext, yamlTagValue } from '@/utils/tagAutocomplete';

/** The context with the caret at `|`, and the text without it. */
function at(marked) {
    const caret = marked.indexOf('|');
    const value = marked.slice(0, caret) + marked.slice(caret + 1);
    return { value, caret, context: tagCompletionContext(value, caret) };
}

describe('tagCompletionContext', () => {
    it('applies after `tags:` on the line itself', () => {
        const { context } = at('---\ntitle: Plan\ntags: wo|\n---\nBody');
        expect(context).toMatchObject({ prefix: 'wo', form: 'single', existing: [] });
    });

    it('applies in an inline list item and knows the other items', () => {
        const { value, context } = at('---\ntags: [Work, ur|, later]\n---\n');
        expect(context).toMatchObject({ prefix: 'ur', form: 'inline' });
        expect(context.existing.sort()).toEqual(['later', 'work']);
        expect(value.slice(context.start, context.end)).toBe('ur');
        expect(at('---\ntags: [a, |\n').context).toMatchObject({ prefix: '', form: 'inline' });
        expect(at('---\ntags: [a] |\n---\n').context).toBeNull();
    });

    it('applies in a `- ` item under `tags:`, in a block still being typed', () => {
        const { context } = at('---\ntags:\n  - work\n  - ur|\n  - later\n');
        expect(context).toMatchObject({ prefix: 'ur', form: 'list' });
        expect(context.existing.sort()).toEqual(['later', 'work']);
        expect(at('---\ntags:\n  - |').context).toMatchObject({ prefix: '' });
        expect(at('---\ntags:\n\n  # comment\n  - "qu|').context).toMatchObject({ prefix: 'qu' });
    });

    it('does not apply elsewhere', () => {
        expect(at('---\ntitle: wo|\n---\n').context).toBeNull();
        expect(at('---\nother:\n  - wo|\n---\n').context).toBeNull();
        expect(at('---\ntags: x\n  - wo|\n---\n').context).toBeNull();
        expect(at('---\ntags: x\n---\ntags: wo|').context).toBeNull();
        expect(at('Intro\n---\ntags: wo|').context).toBeNull();
        expect(at('tags: wo|').context).toBeNull();
        expect(at('---\nta|gs: x\n---\n').context).toBeNull();
        expect(at('---\n  tags: wo|\n---\n').context).toBeNull();
        expect(at('---\ntags:\n  -wo|\n').context).toBeNull();
        expect(tagCompletionContext('---\ntags: a', 99)).toBeNull();
        expect(tagCompletionContext(null, 0)).toBeNull();
    });

    it('does not apply past the first 16 KB', () => {
        const filler = `---\n${'k: v\n'.repeat(4000)}tags: wo`;
        expect(tagCompletionContext(filler, filler.length)).toBeNull();
    });

    it('replaces the whole word under the caret, not a trailing comment', () => {
        const { value, context } = at('---\ntags: wo|rk # main\n---\n');
        expect(value.slice(context.start, context.end)).toBe('work');
    });
});

describe('applyTagCompletion', () => {
    it('replaces the typed part and puts the caret after the tag', () => {
        const { value, context } = at('---\ntags: [Work, ur|, later]\n---\n');
        const next = applyTagCompletion(value, context, 'Urgent');
        expect(next.value).toBe('---\ntags: [Work, Urgent, later]\n---\n');
        expect(next.value.slice(0, next.selectionStart)).toBe('---\ntags: [Work, Urgent');
    });

    it('quotes a name YAML would misread', () => {
        expect(yamlTagValue('work')).toBe('work');
        expect(yamlTagValue('to do')).toBe('to do');
        expect(yamlTagValue('a: b')).toBe('"a: b"');
        expect(yamlTagValue('q3, plan')).toBe('"q3, plan"');
        expect(yamlTagValue('#hash')).toBe('"#hash"');
        expect(yamlTagValue('say "hi"')).toBe('\'say "hi"\'');
        const { value, context } = at('---\ntags:\n  - q|\n');
        expect(applyTagCompletion(value, context, 'q3, plan').value).toBe('---\ntags:\n  - "q3, plan"\n');
    });
});

describe('autocomplete values read back as written (review, 2026-11-08)', () => {
    it('quotes a name with both quote kinds so readTags returns it unchanged', async () => {
        const { readTags } = await import('@panino/content-merge/front-matter');
        for (const label of ['it\'s "fine"', 'issue #12', 'a: b', 'back\\slash "x"', "o'neil"]) {
            const value = yamlTagValue(label);
            expect(readTags(`---\ntags: ${value}\n---\n`)).toEqual([label.toLowerCase()]);
            expect(readTags(`---\ntags:\n  - ${value}\n---\n`)).toEqual([label.toLowerCase()]);
        }
    });

    it('treats a `#` inside a quoted item as part of the name being typed', () => {
        const marked = '---\ntags:\n  - "issue #1|2"\n';
        const caret = marked.indexOf('|');
        const value = marked.replace('|', '');
        const context = tagCompletionContext(value, caret);
        expect(context).not.toBeNull();
        expect(value.slice(context.start, context.end)).toBe('"issue #12"');
    });
});
