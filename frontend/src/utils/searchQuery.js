/**
 * Helpers for Search on the phone and in the desktop search panel: safe LIKE
 * patterns, result snippets with every match marked, recent searches, and the
 * chips, which are shortcuts that write into the query
 * (docs/specs/active/advanced-search.md §4, §5). Snippets are returned as text
 * segments for rendering as text nodes, never as HTML.
 */

import {
    hasChecklistItem,
    quoteSearchValue,
    tokenizeSearchQuery,
} from '@panino/content-merge/search-text';
import { toSnippetLines } from './markdownSnippet';

export const SEARCH_SCOPES = Object.freeze(['everything', 'titles', 'checklists', 'folder']);
const RECENT_KEY = 'panino-recent-searches';
const RECENT_MAX = 8;
/** Characters of a body around its first match that a snippet is cut from. */
const SNIPPET_WINDOW = 1200;

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

function termList(terms) {
    const list = Array.isArray(terms) ? terms : [terms];
    return list.map((term) => String(term ?? '').trim()).filter(Boolean);
}

/**
 * Split text into segments with every case-insensitive match of any term
 * marked. Overlapping matches are marked as one.
 *
 * @param {string} text
 * @param {string|string[]} terms
 * @returns {{ text: string, match: boolean }[]}
 */
