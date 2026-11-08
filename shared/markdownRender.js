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
import { headingAnchors } from './documentOutline.js';
import { documentLinks as documentLinksPlugin } from './documentLinks.js';
import { tocWrapper } from './tocMarker.js';

/**
 * Replace every `{{ name }}` placeholder: `{{`, at least one character that is not `}`,
 * then `}}`, the name trimmed. This is what `/\{\{\s*([^}]+?)\s*\}\}/g` matched, as a
 * single pass: that expression is quadratic on text with many `{{` and no `}}`, and
 * a Document can be 2 MiB.
 *
 * @param {string} text
 * @param {(match: string, name: string) => string} replace
 * @returns {string}
 */
function replaceVariables(text, replace) {
    let out = '';
    let copied = 0;
    let from = 0;
    while (from < text.length) {
        const open = text.indexOf('{{', from);
        if (open === -1) break;
        const close = text.indexOf('}', open + 2);
        if (close === -1) break;
        // Every `{{` before this `}` meets the same `}` first, so all of them fail
        // together when it is not `}}`.
        if (text[close + 1] !== '}' || close === open + 2) {
            from = close === open + 2 ? open + 1 : close;
            continue;
        }
        const content = text.slice(open + 2, close);
        const name = content.trim() || content;
        out += text.slice(copied, open) + replace(text.slice(open, close + 2), name);
        copied = close + 2;
        from = close + 2;
    }
    return copied === 0 ? text : out + text.slice(copied);
}

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

    return replaceVariables(body, (match, name) => {
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
 * Every renderer gives headings `id="pn-<slug>"` and points `[x](#slug)` at them,
 * wraps a table of contents in `<nav class="pn-toc">`, and renders links to other
 * Documents (`panino:doc/<id>`) for one output
 * (docs/specs/active/editor-toc-and-internal-links.md §5, §6.3):
 * `'app'` for the Preview, `'pdf'` for PDFs, `'text'` (the default) for anything
 * else. Pass `{ documentId, resolvedDocumentIds }` in the render env where it matters.
 *
 * @param {{ documentLinks?: 'app'|'pdf'|'text' }} [options]
 * @returns {MarkdownIt}
 */
export function createDocumentRenderer({ documentLinks = 'text' } = {}) {
    return new MarkdownIt({ html: true, linkify: true, typographer: true })
        .use(markdownItTaskLists)
        .use(tocWrapper)
        .use(headingAnchors)
        .use(documentLinksPlugin, { mode: documentLinks });
}

/**
 * Render Markdown (variables already applied) to unstyled, unsanitized HTML.
 *
 * @param {string} markdown
 * @param {{ documentLinks?: 'app'|'pdf'|'text', env?: object }} [options]
 * @returns {string}
 */
export function renderDocumentHtml(markdown, { documentLinks = 'text', env = {} } = {}) {
    return createDocumentRenderer({ documentLinks }).render(String(markdown ?? ''), env);
}
