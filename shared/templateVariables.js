/**
 * Template placeholders, filled in when a Document is made from a template:
 * `{{today}}` / `{{today:dd-MM-yyyy}}`, `{{now}}` / `{{now:HH:mm}}` and
 * `{{input:Label}}`. Shared by the app's "New from template" and the API's
 * create-from-template, so both give the same title and body.
 *
 * Global variables (`{{ name }}`) are not filled in here: they stay in the body
 * and are applied whenever the Document is previewed or exported
 * (`applyDocumentVariables` in markdownRender.js).
 */

// {{today}} / {{today:format}} and {{now}} / {{now:format}}, and {{input:Label}}. A format or
// label holds no braces, so a scan from one `{{` stops at the next: with `[^}]*`, a template
// of many unclosed `{{today:` rescanned to its end from each one (seconds at 240 KB).
const TODAY_REGEX = /\{\{today(?::([^{}]*))?\}\}/g;
const NOW_REGEX = /\{\{now(?::([^{}]*))?\}\}/g;
const INPUT_REGEX = /\{\{input:([^{}]+)\}\}/g;

/**
 * Format a Date object using simple pattern tokens.
 * Supports: yyyy, yy, MM, dd, HH, mm, ss
 * Unrecognized characters pass through unchanged.
 * @param {Date} date
 * @param {string} format
 * @returns {string}
 */
export function formatDate(date, format) {
    const pad = (n) => String(n).padStart(2, '0');
    const tokens = {
        yyyy: date.getFullYear(),
        yy: String(date.getFullYear()).slice(-2),
        MM: pad(date.getMonth() + 1),
        dd: pad(date.getDate()),
        HH: pad(date.getHours()),
        mm: pad(date.getMinutes()),
        ss: pad(date.getSeconds()),
    };

    let result = format;
    // Replace longer tokens first to avoid partial matches
    const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
    for (const token of sortedKeys) {
        result = result.replace(new RegExp(token, 'g'), tokens[token]);
    }
    return result;
}

/**
 * Resolve template variables in content.
 * @param {string} content - Raw template markdown
 * @param {Object<string,string>} inputValues - Map of label → user-entered value
 * @param {{ now?: () => Date }} [options] clock, for tests
 * @returns {string} Content with all variables substituted
 */
export function resolveTemplateVariables(content, inputValues = {}, { now = () => new Date() } = {}) {
    let result = String(content ?? '');

    // {{today:format}} and {{now:format}} first (match format-suffix before plain)
    result = result.replace(TODAY_REGEX, (_, format) => {
        const d = now();
        return format ? formatDate(d, format) : d.toISOString().slice(0, 10);
    });
    result = result.replace(NOW_REGEX, (_, format) => {
        const d = now();
        return format ? formatDate(d, format) : d.toISOString();
    });

    // {{input:Label}}: a replacer function, so `$&` and the like in a value stay literal.
    for (const [label, value] of Object.entries(inputValues || {})) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\{\\{input:${escaped}\\}\\}`, 'g');
        const text = String(value ?? '');
        result = result.replace(regex, () => text);
    }

    return result;
}

/**
 * Extract unique input variable labels from one or more template strings.
 * @param {string} content - Raw template markdown
 * @param {string} [titlePattern=''] - Optional title pattern
 * @returns {string[]} Unique, deduplicated labels in order of first appearance
 */
export function extractInputLabels(content, titlePattern = '') {
    const labels = [];
    const combined = `${content ?? ''}\n${titlePattern ?? ''}`;
    for (const match of combined.matchAll(INPUT_REGEX)) labels.push(match[1]);
    return [...new Set(labels)];
}

/**
 * The title of a Document made from a template: its title pattern with the
 * placeholders filled in, or the template's name when there is no pattern or it
 * comes out empty.
 * @param {{ name?: string, titlePattern?: string }} template
 * @param {Object<string,string>} [inputValues]
 * @param {{ now?: () => Date }} [options]
 * @returns {string}
 */
export function resolveTemplateTitle(template, inputValues = {}, options = {}) {
    const pattern = template?.titlePattern?.trim();
    if (pattern) {
        const resolved = resolveTemplateVariables(pattern, inputValues, options).trim();
        if (resolved) return resolved;
    }
    return template?.name ?? '';
}
