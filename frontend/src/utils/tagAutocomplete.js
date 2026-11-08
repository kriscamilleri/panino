/**
 * Where the caret is while typing a `tags:` value in the editor, and the edit
 * that accepts a suggestion (docs/specs/active/tag-system.md §5.4). Pure: the
 * `TagAutocomplete` component measures and renders.
 *
 * The caret counts as in a tag value when it is in the front matter block at
 * the top of the Document — after an opening `---` on the first non-blank line
 * and before a closing one, which need not be typed yet — and on:
 *   - the top-level `tags:` line, after the colon (`tags: wo|`), or in an inline
 *     list item there (`tags: [work, ur|`);
 *   - a `- ` item in the list under `tags:`.
 */
import { canonicalTagName } from '@panino/content-merge/front-matter';
import { FRONT_MATTER_SCAN_CHARS } from './documentMetadataIndex.js';

/**
 * @typedef {{ start: number, end: number, prefix: string, form: 'single'|'inline'|'list', existing: string[] }} TagCompletionContext
 */

function splitLines(text, offset) {
    const lines = [];
    let from = 0;
    while (from <= text.length) {
        const at = text.indexOf('\n', from);
        const to = at === -1 ? text.length : at;
        const raw = text.slice(from, to);
        lines.push({ start: offset + from, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw });
        if (at === -1) break;
        from = at + 1;
    }
    return lines;
}

function keyOf(line) {
    if (!line || line[0] === ' ' || line[0] === '\t' || line[0] === '-' || line[0] === '#') return null;
    const colon = line.indexOf(':');
    return colon > 0 ? line.slice(0, colon).trim().toLowerCase() : null;
}

function isListItem(text) {
    const trimmed = text.trim();
    return trimmed === '-' || trimmed.startsWith('- ');
}

