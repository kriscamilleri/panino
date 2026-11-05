/**
 * The one way a Document's Markdown becomes HTML, shared by the frontend
 * (Preview, PDF export, the Odoo send sheet) and the API (server-side rendering
 * for Odoo syncs): the same MarkdownIt setup, the same task-list plugin and the
 * same `{{ variable }}` substitution, so what the server produces is what the
 * person saw. Styling (inline `style` attributes, image URL tokens) is layered on
 * by each side; sanitizing is each side's job too.
 */

import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import { parseFrontMatter } from './frontMatter.js';

/** `{{ name }}` placeholders, matched the way the Preview always has. */
const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Variable names are compared trimmed, single-spaced and lower-cased.
 * @param {string} name
 * @returns {string}
 */
export function normalizeVariableName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The Document's body with its `{{ variables }}` filled in from, in rising
 * precedence, the built-ins `GLOBAL_DATE` and `GLOBAL_TIME`, the account's
 * global variables, and the Document's own front matter. An unknown variable is
 * left as written.
 *
 * @param {string} markdown the whole Document, front matter included
 * @param {object} [options]
 * @param {Map<string,string>|Object<string,string>} [options.globals] the account's global
 *   variables, keyed by name (normalized or not)
 * @param {Date} [options.now] for `GLOBAL_DATE` and `GLOBAL_TIME`
 * @param {(date: Date) => string} [options.formatDate] defaults to `toLocaleDateString()`
 * @param {(date: Date) => string} [options.formatTime] defaults to `toLocaleTimeString()`
 * @returns {string}
 */
export function applyDocumentVariables(markdown, { globals, now = new Date(), formatDate, formatTime } = {}) {
    if (!markdown) return '';
    const { metadata, body } = parseFrontMatter(markdown);
    const variables = new Map();
    variables.set(normalizeVariableName('GLOBAL_DATE'), formatDate ? formatDate(now) : now.toLocaleDateString());
    variables.set(normalizeVariableName('GLOBAL_TIME'), formatTime ? formatTime(now) : now.toLocaleTimeString());

    const entries = globals instanceof Map ? globals.entries() : Object.entries(globals || {});
    for (const [key, value] of entries) {
        const name = normalizeVariableName(key);
        if (name) variables.set(name, value);
    }
    for (const [key, value] of Object.entries(metadata)) {
        const name = normalizeVariableName(key);
        if (name) variables.set(name, value);
    }

    return body.replace(VARIABLE_PATTERN, (match, name) => {
        const normalized = normalizeVariableName(name);
        if (!normalized) return match;
        const value = variables.get(normalized);
        return value !== undefined ? value : match;
    });
}

/**
 * A fresh MarkdownIt the way Panino configures it. Callers may add renderer
 * rules (the Preview adds its inline styles) without affecting anyone else.
 *
 * @returns {MarkdownIt}
 */
export function createDocumentRenderer() {
    return new MarkdownIt({ html: true, linkify: true, typographer: true }).use(markdownItTaskLists);
}

/**
 * Render Markdown (variables already applied) to unstyled, unsanitized HTML.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function renderDocumentHtml(markdown) {
    return createDocumentRenderer().render(String(markdown ?? ''));
}
