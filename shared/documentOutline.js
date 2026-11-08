/**
 * Heading ids and the Document outline (docs/specs/active/editor-toc-and-internal-links.md
 * §5). One MarkdownIt plugin gives every heading a GitHub-compatible slug, renders it as
 * `id="pn-<slug>"`, records the outline in `env.outline`, and points in-Document links
 * (`[x](#slug)`) at the prefixed id. The table of contents, the link picker and the
 * Preview all read slugs from here, so they always agree.
 *
 * Everything here is linear in the length of the text: no regular expression with
 * nested or overlapping quantifiers runs on Document text.
 */

/** Slugs longer than this are cut (before the `-1` duplicate suffix). */
export const MAX_SLUG_LENGTH = 200;

/** The prefix on every heading id, so no id can clobber `document` or an app element. */
export const HEADING_ID_PREFIX = 'pn-';

/** Characters a slug keeps: letters, marks, numbers, space, `-` and `_`. */
const SLUG_DROP = /[^\p{L}\p{M}\p{N} _-]/gu;
/** A finished slug: the kept alphabet with spaces turned into `-`. */
const SLUG_ALPHABET = /^[\p{L}\p{M}\p{N}_-]+$/u;

/** A comment that keeps a heading out of a table of contents (VS Code Markdown All in One). */
const OMIT_COMMENT = 'omit from toc';

/**
 * The GitHub slug of a heading's text, without duplicate handling: lower-cased, every
 * character outside letters, marks, numbers, space, `-` and `_` removed, each space
 * turned into `-` (not collapsed), at most 200 characters, `section` when empty.
 *
 * @param {string} text the heading's plain text, before typographer replacements
 * @returns {string}
 */
export function slugify(text) {
    const kept = String(text ?? '').toLowerCase().replace(SLUG_DROP, '').replaceAll(' ', '-');
    if (!kept) return 'section';
    if (kept.length <= MAX_SLUG_LENGTH) return kept;
    // Cut on code points, never through a surrogate pair.
    let out = '';
    let count = 0;
    for (const ch of kept) {
        if (count >= MAX_SLUG_LENGTH) break;
        out += ch;
        count += 1;
    }
    return out;
}

/**
 * Whether a string can be a heading slug: what `slugify` and the duplicate suffix make.
 *
 * @param {unknown} slug
 * @returns {boolean}
 */
export function isValidSlug(slug) {
    return typeof slug === 'string'
        && slug.length > 0
        && slug.length <= MAX_SLUG_LENGTH * 2 + 12
        && SLUG_ALPHABET.test(slug);
}

/**
 * Hands out unique slugs in Document order, the way github-slugger does: the second
 * "Overview" is `overview-1`, the third `overview-2`.
 */
export class Slugger {
    constructor() {
        /** @type {Map<string, number>} */
        this.occurrences = new Map();
    }

    /**
     * @param {string} text
     * @returns {string}
     */
    slug(text) {
        const original = slugify(text);
        let result = original;
        while (this.occurrences.has(result)) {
            const next = this.occurrences.get(original) + 1;
            this.occurrences.set(original, next);
            result = `${original}-${next}`;
        }
        this.occurrences.set(result, 0);
        return result;
    }

    reset() {
        this.occurrences.clear();
    }
}

/**
 * The plain text of inline tokens: text and inline code keep their text, images their
 * alt text, links their text; inline HTML is dropped and line breaks become spaces.
 *
 * @param {Array<object>} children inline tokens
 * @returns {string}
 */
export function inlineTokensText(children) {
    let out = '';
    for (const token of children || []) {
        switch (token.type) {
            case 'text':
            case 'text_special':
            case 'code_inline':
                out += token.content;
                break;
            case 'image':
                out += inlineTokensText(token.children);
                break;
            case 'softbreak':
            case 'hardbreak':
                out += ' ';
                break;
            default:
                break;
        }
    }
    return out;
}

/**
 * Whether a heading's inline tokens end with `<!-- omit from toc -->`.
 *
 * @param {Array<object>} children
 * @returns {boolean}
 */
function endsWithOmitComment(children) {
    for (let i = (children?.length ?? 0) - 1; i >= 0; i -= 1) {
        const token = children[i];
        if (token.type === 'text' && token.content.trim() === '') continue;
        if (token.type !== 'html_inline') return false;
        const content = token.content.trim();
        if (!content.startsWith('<!--') || !content.endsWith('-->')) return false;
        return content.slice(4, -3).trim().toLowerCase() === OMIT_COMMENT;
    }
    return false;
}

/**
 * Decode a fragment the way markdown-it encoded it (`normalizeLink` percent-encodes
 * non-ASCII). Returns null when it does not decode.
 *
 * @param {string} fragment without the leading `#`
 * @returns {string|null}
 */
export function decodeFragment(fragment) {
    try {
        return decodeURIComponent(fragment);
    } catch {
        return null;
    }
}

/**
 * @typedef {object} OutlineHeading
 * @property {number} level 1–6
 * @property {string} text plain text, before typographer replacements
 * @property {string} slug unique within the Document
 * @property {boolean} listed false inside a quote or list, or with `<!-- omit from toc -->`
 * @property {number|null} line 0-based source line of the heading in the rendered body
 */

/**
 * The core rule: slugs, ids and `env.outline`, then in-Document fragment links.
 *
 * @param {object} state markdown-it core state
 */
function headingAnchorsRule(state) {
    const tokens = state.tokens;
    const slugger = new Slugger();
    /** @type {OutlineHeading[]} */
    const outline = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.type !== 'heading_open') continue;
        const inline = tokens[i + 1];
        const children = inline?.type === 'inline' ? inline.children : [];
        const text = inlineTokensText(children).trim();
        const slug = slugger.slug(text);
        token.attrSet('id', `${HEADING_ID_PREFIX}${slug}`);
        outline.push({
            level: Number(token.tag.slice(1)) || 1,
            text,
            slug,
            listed: token.level === 0 && !endsWithOmitComment(children),
            line: token.map ? token.map[0] : null,
        });
    }

    const env = state.env && typeof state.env === 'object' ? state.env : null;
    const slugs = new Set(outline.map((heading) => heading.slug));
    if (env) {
        env.outline = outline;
        env.headingSlugs = slugs;
    }
    if (!slugs.size) return;

    for (const block of tokens) {
        if (block.type !== 'inline' || !block.children) continue;
        for (const child of block.children) {
            if (child.type !== 'link_open') continue;
            const href = child.attrGet('href');
            if (!href || href.length < 2 || href[0] !== '#' || href[1] === '/') continue;
            const slug = decodeFragment(href.slice(1));
            if (slug === null || !slugs.has(slug)) continue;
            child.attrSet('href', `#${HEADING_ID_PREFIX}${slug}`);
            child.attrSet('data-pn-heading', slug);
        }
    }
}

/**
 * The MarkdownIt plugin. Runs after `inline` and before `replacements`/`smartquotes`,
 * so slugs come from the text as written (`--` stays `--`).
 *
 * @param {import('markdown-it')} md
 */
export function headingAnchors(md) {
    md.core.ruler.after('inline', 'pn_heading_anchors', headingAnchorsRule);
}

/**
 * The outline of a list of markdown-it tokens already parsed with `headingAnchors`.
 * A convenience for callers that kept the env.
 *
 * @param {object} env the env passed to `md.parse`/`md.render`
 * @returns {OutlineHeading[]}
 */
export function extractOutline(env) {
    return Array.isArray(env?.outline) ? env.outline : [];
}
