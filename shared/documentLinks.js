/**
 * Links to other Documents (docs/specs/active/editor-toc-and-internal-links.md §6).
 * Stored as ordinary Markdown links, `[label](panino:doc/<uuid>)` or
 * `[label](panino:doc/<uuid>#slug)`. This module parses and formats those addresses and
 * holds the MarkdownIt plugin that renders them per output:
 *
 * - `'app'`  the Preview: `<a href="#/doc/<id>?heading=<slug>" class="pn-doc-link"
 *            data-pn-doc data-pn-heading>`; the Preview follows it through the router.
 * - `'pdf'`  a PDF: `<a class="pn-doc-link" data-pn-doc data-pn-heading>` with no href, only
 *            for ids in `env.resolvedDocumentIds` when the caller gives that set; the API
 *            adds the web-app address when its caller asks for app links.
 * - `'text'` everything else (the default): `<span class="pn-doc-link">label</span>`.
 *
 * An invalid `panino:` link renders `<span class="pn-link-broken">`, and so does a
 * hand-written `#/…` app route in every mode. Hrefs are built only from a validated UUID
 * and slug; the author's string is never copied into one.
 */

import { HEADING_ID_PREFIX, decodeFragment, isValidSlug } from './documentOutline.js';

export const DOCUMENT_LINK_MODES = Object.freeze(['app', 'pdf', 'text']);

const SCHEME = 'panino:';
const DOC_PREFIX = 'panino:doc/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The title on a hand-written link to an app screen. */
export const APP_ROUTE_LINK_TITLE = "Links to Panino screens aren't supported";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDocumentId(value) {
    return typeof value === 'string' && value.length === 36 && UUID.test(value);
}

/**
 * Read a `panino:` address.
 *
 * @param {unknown} href as written, or as markdown-it normalized it (percent-encoded)
 * @returns {null | { kind: 'doc', id: string, heading: string|null } | { kind: 'invalid' }}
 *   null when it is not a `panino:` address at all
 */