function unquoted(text) {
    const trimmed = text.trim();
    if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.endsWith(trimmed[0])) {
        return trimmed.slice(1, -1);
    }
    return trimmed.replace(/^["']/, '');
}

function cutComment(text) {
    const at = text.indexOf(' #');
    return at === -1 ? text : text.slice(0, at);
}

/** Length of the token from `from` up to a delimiter (`,`, `]`, ` #`) or the end. */
function tokenEnd(text, from, inline) {
    let end = from;
    while (end < text.length) {
        const ch = text[end];
        if (inline && (ch === ',' || ch === ']')) break;
        if (ch === '#' && end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
            end -= 1;
            break;
        }
        end += 1;
    }
    while (end > from && (text[end - 1] === ' ' || text[end - 1] === '\t')) end -= 1;
    return end;
}

/**
 * The tag value being typed at the caret, or null when the caret is not in one.
 * @param {string} value the editor's text
 * @param {number} caret a collapsed selection's offset
 * @returns {TagCompletionContext|null}
 */
export function tagCompletionContext(value, caret) {
    if (typeof value !== 'string' || !Number.isInteger(caret) || caret < 0 || caret > value.length) return null;
    if (caret > FRONT_MATTER_SCAN_CHARS) return null;
    const lineEnd = value.indexOf('\n', caret);
    const head = value.slice(0, lineEnd === -1 ? value.length : lineEnd);
    const lines = splitLines(head, 0);

    let fence = 0;
    while (fence < lines.length && lines[fence].text.trim() === '') fence += 1;
    if (fence >= lines.length - 1 || lines[fence].text.trim() !== '---') return null;
    const current = lines.length - 1;
    for (let i = fence + 1; i <= current; i += 1) {
        if (lines[i].text.trim() === '---') return null;
    }

    const line = lines[current];
    const column = caret - line.start;
    if (column > line.text.length) return null;

    // The `tags:` line itself.
    if (keyOf(line.text) === 'tags') {
        const colon = line.text.indexOf(':');
        if (column <= colon) return null;
        let start = colon + 1;
        while (start < line.text.length && line.text[start] === ' ') start += 1;
        if (column < start) return null;
        const rest = line.text.slice(start);
        if (rest.startsWith('[')) {
            const close = line.text.indexOf(']', start);
            if (close !== -1 && column > close) return null;
            let itemStart = start + 1;
            for (let i = start + 1; i < column; i += 1) {
                if (line.text[i] === ',') itemStart = i + 1;
            }
            while (itemStart < column && line.text[itemStart] === ' ') itemStart += 1;
            const items = line.text.slice(start + 1, close === -1 ? line.text.length : close).split(',');
            const end = tokenEnd(line.text, column, true);
            return {
                start: line.start + itemStart,
                end: line.start + Math.max(end, column),
                prefix: unquoted(line.text.slice(itemStart, column)),
                form: 'inline',
                existing: existingNames(items, unquoted(line.text.slice(itemStart, Math.max(end, column)))),
            };
        }
        if (rest.trim().startsWith('#')) return null;
        const end = tokenEnd(line.text, column, false);
        return {
            start: line.start + start,
            end: line.start + Math.max(end, column),
            prefix: unquoted(line.text.slice(start, column)),
            form: 'single',
            existing: [],
        };
    }

    // A `- ` item under `tags:`.
    if (!isListItem(line.text)) return null;
    const dash = line.text.indexOf('-');
    const start = dash + 2;
    if (line.text[dash + 1] !== ' ' || column < start) return null;
    const items = [];
    let owner = null;
    for (let i = current - 1; i > fence; i -= 1) {
        const text = lines[i].text;
        const trimmed = text.trim();
        if (!trimmed || trimmed[0] === '#') continue;
        if (isListItem(text)) {
            items.push(trimmed.slice(1));
            continue;
        }
        owner = keyOf(text);
        if (owner === 'tags' && cutComment(text.slice(text.indexOf(':') + 1)).trim() !== '') owner = null;
        break;
    }
    if (owner !== 'tags') return null;
    // Items below the caret's line belong to the same list.
    const below = value.slice(lineEnd === -1 ? value.length : lineEnd + 1, FRONT_MATTER_SCAN_CHARS);
    for (const next of splitLines(below, 0)) {
        if (!isListItem(next.text)) break;
        items.push(next.text.trim().slice(1));
    }
    const end = tokenEnd(line.text, column, false);
    return {
        start: line.start + start,
        end: line.start + Math.max(end, column),
        prefix: unquoted(line.text.slice(start, column)),
        form: 'list',
        existing: existingNames(items, null),
    };
}

function existingNames(items, currentItem) {
    const names = new Set();
    let skippedCurrent = currentItem === null;
    for (const item of items) {
        const name = canonicalTagName(unquoted(cutComment(item)));
        if (!name) continue;
        if (!skippedCurrent && name === canonicalTagName(currentItem)) {
            skippedCurrent = true;
            continue;
        }
        names.add(name);
    }
    return [...names];
}

// Characters that would make YAML read a plain value as something else, or
// end an item of an inline list early.
const NEEDS_QUOTES = /[:#,[\]{}&*!|>'"%@`]|^[-?\s]|\s$/;

/**
 * How to write a tag name as a YAML value: as is, or quoted when YAML would
 * otherwise misread it.
 * @param {string} label
 * @returns {string}
 */
export function yamlTagValue(label) {
    const text = String(label ?? '');
    if (!NEEDS_QUOTES.test(text)) return text;
    return text.includes('"') ? `'${text}'` : `"${text}"`;
}

/**
 * The editor state after accepting a suggestion: the typed part of the value
 * replaced with the tag, the caret after it.
 * @param {string} value
 * @param {TagCompletionContext} context
 * @param {string} label the tag's display spelling
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }}
 */
export function applyTagCompletion(value, context, label) {
    const text = yamlTagValue(label);
    const next = value.slice(0, context.start) + text + value.slice(context.end);
    const caret = context.start + text.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
}
