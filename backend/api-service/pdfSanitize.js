/**
 * CSS sanitation and the renderer request policy for `POST /render-pdf`.
 *
 * Every piece of CSS in a render request (the Styles page stylesheet, the print
 * Custom CSS, each per-element value, `<style>` elements and `style` attributes in the
 * Document) is parsed with css-tree and serialized back. Re-serialized CSS cannot close
 * the `<style>` block or attribute it is placed in, so markup break-out becomes
 * structurally impossible while every valid declaration a user wrote is kept.
 *
 * During the walk, `@import` is dropped unless it targets Google Fonts, and `url()` and
 * URL-bearing function arguments are dropped unless they are `data:` URLs, fragment
 * references or Google Fonts. Unparsable content is dropped at the rule or declaration
 * level, as browsers do, not the whole sheet.
 *
 * The same host policy drives Chromium request interception in `pdf.js`, so a `url()`
 * that slipped past the parser would still be blocked by the browser.
 */

import * as csstree from 'css-tree';

export const FONT_HOSTS = Object.freeze([
    'https://fonts.googleapis.com/',
    'https://fonts.gstatic.com/',
]);

const URL_FUNCTIONS = new Set(['url', 'src', 'image-set', '-webkit-image-set', 'image']);

/**
 * Whether a URL found in CSS may stay. `data:` URLs and fragment references are always
 * fine; Google Fonts hosts are allowed because the font pipeline needs them.
 * @param {string} value
 * @returns {boolean}
 */
export function isAllowedCssUrl(value) {
    const url = String(value ?? '').trim();
    if (url === '') return false;
    const lowered = url.toLowerCase();
    if (lowered.startsWith('data:')) return true;
    if (url.startsWith('#')) return true;
    return FONT_HOSTS.some(host => lowered.startsWith(host));
}

/**
 * Whether an `@import` target may stay: only Google Fonts stylesheets.
 * @param {string} href
 * @returns {boolean}
 */
export function isAllowedImport(href) {
    const lowered = String(href ?? '').trim().toLowerCase();
    return lowered.startsWith(FONT_HOSTS[0]);
}

// css-tree keeps text it cannot parse as a `Raw` node and `generate` emits it verbatim,
// which is exactly how a break-out string would survive. Raw text is dropped unless it is
// made only of characters that cannot form markup, a string, an escape or a URL.
const HARMLESS_RAW_RE = /^[\w\s\-,.:;%#*+~=!>()[\]]*$/;

function isHarmlessRaw(value) {
    return HARMLESS_RAW_RE.test(value) && !/url/i.test(value);
}

/**
 * Whether a subtree contains anything the policy rejects.
 * @param {object} node css-tree node
 * @returns {boolean}
 */
function containsRejected(node) {
    let rejected = false;
    csstree.walk(node, {
        enter(child) {
            if (rejected) return csstree.walk.break;
            if (child.type === 'Raw' && !isHarmlessRaw(child.value)) rejected = true;
            else if (child.type === 'Url' && !isAllowedCssUrl(child.value)) rejected = true;
            else if (child.type === 'Function' && URL_FUNCTIONS.has(child.name.toLowerCase())) {
                child.children?.forEach(arg => {
                    if (arg.type === 'String' && !isAllowedCssUrl(arg.value)) rejected = true;
                });
            }
            return undefined;
        },
    });
    return rejected;
}

function importHref(atrule) {
    const first = atrule.prelude?.children?.first;
    if (!first) return null;
    if (first.type === 'Url' || first.type === 'String') return first.value;
    return null;
}

function prune(ast) {
    csstree.walk(ast, {
        leave(node, item, list) {
            if (!list) return;
            switch (node.type) {
                case 'Atrule': {
                    const name = node.name.toLowerCase();
                    if (name === 'import') {
                        const href = importHref(node);
                        if (href === null || !isAllowedImport(href) || containsRejected(node)) list.remove(item);
                        return;
                    }
                    if (name === 'namespace' || name === 'charset') {
                        list.remove(item);
                        return;
                    }
                    if (containsRejected(node)) list.remove(item);
                    return;
                }
                case 'Rule':
                case 'Declaration':
                    if (containsRejected(node)) list.remove(item);
                    return;
                case 'Raw':
                    if (!isHarmlessRaw(node.value)) list.remove(item);
                    return;
                default:
            }
        },
    });
}

/**
 * The last line of defence: no serialized CSS may contain `</`, which is the only way
 * to end a `<style>` element. In strings, URLs and identifiers `\/` means `/`, so the
 * CSS keeps its meaning.
 */
function escapeCloseTags(css) {
    return css.replace(/<\//g, '<\\/');
}

const PARSE_OPTIONS = {
    positions: false,
    parseValue: true,
    parseAtrulePrelude: true,
    parseRulePrelude: true,
    parseCustomProperty: true,
    onParseError() { /* tolerant parsing keeps going; Raw nodes are pruned afterwards */ },
};

/**
 * Sanitize a complete stylesheet.
 * @param {unknown} css
 * @returns {string} CSS that is safe to place inside a `<style>` element
 */
export function sanitizeStylesheet(css) {
    if (typeof css !== 'string' || css.trim() === '') return '';
    let ast;
    try {
        ast = csstree.parse(css, { ...PARSE_OPTIONS, context: 'stylesheet' });
    } catch {
        return '';
    }
    prune(ast);
    return escapeCloseTags(csstree.generate(ast));
}

/**
 * Sanitize a declaration list, as found in a `style` attribute or a per-element value.
 * The result is well-formed CSS: every `"` in it delimits a string. It is safe inside a
 * rule block as is; when it goes into an HTML attribute it must be set through the DOM
 * (as DOMPurify does) or HTML-escaped, like any attribute value.
 * @param {unknown} css
 * @returns {string}
 */
export function sanitizeDeclarations(css) {
    if (typeof css !== 'string' || css.trim() === '') return '';
    let ast;
    try {
        ast = csstree.parse(css, { ...PARSE_OPTIONS, context: 'declarationList' });
    } catch {
        return '';
    }
    prune(ast);
    return escapeCloseTags(csstree.generate(ast));
}

/**
 * The allow-list applied to every request the rendering page makes. Everything the
 * renderer needs is inlined (`data:`) or is a Google Fonts resource.
 *
 * @param {string} url the request URL
 * @param {{ remoteFonts: boolean }} options
 * @returns {boolean}
 */
export function isAllowedRendererRequest(url, { remoteFonts }) {
    const value = String(url ?? '');
    const lowered = value.toLowerCase();
    if (lowered.startsWith('data:') || lowered.startsWith('about:')) return true;
    if (!remoteFonts) return false;
    return FONT_HOSTS.some(host => lowered.startsWith(host));
}

/**
 * The origin of a URL for logging, never the full URL (it may carry secrets or tokens).
 * @param {string} url
 * @returns {string}
 */
export function describeBlockedUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.host ? `${parsed.protocol}//${parsed.host}` : parsed.protocol;
    } catch {
        return String(url ?? '').split(':')[0] || 'unknown';
    }
}
