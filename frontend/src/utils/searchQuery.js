/**
 * Helpers for phone Search: safe LIKE patterns, result snippets with the
 * match marked, and recent searches. Snippets are returned as text segments
 * for rendering as text nodes, never as HTML.
 */

import { toSnippetLines } from './markdownSnippet';

export const SEARCH_SCOPES = Object.freeze(['everything', 'titles', 'checklists', 'folder']);
const RECENT_KEY = 'panino-recent-searches';
const RECENT_MAX = 8;

/**
 * A `LIKE ? ESCAPE '\'` pattern that matches `term` literally anywhere.
 *
 * @param {string} term
 * @returns {string}
 */
export function likePattern(term) {
    return `%${String(term ?? '').replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * @param {unknown} value
 * @returns {'everything'|'titles'|'checklists'|'folder'}
 */
export function normalizeScope(value) {
    return SEARCH_SCOPES.includes(value) ? value : 'everything';
}

/**
 * Split text into segments with every case-insensitive match of `term` marked.
 *
 * @param {string} text
 * @param {string} term
 * @returns {{ text: string, match: boolean }[]}
 */
export function highlightSegments(text, term) {
    const source = String(text ?? '');
    const needle = String(term ?? '').trim().toLowerCase();
    if (!needle) return source ? [{ text: source, match: false }] : [];
    const lower = source.toLowerCase();
    const segments = [];
    let index = 0;
    while (index < source.length) {
        const found = lower.indexOf(needle, index);
        if (found === -1) {
            segments.push({ text: source.slice(index), match: false });
            break;
        }
        if (found > index) segments.push({ text: source.slice(index, found), match: false });
        segments.push({ text: source.slice(found, found + needle.length), match: true });
        index = found + needle.length;
    }
    return segments;
}

/**
 * The stripped text around the first match in a body, cut to fit one or two
 * lines, with the match marked. Falls back to the opening text.
 *
 * @param {string} markdown
 * @param {string} term
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {number} [options.radius] characters kept on each side of the match
 * @returns {{ text: string, match: boolean }[]}
 */
export function searchSnippet(markdown, term, { title = '', radius = 60 } = {}) {
    const plain = toSnippetLines(markdown, { title, maxLines: 400 })
        .map((line) => (line.kind === 'task' ? `${line.checked ? '☑' : '☐'} ${line.text}` : line.text))
        .join(' · ');
    const needle = String(term ?? '').trim().toLowerCase();
    const at = needle ? plain.toLowerCase().indexOf(needle) : -1;
    let excerpt;
    if (at === -1) {
        excerpt = plain.slice(0, radius * 2);
        if (plain.length > excerpt.length) excerpt += '…';
    } else {
        const start = Math.max(0, at - radius);
        const end = Math.min(plain.length, at + needle.length + radius);
        excerpt = `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
    }
    return highlightSegments(excerpt, term);
}

/** Whether a body has any checklist item. */
export function hasChecklist(markdown) {
    return toSnippetLines(markdown, { maxLines: 400 }).some((line) => line.kind === 'task');
}

/**
 * Recent searches on this device, newest first.
 *
 * @param {Storage} storage
 * @returns {string[]}
 */
export function readRecentSearches(storage) {
    try {
        const parsed = JSON.parse(storage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

/**
 * Remember a search, moving it to the front.
 *
 * @param {Storage} storage
 * @param {string} term
 * @returns {string[]} the updated list
 */
export function rememberSearch(storage, term) {
    const trimmed = String(term ?? '').trim();
    if (!trimmed) return readRecentSearches(storage);
    const next = [trimmed, ...readRecentSearches(storage).filter((item) => item.toLowerCase() !== trimmed.toLowerCase())]
        .slice(0, RECENT_MAX);
    try {
        storage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable (private mode); recent searches are a convenience.
    }
    return next;
}
