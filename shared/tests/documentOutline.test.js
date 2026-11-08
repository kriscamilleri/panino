import { describe, expect, it } from 'vitest';
import { Slugger, isValidSlug, slugify } from '../documentOutline.js';
import { createDocumentRenderer } from '../markdownRender.js';

/** Cases from github-slugger's own fixtures, where GitHub and Panino agree. */
const GITHUB_SLUGGER_CASES = [
    ['Hello World', 'hello-world'],
    ['Hello, World!', 'hello-world'],
    ['foo  bar', 'foo--bar'],
    ['I ♥ unicode', 'i--unicode'],
    ['Unicode ♥ is ☢', 'unicode--is-'],
    ['Dash-dash', 'dash-dash'],
    ['foo_bar', 'foo_bar'],
    ['Café', 'café'],
    ['Привет мир', 'привет-мир'],
    ['日本語', '日本語'],
    ['heading with code', 'heading-with-code'],
    ['1. Number', '1-number'],
    ['Q&A', 'qa'],
    ['ÀÉÎÕÜ', 'àéîõü'],
    ['emoji 😄 here', 'emoji--here'],
    ["it's", 'its'],
    ['a.b.c', 'abc'],
];

describe('slugs', () => {
    it.each(GITHUB_SLUGGER_CASES)('%s → %s', (text, slug) => {
        expect(slugify(text)).toBe(slug);
    });

    it('turns an empty result into section, and caps at 200 characters', () => {
        expect(slugify('')).toBe('section');
        expect(slugify('!!!')).toBe('section');
        expect(slugify('😄')).toBe('section');
        expect(slugify('a'.repeat(500))).toHaveLength(200);
        // Never cuts through a surrogate pair: 𝒳 is one code point, two UTF-16 units.
        expect(Array.from(slugify('𝒳'.repeat(300)))).toHaveLength(200);
    });

    it('dedupes in order the way github-slugger does', () => {
        const slugger = new Slugger();
        expect(['foo', 'foo', 'foo', 'foo-1'].map((text) => slugger.slug(text))).toEqual(['foo', 'foo-1', 'foo-2', 'foo-1-1']);
        const other = new Slugger();
        expect(['!', '?'].map((text) => other.slug(text))).toEqual(['section', 'section-1']);
    });

    it('validates the slug alphabet', () => {
        expect(isValidSlug('budget-1')).toBe(true);
        expect(isValidSlug('café')).toBe(true);
        expect(isValidSlug('')).toBe(false);
        expect(isValidSlug('a b')).toBe(false);
        expect(isValidSlug('a"b')).toBe(false);
        expect(isValidSlug('<x>')).toBe(false);
        expect(isValidSlug(42)).toBe(false);
    });

    it('stays fast on a 2 MiB heading', () => {
        const started = Date.now();
        expect(slugify('a!'.repeat(1024 * 1024))).toHaveLength(200);
        expect(Date.now() - started).toBeLessThan(1500);
    });
});

function outlineOf(markdown) {
    const env = {};
    createDocumentRenderer().parse(markdown, env);
    return env.outline;
}

describe('the outline and heading ids', () => {
    it('gives every heading a pn- id and lists top-level ones', () => {
        const md = createDocumentRenderer();
        const html = md.render('# Images\n\n## Forms\n\nText');
        expect(html).toContain('<h1 id="pn-images">Images</h1>');
        expect(html).toContain('<h2 id="pn-forms">Forms</h2>');
    });

    it('takes slugs and text before the typographer', () => {
        const outline = outlineOf('# Before -- after "quoted"');
        expect(outline[0].text).toBe('Before -- after "quoted"');
        expect(outline[0].slug).toBe('before----after-quoted');
        expect(createDocumentRenderer().render('# Before -- after')).toContain('id="pn-before----after"');
    });

    it('ignores code fences, tildes, indented code and raw HTML headings; counts setext', () => {
        const outline = outlineOf([
            '```', '## Not a heading', '```',
            '~~~', '# Nope', '~~~',
            '    # indented code',
            '<h2>Raw</h2>', '',
            'Setext', '======', '',
            'Other', '------',
        ].join('\n'));
        expect(outline.map((h) => [h.level, h.text])).toEqual([[1, 'Setext'], [2, 'Other']]);
    });

    it('gives ids to headings in quotes and lists without listing them', () => {
        const outline = outlineOf('# Top\n\n> ## Quoted\n\n- ## In a list\n');
        expect(outline.map((h) => [h.slug, h.listed])).toEqual([['top', true], ['quoted', false], ['in-a-list', false]]);
    });

    it('honours <!-- omit from toc -->', () => {
        const outline = outlineOf('## Kept\n\n## Skipped <!-- omit from toc -->\n');
        expect(outline.map((h) => [h.text, h.listed])).toEqual([['Kept', true], ['Skipped', false]]);
    });

    it('takes plain text from inline code, images, links and drops inline HTML', () => {
        const outline = outlineOf('# A `b` ![c *d*](x.png) [e](f) <b>g</b> &amp; h');
        expect(outline[0].text).toBe('A b c d e g & h');
    });

    it('records source lines', () => {
        expect(outlineOf('intro\n\n## Two\n').map((h) => h.line)).toEqual([2]);
    });

    it('points in-Document links at the prefixed id, and leaves other fragments', () => {
        const html = createDocumentRenderer().render('[a](#budget) [b](#nowhere) [c](#bud%C3%A9get)\n\n## Budget\n\n## Budéget\n');
        expect(html).toContain('<a href="#pn-budget" data-pn-heading="budget">a</a>');
        expect(html).toContain('<a href="#nowhere">b</a>');
        expect(html).toContain('<a href="#pn-budéget" data-pn-heading="budéget">c</a>');
    });

    it('stays fast on a 2 MiB heading line full of markup', () => {
        const hostile = `# ${'*_[`'.repeat(512 * 1024)}`;
        const started = Date.now();
        const outline = outlineOf(hostile);
        expect(outline).toHaveLength(1);
        expect(Date.now() - started).toBeLessThan(5000);
    });
});