export function parseDocumentHref(href) {
    if (typeof href !== 'string' || href.length < SCHEME.length) return null;
    if (href.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;
    if (href.length > 1024 || href.slice(0, DOC_PREFIX.length).toLowerCase() !== DOC_PREFIX) return { kind: 'invalid' };
    const rest = href.slice(DOC_PREFIX.length);
    const hash = rest.indexOf('#');
    const idPart = hash === -1 ? rest : rest.slice(0, hash);
    if (!isDocumentId(idPart)) return { kind: 'invalid' };
    let heading = null;
    if (hash !== -1) {
        const decoded = decodeFragment(rest.slice(hash + 1));
        if (decoded === null || !isValidSlug(decoded)) return { kind: 'invalid' };
        heading = decoded;
    }
    return { kind: 'doc', id: idPart.toLowerCase(), heading };
}

/**
 * The stored address of a Document, or of a heading in it.
 *
 * @param {string} id
 * @param {string|null} [heading] a slug
 * @returns {string}
 */
export function formatDocumentHref(id, heading = null) {
    if (!isDocumentId(id)) throw new Error('A Document id is required.');
    if (heading !== null && heading !== undefined && heading !== '') {
        if (!isValidSlug(heading)) throw new Error('Invalid heading slug.');
        return `${DOC_PREFIX}${id.toLowerCase()}#${heading}`;
    }
    return `${DOC_PREFIX}${id.toLowerCase()}`;
}

/**
 * The in-app route of a Document link, as the Preview's href and a new tab use it.
 *
 * @param {string} id a validated id
 * @param {string|null} heading a validated slug
 * @returns {string}
 */
export function appRouteHref(id, heading) {
    return heading ? `#/doc/${id}?heading=${encodeURIComponent(heading)}` : `#/doc/${id}`;
}

/**
 * Every Document id linked from a Markdown text, in order, without duplicates. A scan,
 * not a parse: it may include links inside code, which only means one more lookup.
 *
 * @param {string} markdown
 * @param {number} [limit]
 * @returns {string[]}
 */
export function findDocumentLinkIds(markdown, limit = 500) {
    const text = String(markdown ?? '');
    const ids = [];
    const seen = new Set();
    const lower = text.toLowerCase();
    let from = 0;
    while (ids.length < limit) {
        const at = lower.indexOf(DOC_PREFIX, from);
        if (at === -1) break;
        const candidate = lower.slice(at + DOC_PREFIX.length, at + DOC_PREFIX.length + 36);
        if (isDocumentId(candidate) && !seen.has(candidate)) {
            seen.add(candidate);
            ids.push(candidate);
        }
        from = at + DOC_PREFIX.length;
    }
    return ids;
}

/** Turn a link's open/close pair into a `<span>` with fixed attributes. */
function toSpan(tokens, openIndex, attrs) {
    const open = tokens[openIndex];
    open.type = 'pn_link_span_open';
    open.tag = 'span';
    open.attrs = attrs;
    let depth = 0;
    for (let j = openIndex + 1; j < tokens.length; j += 1) {
        const token = tokens[j];
        if (token.type === 'link_open') depth += 1;
        else if (token.type === 'link_close') {
            if (depth === 0) {
                token.type = 'pn_link_span_close';
                token.tag = 'span';
                return;
            }
            depth -= 1;
        }
    }
}

/**
 * @param {string} mode
 * @returns {(state: object) => void}
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Whether a link destination is a hand-written route to an app screen: a
 * relative link (no scheme, not `//host`) whose fragment starts with `#/`, as
 * in `#/settings`, `/#/settings`, `./#/addons/…` or `?a#/x`. Followed in the
 * Preview it would move the app to that screen in the same tab, so it is
 * rendered inert. An absolute URL is an ordinary external link.
 * @param {string} href
 * @returns {boolean}
 */
export function isAppRouteHref(href) {
    const text = String(href ?? '').trim();
    const hash = text.indexOf('#');
    if (hash === -1 || text[hash + 1] !== '/') return false;
    const before = text.slice(0, hash);
    return !URL_SCHEME.test(before) && !before.startsWith('//');
}

function documentLinksRule(mode) {
    return (state) => {
        const env = state.env && typeof state.env === 'object' ? state.env : {};
        const ownId = isDocumentId(env.documentId) ? env.documentId.toLowerCase() : null;
        const resolved = env.resolvedDocumentIds instanceof Set ? env.resolvedDocumentIds : null;
        const slugs = env.headingSlugs instanceof Set ? env.headingSlugs : new Set();
        for (const block of state.tokens) {
            if (block.type !== 'inline' || !block.children) continue;
            const children = block.children;
            for (let i = 0; i < children.length; i += 1) {
                const token = children[i];
                if (token.type !== 'link_open') continue;
                const href = token.attrGet('href') || '';

                // A hand-written link to an app screen (`#/settings`, `/#/addons/…`).
                if (isAppRouteHref(href)) {
                    toSpan(children, i, [['class', 'pn-link-broken'], ['title', APP_ROUTE_LINK_TITLE]]);
                    continue;
                }

                const parsed = parseDocumentHref(href);
                if (!parsed) continue;
                if (parsed.kind === 'invalid') {
                    toSpan(children, i, [['class', 'pn-link-broken']]);
                    continue;
                }
                const { id, heading } = parsed;

                // A heading in this Document, written as a Document link.
                if (ownId && id === ownId && heading) {
                    token.attrs = [['href', `#${HEADING_ID_PREFIX}${heading}`], ['data-pn-heading', heading]];
                    if (!slugs.has(heading)) token.attrs.push(['class', 'pn-link-broken']);
                    continue;
                }

                if (mode === 'app') {
                    const attrs = [['href', appRouteHref(id, heading)], ['class', 'pn-doc-link'], ['data-pn-doc', id]];
                    if (heading) attrs.push(['data-pn-heading', heading]);
                    token.attrs = attrs;
                } else if (mode === 'pdf' && (!resolved || resolved.has(id))) {
                    const attrs = [['class', 'pn-doc-link'], ['data-pn-doc', id]];
                    if (heading) attrs.push(['data-pn-heading', heading]);
                    token.attrs = attrs;
                } else {
                    toSpan(children, i, [['class', 'pn-doc-link']]);
                }
            }
        }
    };
}

/**
 * The MarkdownIt plugin. Runs after the heading anchors, so a link to a heading of this
 * Document can be checked against its headings.
 *
 * @param {import('markdown-it')} md
 * @param {{ mode?: 'app'|'pdf'|'text' }} [options]
 */
export function documentLinks(md, { mode = 'text' } = {}) {
    const chosen = DOCUMENT_LINK_MODES.includes(mode) ? mode : 'text';
    md.core.ruler.after('pn_heading_anchors', 'pn_document_links', documentLinksRule(chosen));
}
