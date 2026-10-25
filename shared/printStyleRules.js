/**
 * Validation rules for the structured print-style settings that `POST /render-pdf`
 * places into CSS and `style` attributes. The backend uses them to fall back to its
 * defaults; the frontend Styles pages can use the same rules to flag a value before it
 * is silently replaced.
 *
 * Pure functions, no dependencies. Keep this file importable from the browser.
 */

/** Paper sizes the UI offers and the renderer accepts. */
export const PAPER_SIZES = Object.freeze(['A4', 'Letter']);

/** Per-element style keys: the selectors a print style may style directly. */
export const PRINT_ELEMENT_KEYS = Object.freeze([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr', 'em', 'strong', 'a', 'img',
    'table', 'tr', 'th', 'td',
]);

/** Setting keys that are not element selectors. */
export const PRINT_SETTING_KEYS = Object.freeze([
    'customCSS', 'googleFontFamily', 'printHeaderHtml', 'printFooterHtml',
    'headerFontSize', 'headerFontColor', 'headerAlign',
    'footerFontSize', 'footerFontColor', 'footerAlign',
    'headerHeight', 'footerHeight', 'pageMargin', 'pageSize', 'enablePageNumbers',
]);

const LENGTH_KEYS = new Set(['pageMargin', 'headerHeight', 'footerHeight']);
const COLOR_KEYS = new Set(['headerFontColor', 'footerFontColor']);
const FONT_SIZE_KEYS = new Set(['headerFontSize', 'footerFontSize']);
const ALIGN_KEYS = new Set(['headerAlign', 'footerAlign']);
const FREE_TEXT_KEYS = new Set(['customCSS', 'printHeaderHtml', 'printFooterHtml']);

const LENGTH_RE = /^(\d+(\.\d+)?|\.\d+)(cm|mm|in|px|pt)$/;
const HEX_COLOR_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_RE = /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+|\d{1,3}%)\s*)?\)$/i;
const FONT_FAMILY_RE = /^[\w\s-]+$/;

export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 72;

/**
 * A CSS length such as `2cm`, `12.5mm`, or `0`.
 * @param {unknown} value
 * @returns {string|null} the trimmed value, or null when it is not a plain length
 */
export function parseLength(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed === '0') return trimmed;
    return LENGTH_RE.test(trimmed) ? trimmed : null;
}

/**
 * A hex colour or an `rgb()` / `rgba()` colour with numeric arguments.
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseColor(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return HEX_COLOR_RE.test(trimmed) || RGB_COLOR_RE.test(trimmed) ? trimmed : null;
}

/**
 * A header or footer font size in pixels, as an integer string between 6 and 72.
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseFontSize(value) {
    const text = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX ? String(n) : null;
}

/**
 * @param {unknown} value
 * @returns {'left'|'center'|'right'|null}
 */
export function parseAlign(value) {
    if (typeof value !== 'string') return null;
    const lowered = value.trim().toLowerCase();
    return lowered === 'left' || lowered === 'center' || lowered === 'right' ? lowered : null;
}

/**
 * @param {unknown} value
 * @returns {'A4'|'Letter'|null}
 */
export function parsePaperSize(value) {
    return typeof value === 'string' && PAPER_SIZES.includes(value.trim()) ? value.trim() : null;
}

/**
 * A comma-separated list of Google font family names. Entries are letters, digits,
 * spaces, underscores and hyphens; anything else is dropped from the list.
 * @param {unknown} value
 * @returns {{ value: string, dropped: string[] } | null} null when no entry survives
 */
export function parseFontFamilies(value) {
    if (typeof value !== 'string') return null;
    const kept = [];
    const dropped = [];
    for (const raw of value.split(',')) {
        const original = raw.trim();
        // Stored values may carry quotes ("Source Sans 3"); the name is what matters.
        const entry = original.replace(/^["']|["']$/g, '').trim();
        if (!entry) continue;
        if (FONT_FAMILY_RE.test(entry)) kept.push(entry);
        else dropped.push(original);
    }
    if (kept.length === 0) return null;
    return { value: kept.join(', '), dropped };
}

/**
 * Validate one setting. Element keys and free-text keys accept any string; the
 * structured keys use the parsers above.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {{ ok: true, value: unknown } | { ok: false, reason: string }}
 */
export function validatePrintStyleValue(key, value) {
    if (PRINT_ELEMENT_KEYS.includes(key) || FREE_TEXT_KEYS.has(key)) {
        return typeof value === 'string'
            ? { ok: true, value }
            : { ok: false, reason: 'must be text' };
    }
    if (key === 'enablePageNumbers') {
        return { ok: true, value: value === true || value === 'true' || value === 1 || value === '1' };
    }
    if (key === 'pageSize') {
        const parsed = parsePaperSize(value);
        return parsed ? { ok: true, value: parsed } : { ok: false, reason: `must be one of ${PAPER_SIZES.join(', ')}` };
    }
    if (LENGTH_KEYS.has(key)) {
        const parsed = parseLength(value);
        return parsed !== null ? { ok: true, value: parsed } : { ok: false, reason: 'must be a length such as 2cm, 15mm, 0.5in, 12pt or 20px' };
    }
    if (COLOR_KEYS.has(key)) {
        const parsed = parseColor(value);
        return parsed ? { ok: true, value: parsed } : { ok: false, reason: 'must be a hex colour such as #666666, or rgb()/rgba()' };
    }
    if (FONT_SIZE_KEYS.has(key)) {
        const parsed = parseFontSize(value);
        return parsed ? { ok: true, value: parsed } : { ok: false, reason: `must be a whole number from ${FONT_SIZE_MIN} to ${FONT_SIZE_MAX}` };
    }
    if (ALIGN_KEYS.has(key)) {
        const parsed = parseAlign(value);
        return parsed ? { ok: true, value: parsed } : { ok: false, reason: 'must be left, center or right' };
    }
    if (key === 'googleFontFamily') {
        const parsed = parseFontFamilies(value);
        if (!parsed) return { ok: false, reason: 'font names may contain letters, digits, spaces and hyphens' };
        return { ok: true, value: parsed.value, dropped: parsed.dropped };
    }
    return { ok: false, reason: 'unknown setting' };
}

/**
 * Validate a whole print-style object against defaults. Each invalid or unknown value is
 * replaced by the default for its key (unknown keys are dropped) and reported.
 *
 * @param {object} input the incoming print styles
 * @param {object} defaults complete defaults keyed like `input`
 * @returns {{ styles: object, invalid: Array<{ key: string, value: unknown, reason: string }> }}
 */
export function validatePrintStyles(input, defaults) {
    const styles = { ...defaults };
    const invalid = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { styles, invalid };
    }
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined || value === null || value === '') {
            // Empty means "use the default", as the merge over defaults always did for
            // falsy values. Keep that for fields where the empty string is meaningful
            // to the renderer (header/footer/custom CSS can be switched off this way).
            if (FREE_TEXT_KEYS.has(key) || key === 'googleFontFamily') styles[key] = '';
            continue;
        }
        const result = validatePrintStyleValue(key, value);
        if (!result.ok) {
            invalid.push({ key, value, reason: result.reason });
            continue;
        }
        if (result.dropped?.length) {
            invalid.push({ key, value: result.dropped.join(', '), reason: 'font names dropped' });
        }
        styles[key] = result.value;
    }
    return { styles, invalid };
}
