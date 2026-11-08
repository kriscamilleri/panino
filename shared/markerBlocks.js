/**
 * Marker blocks: Markdown that Panino owns, stored between two comments, the pattern the
 * Odoo sales order blocks introduced (docs/specs/shipped/odoo-sales-order-blocks.md) and
 * the table of contents uses (docs/specs/active/editor-toc-and-internal-links.md §4.8):
 *
 *     <!-- ns:name {"v":1,…} -->
 *     …text Panino writes…
 *     <!-- /ns:name -->
 *
 * Pure functions on `{ value, selectionStart, selectionEnd }` editor states, so the
 * editor applies them through `transformText` as one undo step.
 *
 * Markers count only alone on a line at column 0, outside fenced code and outside
 * front matter. (Indented lines can never be markers, which also leaves out indented
 * code and anything nested in a list or quote.) A block is damaged when its JSON does not
 * parse, or unclosed when its closing marker is missing; such blocks are listed and never
 * rewritten. Everything is a single linear pass over the lines: no regular expression
 * runs on a whole line of Document text.
 */

import { findFrontMatterBlock } from './frontMatter.js';

/** Longest marker line read; anything longer is not a marker. */
const MAX_MARKER_LINE = 8192;
const NAME_CHARS = /^[a-z][a-z0-9._-]{0,63}:[a-z][a-z0-9._-]{0,63}$/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const ENTITY_LIKE = /^&(?:#\d{1,8}|#x[\da-f]{1,8}|[a-z][a-z\d]{0,31});/i;

/**
 * @typedef {object} MarkerLine
 * @property {'open'|'close'} kind
 * @property {string} name e.g. `panino:toc`
 * @property {string|null} json the text after the name on an opening marker, or null
 */

/**
 * Read one line as a marker.
 *
 * @param {string} line without its line break (a trailing `\r` is ignored)
 * @returns {MarkerLine|null}
 */
export function parseMarkerLine(line) {
    if (typeof line !== 'string' || line.length > MAX_MARKER_LINE || !line.startsWith('<!--')) return null;
    let end = line.length;
    while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t' || line[end - 1] === '\r')) end -= 1;
    if (end < 7 || line.slice(end - 3, end) !== '-->') return null;
    const inner = line.slice(4, end - 3).trim();
    if (!inner) return null;
    if (inner[0] === '/') {
        const name = inner.slice(1);
        return NAME_CHARS.test(name) ? { kind: 'close', name, json: null } : null;
    }
    let split = 0;
    while (split < inner.length && inner[split] !== ' ' && inner[split] !== '\t') split += 1;
    const name = inner.slice(0, split);
    if (!NAME_CHARS.test(name)) return null;
    const rest = inner.slice(split).trim();
    return { kind: 'open', name, json: rest || null };
}

/**
 * The opening fence of a fenced code block on this line, or null: up to three spaces,
 * then three or more backticks or tildes (an info string after backticks has none).
 *
 * @param {string} line
 * @returns {{ char: string, length: number }|null}
 */
function fenceOpening(line) {
    let i = 0;
    while (i < 3 && line[i] === ' ') i += 1;
    const char = line[i];
    if (char !== '`' && char !== '~') return null;
    let j = i;
    while (line[j] === char) j += 1;
    const length = j - i;
    if (length < 3) return null;
    if (char === '`' && line.indexOf('`', j) !== -1) return null;
    return { char, length };
}

/** Whether a line closes the given fence. */
function closesFence(line, fence) {
    let i = 0;
    while (i < 3 && line[i] === ' ') i += 1;
    let j = i;
    while (line[j] === fence.char) j += 1;
    if (j - i < fence.length) return false;
    return line.slice(j).trim() === '';
}

/**
 * Every line of a text with its offsets, and whether it can hold a marker.
 *
 * @param {string} text
 * @returns {{ start: number, end: number, text: string, markable: boolean }[]}
 *   `end` is the offset of the line break (or the text's end)
 */
export function scanLines(text) {
    const value = String(text ?? '');
    const lines = [];
    let offset = 0;
    for (const raw of value.split('\n')) {
        lines.push({ start: offset, end: offset + raw.length, text: raw, markable: true });
        offset += raw.length + 1;
    }
    const front = findFrontMatterBlock(lines.map((line) => line.text.endsWith('\r') ? line.text.slice(0, -1) : line.text));
    if (front.start !== -1) {
        for (let i = front.start; i <= front.end; i += 1) lines[i].markable = false;
    }
    let fence = null;
    for (let i = front.end + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (fence) {
            line.markable = false;
            if (closesFence(line.text, fence)) fence = null;
            continue;
        }
        const opening = fenceOpening(line.text);
        if (opening) {
            fence = opening;
            line.markable = false;
        }
    }
    return lines;
}

/**
 * @typedef {object} MarkerBlock
 * @property {string} name
 * @property {number} start offset of the opening marker line
 * @property {number} end offset just after the closing marker line's text; for an
 *   unclosed block, the end of its opening marker line
 * @property {number} bodyStart offset of the first line after the opening marker
 * @property {number} bodyEnd offset of the closing marker line (equal to bodyStart when empty)
 * @property {string} raw `text.slice(start, end)`
 * @property {string|null} jsonText the marker's settings text, or null for a bare marker
 * @property {unknown} json the parsed settings; `undefined` when they did not parse,
 *   null for a bare marker
 * @property {boolean} closed
 */

/**
 * The marker blocks in a text, in order.
 *
 * @param {string} text
 * @param {string|null} [name] e.g. `panino:toc`; null finds blocks of every name
 * @returns {MarkerBlock[]}
 */
export function findMarkerBlocks(text, name = null) {
    const value = String(text ?? '');
    if (value.indexOf('<!--') === -1) return [];
    const lines = scanLines(value);
    const blocks = [];
    let open = null;
    const finish = (block, end, bodyEnd, closed) => {
        let json = null;
        if (block.jsonText !== null) {
            try {
                json = JSON.parse(block.jsonText);
            } catch {
                json = undefined;
            }
        }
        blocks.push({
            name: block.name,
            start: block.start,
            end,
            bodyStart: block.bodyStart,
            bodyEnd,
            raw: value.slice(block.start, end),
            jsonText: block.jsonText,
            json,
            closed,
        });
    };
    for (const line of lines) {
        if (!line.markable || line.text[0] !== '<') continue;
        const marker = parseMarkerLine(line.text);
        if (!marker || (name && marker.name !== name)) continue;
        if (open) {
            if (marker.kind === 'close' && marker.name === open.name) {
                const end = line.text.endsWith('\r') ? line.end - 1 : line.end;
                finish(open, end, line.start, true);
                open = null;
                continue;
            }
            if (marker.kind === 'open') {
                // An unclosed block ends where the next one starts.
                finish(open, open.lineEnd, open.bodyStart, false);
                open = null;
            }
        }
        if (!open && marker.kind === 'open') {
            open = {
                name: marker.name,
                start: line.start,
                lineEnd: line.text.endsWith('\r') ? line.end - 1 : line.end,
                bodyStart: Math.min(line.end + 1, value.length),
                jsonText: marker.json,
            };
        }
    }
    if (open) finish(open, open.lineEnd, open.bodyStart, false);
    return blocks;
}

/**
 * Where an insertion asked for at `offset` can go: not inside front matter, a fenced
 * code block or a marker block (of any name). Returns an offset at the end of a line.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
export function safeInsertionOffset(text, offset) {
    const value = String(text ?? '');
    let at = Math.min(Math.max(Number(offset) || 0, 0), value.length);
    const lineEnd = value.indexOf('\n', at);
    at = lineEnd === -1 ? value.length : lineEnd;
    const lines = scanLines(value);
    const blocks = findMarkerBlocks(value);
    // A block can sit right after a fence and the reverse, so settle in a few rounds.
    for (let round = 0; round < 4; round += 1) {
        const before = at;
        let index = lines.findIndex((line) => at >= line.start && at <= line.end);
        if (index !== -1 && !lines[index].markable) {
            // Past the rest of the front matter or fence, closing line included.
            while (index + 1 < lines.length && !lines[index + 1].markable) index += 1;
            at = lines[index].end;
        }
        for (const block of blocks) {
            if (at >= block.start && at < block.end) at = block.end;
        }
        if (at === before) break;
    }
    return at;
}

/**
 * Insert Markdown as its own paragraph after the line holding `position`, with a blank
 * line before and after it (Odoo's `insertBlock`).
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {string} markdown
 * @param {{ position?: number }} [options] defaults to the selection's end
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }} the caret
 *   just after the inserted text
 */
export function insertMarkerBlock(state, markdown, { position } = {}) {
    const value = String(state?.value ?? '');
    const requested = position ?? state?.selectionEnd ?? value.length;
    const at = safeInsertionOffset(value, requested);
    const before = value.slice(0, at);
    const after = value.slice(at);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const inserted = `${lead}${markdown}${after === '' ? '\n' : trail}`;
    const caret = before.length + lead.length + markdown.length;
    return { value: `${before}${inserted}${after}`, selectionStart: caret, selectionEnd: caret };
}

/**
 * Rewrite the bodies of the closed, undamaged blocks of one name. Text outside them is
 * kept byte for byte. The selection moves with the text; one inside a rewritten block
 * goes to that block's end.
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {string} name
 * @param {(block: MarkerBlock, index: number) => string|null} render the new body for a
 *   block (each line ending in `\n`), or null to leave it
 * @returns {{ state: { value: string, selectionStart: number, selectionEnd: number }, changed: boolean, damaged: MarkerBlock[] }}
 */
export function replaceMarkerBlocks(state, name, render) {
    const value = String(state?.value ?? '');
    const blocks = findMarkerBlocks(value, name);
    const damaged = blocks.filter((block) => !block.closed || block.json === undefined);
    let out = '';
    let cursor = 0;
    const edits = [];
    blocks.forEach((block, index) => {
        if (!block.closed || block.json === undefined) return;
        const body = render(block, index);
        if (body === null || body === undefined) return;
        const current = value.slice(block.bodyStart, block.bodyEnd);
        if (body === current) return;
        out += value.slice(cursor, block.bodyStart) + body;
        cursor = block.bodyEnd;
        edits.push({ start: block.bodyStart, end: block.bodyEnd, length: body.length, blockEnd: block.end });
    });
    if (!edits.length) {
        return { state: { value, selectionStart: state?.selectionStart ?? 0, selectionEnd: state?.selectionEnd ?? 0 }, changed: false, damaged };
    }
    out += value.slice(cursor);
    const move = (position) => {
        let shift = 0;
        for (const edit of edits) {
            if (position <= edit.start) break;
            const delta = edit.length - (edit.end - edit.start);
            if (position < edit.end) return edit.start + edit.length + shift;
            shift += delta;
        }
        return position + shift;
    };
    return {
        state: { value: out, selectionStart: move(state?.selectionStart ?? 0), selectionEnd: move(state?.selectionEnd ?? 0) },
        changed: true,
        damaged,
    };
}

/**
 * Remove a block with its markers, and the blank line it leaves. Works on an unclosed or
 * damaged block too (it then removes the opening marker line).
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {MarkerBlock} block as found in `state.value`
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }}
 */
export function removeMarkerBlock(state, block) {
    const value = String(state?.value ?? '');
    let start = block.start;
    let end = block.end;
    if (value[end] === '\r') end += 1;
    if (value[end] === '\n') end += 1;
    // Collapse the blank line left between the text before and after.
    if (value.slice(end, end + 1) === '\n' && (start === 0 || value.slice(start - 2, start) === '\n\n')) end += 1;
    const length = end - start;
    const move = (position) => (position <= start ? position : position >= end ? position - length : start);
    return {
        value: value.slice(0, start) + value.slice(end),
        selectionStart: move(state?.selectionStart ?? 0),
        selectionEnd: move(state?.selectionEnd ?? 0),
    };
}

/**
 * Text made safe as inline Markdown, such as a link label: it can only ever be text.
 * - `\`, `[`, `]`, `*`, `` ` ``, `~`, `|` and `<` always;
 * - `_` only where it could open or close emphasis (`FURN_6667` stays as is);
 * - `&` only before something that would read as an entity;
 * - `{` only as the first of `{{`, as `&#123;`, so no `{{ variable }}` can form;
 * - line breaks become spaces.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function escapeInlineText(text) {
    const source = String(text ?? '');
    let out = '';
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1] ?? '';
        switch (char) {
            case '&':
                out += ENTITY_LIKE.test(source.slice(index, index + 44)) ? '&amp;' : '&';
                break;
            case '{':
                out += next === '{' ? '&#123;' : '{';
                break;
            case '_':
                out += ALPHANUMERIC.test(source[index - 1] ?? '') && ALPHANUMERIC.test(next) ? '_' : '\\_';
                break;
            case '\r':
            case '\n':
                out += ' ';
                break;
            case '\\':
            case '[':
            case ']':
            case '`':
            case '*':
            case '|':
            case '~':
            case '<':
                out += `\\${char}`;
                break;
            default:
                out += char;
        }
    }
    return out;
}

/**
 * JSON for a marker comment: `<` and `>` written as `<` and `>`, so the
 * comment can never close early.
 *
 * @param {object} config
 * @returns {string}
 */
export function markerJson(config) {
    return JSON.stringify(config).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}