export function highlightSegments(text, terms) {
    const source = String(text ?? '');
    const needles = termList(terms).map((term) => term.toLowerCase());
    if (!needles.length) return source ? [{ text: source, match: false }] : [];
    const lower = source.toLowerCase();
    // Lower-casing can change a string's length (İ); then only exact-case
    // matches can be placed safely.
    const haystack = lower.length === source.length ? lower : source;
    const ranges = [];
    for (const needle of needles) {
        for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
            ranges.push([at, at + needle.length]);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const segments = [];
    let index = 0;
    for (const [start, end] of ranges) {
        if (end <= index) continue;
        const from = Math.max(start, index);
        if (from > index) segments.push({ text: source.slice(index, from), match: false });
        segments.push({ text: source.slice(from, end), match: true });
        index = end;
    }
    if (index < source.length) segments.push({ text: source.slice(index), match: false });
    return segments;
}

/** The part of a body worth cutting a snippet from: around the first term found. */
function snippetSource(markdown, needles) {
    const body = String(markdown ?? '');
    if (body.length <= SNIPPET_WINDOW * 2) return { text: body, cut: false };
    const lower = body.toLowerCase();
    let at = -1;
    for (const needle of needles) {
        const found = lower.indexOf(needle);
        if (found !== -1) { at = found; break; }
    }
    if (at === -1) return { text: body.slice(0, SNIPPET_WINDOW * 2), cut: false };
    // Start on a line boundary so the stripping reads whole lines.
    let start = Math.max(0, at - SNIPPET_WINDOW);
    const lineStart = body.lastIndexOf('\n', at);
    if (lineStart >= start) start = lineStart + 1;
    return { text: body.slice(start, at + SNIPPET_WINDOW), cut: start > 0 };
}

/**
 * The stripped text around the first match in a body, cut to fit one or two
 * lines, with every match marked. The first term found in the body (in the
 * order given) is the one the excerpt centres on. Falls back to the opening
 * text. Only a window of the body around that match is stripped, so a long
 * body costs no more than a short one.
 *
 * @param {string} markdown
 * @param {string|string[]} terms
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {number} [options.radius] characters kept on each side of the match
 * @returns {{ text: string, match: boolean }[]}
 */
export function searchSnippet(markdown, terms, { title = '', radius = 60 } = {}) {
    const needles = termList(terms).map((term) => term.toLowerCase());
    const source = snippetSource(markdown, needles);
    const plain = toSnippetLines(source.text, { title: source.cut ? '' : title, maxLines: 400 })
        .map((line) => (line.kind === 'task' ? `${line.checked ? '☑' : '☐'} ${line.text}` : line.text))
        .join(' · ');
    const lowerPlain = plain.toLowerCase();
    let at = -1;
    let needle = '';
    for (const candidate of needles) {
        const found = lowerPlain.indexOf(candidate);
        if (found !== -1) { at = found; needle = candidate; break; }
    }
    let excerpt;
    if (at === -1) {
        excerpt = plain.slice(0, radius * 2);
        if (plain.length > excerpt.length) excerpt += '…';
        if (source.cut) excerpt = `…${excerpt}`;
    } else {
        const start = Math.max(0, at - radius);
        const end = Math.min(plain.length, at + needle.length + radius);
        excerpt = `${start > 0 || source.cut ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
    }
    return highlightSegments(excerpt, terms);
}

/**
 * Whether a body has any checklist item: the shared rule `is:checklist` uses,
 * linear in the body.
 *
 * @param {string} markdown
 * @returns {boolean}
 */
export function hasChecklist(markdown) {
    return hasChecklistItem(markdown);
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

/**
 * Forget every recent search on this device. Called on sign-out, so the next
 * person to sign in on a shared device does not see them (§9).
 *
 * @param {Storage} storage
 */
export function clearRecentSearches(storage) {
    try {
        storage.removeItem(RECENT_KEY);
    } catch {
        // Nothing to clear when storage is unavailable.
    }
}

/* ------------------------------------------------------------------ *
 * Chips: shortcuts that write into the query
 * ------------------------------------------------------------------ */

function rebuild(tokens) {
    return tokens.map((token) => token.raw).filter(Boolean).join(' ');
}

function sameFolder(a, b) {
    return String(a ?? '').split('/').map((part) => part.trim().toLowerCase()).filter(Boolean).join('/')
        === String(b ?? '').split('/').map((part) => part.trim().toLowerCase()).filter(Boolean).join('/');
}

function plainWord(token) {
    return token.prefix === null && token.value;
}

/**
 * Which chips a query has on. Titles is on when every word or phrase is a
 * `title:` part (and there is one); Checklists when it has `is:checklist`;
 * Folder when it has `in:` for that folder. Everything is on when none is.
 *
 * @param {string} query
 * @param {string} [folderPath] the current folder's `in:` path, if any
 * @returns {{ everything: boolean, titles: boolean, checklists: boolean, folder: boolean }}
 */
export function chipState(query, folderPath = '') {
    const tokens = tokenizeSearchQuery(query);
    const words = tokens.filter((token) => plainWord(token) || (token.prefix === 'title' && token.value));
    const titles = words.length > 0 && words.every((token) => token.prefix === 'title');
    const checklists = tokens.some((token) => token.prefix === 'is' && !token.negated && token.value.toLowerCase() === 'checklist');
    const folder = Boolean(folderPath) && tokens.some((token) => token.prefix === 'in' && !token.negated && sameFolder(token.value, folderPath));
    return { everything: !titles && !checklists && !folder, titles, checklists, folder };
}

/**
 * Turn every plain word and phrase into a `title:` part, or back.
 *
 * @param {string} query
 * @param {boolean} on
 * @returns {string}
 */
export function setTitlesChip(query, on) {
    return rebuild(tokenizeSearchQuery(query).map((token) => {
        const dash = token.negated ? '-' : '';
        if (on && plainWord(token)) return { ...token, raw: `${dash}title:${quoteSearchValue(token.value)}` };
        if (!on && token.prefix === 'title' && token.value) return { ...token, raw: `${dash}${quoteSearchValue(token.value)}` };
        return token;
    }));
}

/**
 * Add `is:checklist`, or remove every one.
 *
 * @param {string} query
 * @param {boolean} on
 * @returns {string}
 */
export function setChecklistChip(query, on) {
    const tokens = tokenizeSearchQuery(query)
        .filter((token) => !(token.prefix === 'is' && token.value.toLowerCase() === 'checklist' && !token.negated));
    if (on) tokens.push({ raw: 'is:checklist' });
    return rebuild(tokens);
}

/**
 * Add `in:<folderPath>` (first, so it reads as the scope), or remove it.
 *
 * @param {string} query
 * @param {string} folderPath
 * @param {boolean} on
 * @returns {string}
 */
export function setFolderChip(query, folderPath, on) {
    const tokens = tokenizeSearchQuery(query)
        .filter((token) => !(token.prefix === 'in' && !token.negated && sameFolder(token.value, folderPath)));
    if (on && folderPath) tokens.unshift({ raw: `in:${quoteSearchValue(folderPath)}` });
    return rebuild(tokens);
}

/**
 * The Everything chip: clears the other chips' parts and keeps the rest.
 *
 * @param {string} query
 * @param {string} [folderPath]
 * @returns {string}
 */
export function clearChips(query, folderPath = '') {
    let next = setTitlesChip(query, false);
    next = setChecklistChip(next, false);
    if (folderPath) next = setFolderChip(next, folderPath, false);
    return next;
}

/**
 * Add `tag:<name>` (a tag chip on a result), unless the query already asks for that tag.
 *
 * @param {string} query
 * @param {string} name canonical tag name
 * @returns {string}
 */
export function addTagPart(query, name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    if (!wanted) return String(query ?? '');
    const tokens = tokenizeSearchQuery(query);
    if (tokens.some((token) => token.prefix === 'tag' && !token.negated && token.value.trim().toLowerCase() === wanted)) {
        return rebuild(tokens);
    }
    tokens.push({ raw: `tag:${quoteSearchValue(wanted)}` });
    return rebuild(tokens);
}

/**
 * The `in:` path of a folder: its names from the top level, led by the
 * space's name for a space folder, so the part names that folder and no
 * other. A space's top level is the space's name alone.
 *
 * @param {{ spaceName?: string|null, segments?: string[] }} location
 * @returns {string}
 */
export function folderSearchPath({ spaceName = null, segments = [] } = {}) {
    return [...(spaceName ? [spaceName] : []), ...segments].join('/');
}

/** The rows of the "Search syntax" help, in the order of §4. */
export const SEARCH_SYNTAX = Object.freeze([
    { part: 'word', meaning: 'Title or text contains it', example: 'budget' },
    { part: '"a phrase"', meaning: 'Title or text contains the exact phrase', example: '"quarterly review"' },
    { part: 'title:', meaning: 'The title contains the word or phrase', example: 'title:"team sync"' },
    { part: 'in:', meaning: 'In that folder and below; a space name may lead', example: 'in:"Acme Team/Contracts"' },
    { part: 'is:checklist', meaning: 'Has at least one checklist item', example: 'is:checklist' },
    { part: 'tag:', meaning: 'Carries the tag (case ignored)', example: 'tag:urgent' },
    { part: 'prop:', meaning: 'A front matter property; also word_count, created_on, modified_on', example: 'prop:status=draft' },
    { part: '-', meaning: 'Before any part: must not match', example: '-tag:archived' },
    { part: 'in:Trash', meaning: 'Trash is left out unless you name it', example: 'in:Trash' },
]);
