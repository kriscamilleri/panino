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
 * Size caps applied before parsing. css-tree's tolerant parser is quadratic on malformed
 * input and runs synchronously in the API process, so input is bounded first.
 */
export const CSS_LIMITS = Object.freeze({
    stylesheetBytes: 256 * 1024,
    declarationsBytes: 16 * 1024,
    /** Total CSS a single render request may carry across all its inputs. */
    requestBytes: 512 * 1024,
    /** Parse errors after which a sheet is treated as hostile and dropped whole. */
    maxParseErrors: 1000,
});

/**
 * A per-request budget shared by every CSS input (request stylesheet, Custom CSS,
 * per-element values, Document `<style>` and `style`). Once spent, further CSS is dropped.
 */
export class CssBudget {
    constructor(bytes = CSS_LIMITS.requestBytes) {
        this.remaining = bytes;
        this.exceeded = false;
    }

    /** @returns {boolean} whether `length` bytes may be parsed */
    take(length) {
        if (length > this.remaining) {
            this.exceeded = true;
            return false;
        }
        this.remaining -= length;
        return true;
    }
}

// A string a browser would treat as a URL: a scheme or `//` and no whitespace.
const URL_LIKE_RE = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)\S*$/i;

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
                // A string argument is a URL; a var() argument could become one.
                child.children?.forEach(arg => {
                    if (arg.type === 'String' && !isAllowedCssUrl(arg.value)) rejected = true;
                    if (arg.type === 'Function' && arg.name.toLowerCase() === 'var') rejected = true;
                });
            } else if (child.type === 'Declaration' && (child.property.startsWith('--') || child.property.toLowerCase() === 'src')) {
                // A URL-looking string in a custom property can reach a url function via
                // var(); a bare string in `src` is a URL in some engines.
                csstree.walk(child, {
                    visit: 'String',
                    enter(str) {
                        if (URL_LIKE_RE.test(str.value) && !isAllowedCssUrl(str.value)) rejected = true;
                    },
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

/**
 * css-tree 3 keeps a nested rule without a leading `&` (CSS Nesting relaxed syntax, which
 * Chromium supports) as a `Raw` node inside the parent block, sometimes together with the
 * declarations that follow it. Re-parse such text as rules, then as declarations, and
 * splice back what parses cleanly; whatever is left is dropped by `prune`.
 */
function expandNestedRaw(ast) {
    csstree.walk(ast, {
        visit: 'Block',
        enter(block) {
            block.children.forEach((child, item, list) => {
                if (child.type !== 'Raw' || isHarmlessRaw(child.value)) return;
                const expanded = reparseBlockContent(child.value);
                if (!expanded) return;
                list.replace(item, expanded);
            });
        },
    });
}

function reparseBlockContent(text) {
    let rules;
    try {
        rules = csstree.parse(text, parseOptions('stylesheet'));
    } catch {
        return null;
    }
    const out = new csstree.List();
    let changed = false;
    rules.children.forEach((node) => {
        if (node.type === 'Raw') {
            // Declarations that trailed the nested rule.
            let decls;
            try {
                decls = csstree.parse(node.value, parseOptions('declarationList'));
            } catch {
                return;
            }
            decls.children.forEach((decl) => {
                if (decl.type === 'Declaration' && !containsRejected(decl)) {
                    out.appendData(decl);
                    changed = true;
                }
            });
            return;
        }
        if ((node.type === 'Rule' || node.type === 'Atrule') && !containsRejected(node)) {
            out.appendData(node);
            changed = true;
        }
    });
    return changed ? out : null;
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
 * The last line of defence: serialized CSS never contains a literal `<`. `</` is the only
 * way to end a `<style>` element, and DOMPurify removes a whole `<style>` whose text
 * matches `<` followed by a letter, `/` or `!`. After parsing, `<` can only sit inside a
 * string, a URL or an identifier, where the hex escape `\3c ` (the space terminates the
 * escape) means `<`, so the CSS keeps its meaning.
 */
function escapeCloseTags(css) {
    return css.replace(/</g, '\\3c ');
}

/**
 * Parse options for one call. The tolerant parser is quadratic in the number of parse
 * errors, so a sheet with too many of them is treated as hostile and the parse aborts
 * (callers return an empty string).
 */
function parseOptions(context) {
    let errors = 0;
    return {
        context,
        positions: false,
        parseValue: true,
        parseAtrulePrelude: true,
        parseRulePrelude: true,
        parseCustomProperty: true,
        onParseError() {
            errors += 1;
            if (errors > CSS_LIMITS.maxParseErrors) throw new Error('too many CSS parse errors');
        },
    };
}

/**
 * Sanitize a complete stylesheet.
 * @param {unknown} css
 * @param {CssBudget|null} [budget] per-request budget; over budget returns ''
 * @returns {string} CSS that is safe to place inside a `<style>` element
 */
export function sanitizeStylesheet(css, budget = null) {
    if (typeof css !== 'string' || css.trim() === '') return '';
    if (css.length > CSS_LIMITS.stylesheetBytes) return '';
    if (budget && !budget.take(css.length)) return '';
    let ast;
    try {
        ast = csstree.parse(css, parseOptions('stylesheet'));
    } catch {
        return '';
    }
    expandNestedRaw(ast);
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
export function sanitizeDeclarations(css, budget = null) {
    if (typeof css !== 'string' || css.trim() === '') return '';
    if (css.length > CSS_LIMITS.declarationsBytes) return '';
    if (budget && !budget.take(css.length)) return '';
    let ast;
    try {
        ast = csstree.parse(css, parseOptions('declarationList'));
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
