/**
 * The table of contents (docs/specs/active/editor-toc-and-internal-links.md §4): a stored
 * snapshot of the Document's headings between two markers,
 *
 *     <!-- panino:toc {"v":1,"min":2,"max":3} -->
 *     **Contents**
 *
 *     - 1 [Introduction](#introduction)
 *       - 1.1 [Background](#background)
 *     <!-- /panino:toc -->
 *
 * inserted on request and rewritten only by Refresh. Pure functions on editor states
 * (`{ value, selectionStart, selectionEnd }`), applied through `transformText` so each
 * edit is one undo step. Headings come from the MarkdownIt token stream of the text the
 * Preview renders (front matter removed, `{{ variables }}` applied), never from regular
 * expressions, so fences, setext headings and raw HTML are handled the way the Preview
 * handles them.
 */

import MarkdownIt from 'markdown-it';
import { applyDocumentVariables, createDocumentRenderer } from './markdownRender.js';
import { findFrontMatterBlock } from './frontMatter.js';
import {
    escapeInlineText,
    findMarkerBlocks,
    insertMarkerBlock,
    markerJson,
    removeMarkerBlock,
    replaceMarkerBlocks,
} from './markerBlocks.js';
import { DEFAULT_TOC_TITLE, MAX_TOC_TITLE_LENGTH, TOC_MARKER_NAME, parseTocConfig } from './tocMarker.js';

export { DEFAULT_TOC_TITLE, MAX_TOC_TITLE_LENGTH, TOC_MARKER_NAME, parseTocConfig, tocWrapper } from './tocMarker.js';

/** The body of a table for a Document without matching headings. */
export const EMPTY_TOC_TEXT = '*No headings yet.*';
const OPEN_PREFIX = `<!-- ${TOC_MARKER_NAME}`;
const CLOSE_MARKER = `<!-- /${TOC_MARKER_NAME} -->`;

let outlineRenderer = null;

/**
 * The headings of a Document as the Preview renders them.
 *
 * @param {string} text the whole Document, front matter included
 * @param {object} [variables] for `applyDocumentVariables` (globals, now, formatters)
 * @returns {import('./documentOutline.js').OutlineHeading[]}
 */
export function documentOutline(text, variables = {}) {
    if (!outlineRenderer) outlineRenderer = createDocumentRenderer();
    const env = {};
    outlineRenderer.parse(applyDocumentVariables(String(text ?? ''), variables), env);
    return env.outline || [];
}

/**
 * The levels a table lists: its own, or the adaptive default (H2–H3, or H1–H2 when the
 * Document has several level-1 headings).
 *
 * @param {import('./tocMarker.js').TocConfig} config
 * @param {import('./documentOutline.js').OutlineHeading[]} outline
 * @returns {{ min: number, max: number }}
 */
export function resolveTocLevels(config, outline) {
    const h1s = outline.filter((heading) => heading.listed && heading.level === 1).length;
    const adaptiveMin = h1s > 1 ? 1 : 2;
    let min = config?.min ?? null;
    let max = config?.max ?? null;
    if (min === null) min = max !== null ? Math.min(adaptiveMin, max) : adaptiveMin;
    if (max === null) max = Math.min(min + 1, 6);
    return { min, max };
}

/**
 * The text between a table's markers, each line ending in `\n`.
 *
 * @param {import('./documentOutline.js').OutlineHeading[]} outline
 * @param {import('./tocMarker.js').TocConfig} config
 * @returns {string}
 */
export function buildTocMarkdown(outline, config) {
    const { min, max } = resolveTocLevels(config, outline);
    const numbered = config?.numbered !== false;
    const title = String(config?.title ?? DEFAULT_TOC_TITLE).trim();
    const lines = [];
    if (title) lines.push(`**${escapeInlineText(title)}**`, '');
    const entries = outline.filter((heading) => heading.listed && heading.level >= min && heading.level <= max);
    if (!entries.length) {
        lines.push(EMPTY_TOC_TEXT);
        return lines.map((line) => `${line}\n`).join('');
    }
    // Depth follows the list's structure, not the heading level: a skipped level
    // (H2 → H4) nests one step deeper than its parent, never more.
    const stack = [];
    const counters = [];
    for (const heading of entries) {
        while (stack.length && stack[stack.length - 1] >= heading.level) stack.pop();
        const depth = stack.length;
        stack.push(heading.level);
        counters.length = depth + 1;
        counters[depth] = (counters[depth] || 0) + 1;
        const label = escapeInlineText(heading.text) || 'Untitled heading';
        const number = numbered ? `${counters.join('.')} ` : '';
        lines.push(`${'  '.repeat(depth)}- ${number}[${label}](#${heading.slug})`);
    }
    return lines.map((line) => `${line}\n`).join('');
}

/**
 * The opening marker for a set of options. `v`, `min` and `max` always; `numbered` and
 * `title` only when they differ from the default.
 *
 * @param {{ min: number, max: number, numbered?: boolean, title?: string }} options
 * @returns {string}
 */
export function tocMarkerLine({ min, max, numbered = true, title = DEFAULT_TOC_TITLE }) {
    const config = { v: 1, min, max };
    if (numbered === false) config.numbered = false;
    // Capped as the reader caps it, so a written marker never reads back as damaged.
    if (title !== DEFAULT_TOC_TITLE) config.title = [...String(title ?? '')].slice(0, MAX_TOC_TITLE_LENGTH).join('').slice(0, MAX_TOC_TITLE_LENGTH);
    return `${OPEN_PREFIX} ${markerJson(config)} -->`;
}

/**
 * Lines compared with trailing whitespace ignored.
 * @param {string} text
 */
function comparable(text) {
    return String(text).split('\n').map((line) => line.trimEnd()).join('\n').trimEnd();
}

/**
 * @typedef {object} TocBlock
 * @property {import('./markerBlocks.js').MarkerBlock} block
 * @property {import('./tocMarker.js').TocConfig|null} config null when damaged
 * @property {'damaged'|'unclosed'|null} problem
 */

/**
 * The tables in a text.
 *
 * @param {string} text
 * @returns {TocBlock[]}
 */
let blockParser = null;

/**
 * The offsets of the marker blocks markdown-it reads as HTML at the top level,
 * which is what the Preview and PDF render as a table. The line scan in
 * markerBlocks.js approximates CommonMark (lists, lazy lines, indented
 * fences); this makes sure a table is only listed, refreshed or rewritten when
 * the renderer agrees it is one, so an edit never lands in what renders as
 * code. Only Documents with a marker pay for the parse.
 * @param {string} value
 * @param {Array<{ start: number }>} blocks
 * @returns {Set<number>}
 */
function renderedBlockStarts(value, blocks) {
    if (!blocks.length) return new Set();
    if (!blockParser) blockParser = new MarkdownIt({ html: true });
    const lines = new Set();
    for (const token of blockParser.parse(value, {})) {
        if (token.type === 'html_block' && token.level === 0 && token.map && token.content.startsWith(OPEN_PREFIX)) {
            lines.add(token.map[0]);
        }
    }
    const starts = new Set();
    let line = 0;
    let at = 0;
    for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
        for (let i = value.indexOf('\n', at); i !== -1 && i < block.start; i = value.indexOf('\n', i + 1)) {
            line += 1;
            at = i + 1;
        }
        if (lines.has(line)) starts.add(block.start);
    }
    return starts;
}

export function findTocs(text) {
    const value = String(text ?? '');
    if (value.indexOf(OPEN_PREFIX) === -1) return [];
    const blocks = findMarkerBlocks(value, TOC_MARKER_NAME);
    const rendered = renderedBlockStarts(value, blocks);
    return blocks.filter((block) => rendered.has(block.start)).map((block) => {
        const config = block.json === undefined ? null : parseTocConfig(block.json);
        const problem = !block.closed ? 'unclosed' : config ? null : 'damaged';
        return { block, config, problem };
    });
}

/**
 * Where the tables of a text stand.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {object} [options.variables] for `applyDocumentVariables`
 * @param {Array<object>} [options.outline] an outline already made from this text
 * @returns {{ count: number, damaged: TocBlock[], stale: boolean }}
 */
export function tocStatus(text, { variables = {}, outline = null } = {}) {
    const tocs = findTocs(text);
    if (!tocs.length) return { count: 0, damaged: [], stale: false };
    const value = String(text);
    const headings = outline || documentOutline(value, variables);
    let stale = false;
    for (const toc of tocs) {
        if (toc.problem) continue;
        const current = value.slice(toc.block.bodyStart, toc.block.bodyEnd);
        if (comparable(current) !== comparable(buildTocMarkdown(headings, toc.config))) {
            stale = true;
            break;
        }
    }
    return { count: tocs.length, damaged: tocs.filter((toc) => toc.problem), stale };
}

/**
 * Whether any closed, valid table differs from what Refresh would write.
 *
 * @param {string} text
 * @param {object} [options] as for `tocStatus`
 * @returns {boolean}
 */
export function isTocStale(text, options = {}) {
    return tocStatus(text, options).stale;
}

/**
 * Where Insert puts a table without a caret (phone, or an editor that never had
 * focus): after a leading level-1 heading, else at the top of the body.
 *
 * @param {string} value
 * @returns {{ offset: number, atStart: boolean }}
 */
function defaultInsertion(value) {
    const lines = value.split('\n');
    const front = findFrontMatterBlock(lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)));
    let index = front.end + 1;
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
    const bodyStart = { index, offset };
    while (index < lines.length && lines[index].trim() === '') {
        offset += lines[index].length + 1;
        index += 1;
    }
    if (index < lines.length) {
        const line = lines[index];
        let i = 0;
        while (i < 3 && line[i] === ' ') i += 1;
        const atx = line[i] === '#' && (line[i + 1] === ' ' || line[i + 1] === '\t' || line[i + 1] === undefined || line[i + 1] === '\r');
        if (atx) return { offset: offset + line.length, atStart: false };
        const next = lines[index + 1];
        if (next !== undefined && line.trim() && /^ {0,3}=+[ \t\r]*$/.test(next)) {
            return { offset: offset + line.length + 1 + next.length, atStart: false };
        }
    }
    if (front.start !== -1) {
        return { offset: Math.max(0, bodyStart.offset - 1), atStart: false };
    }
    return { offset: 0, atStart: true };
}

/**
 * Insert a table with the adaptive levels (or the given options).
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {object} [options]
 * @param {boolean} [options.atCaret] after the caret's line (desktop with focus);
 *   otherwise after a leading H1, or at the top of the body
 * @param {object} [options.variables]
 * @param {{ min?: number, max?: number, numbered?: boolean, title?: string }} [options.settings]
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }}
 */
export function insertToc(state, { atCaret = false, variables = {}, settings = {} } = {}) {
    const value = String(state?.value ?? '');
    const outline = documentOutline(value, variables);
    const levels = resolveTocLevels({ min: settings.min ?? null, max: settings.max ?? null }, outline);
    const options = {
        min: levels.min,
        max: levels.max,
        numbered: settings.numbered !== false,
        title: settings.title === undefined ? DEFAULT_TOC_TITLE : settings.title,
    };
    const block = `${tocMarkerLine(options)}\n${buildTocMarkdown(outline, options)}${CLOSE_MARKER}`;
    if (atCaret) return insertMarkerBlock(state, block);
    const { offset, atStart } = defaultInsertion(value);
    if (atStart) {
        const rest = value.replace(/^\n+/, '');
        const caret = block.length;
        return { value: rest ? `${block}\n\n${rest}` : `${block}\n`, selectionStart: caret, selectionEnd: caret };
    }
    return insertMarkerBlock(state, block, { position: offset });
}

/**
 * Rewrite every closed, valid table. Text outside the tables is unchanged.
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {{ variables?: object }} [options]
 * @returns {{ state: object, changed: boolean, count: number, damaged: TocBlock[] }}
 */
export function refreshTocs(state, { variables = {} } = {}) {
    const value = String(state?.value ?? '');
    const tocs = findTocs(value);
    const damaged = tocs.filter((toc) => toc.problem);
    if (!tocs.length) return { state: { ...state, value }, changed: false, count: 0, damaged };
    const outline = documentOutline(value, variables);
    const listed = new Set(tocs.map((toc) => toc.block.start));
    const result = replaceMarkerBlocks({ ...state, value }, TOC_MARKER_NAME, (block) => {
        if (!listed.has(block.start)) return null; // not a table where it renders
        const config = parseTocConfig(block.json);
        if (!config) return null;
        const body = buildTocMarkdown(outline, config);
        const current = value.slice(block.bodyStart, block.bodyEnd);
        // CRLF is normalized inside the rewritten block only.
        return comparable(current) === comparable(body) ? null : body;
    });
    return { state: result.state, changed: result.changed, count: tocs.length, damaged };
}

/**
 * Give one table new options: rewrite its marker, then refresh it.
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {number} index which table, in Document order
 * @param {{ min: number, max: number, numbered: boolean, title: string }} options
 * @param {{ variables?: object }} [extra]
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }|null} null
 *   when there is no such table or it is unclosed
 */
export function applyTocOptions(state, index, options, { variables = {} } = {}) {
    const value = String(state?.value ?? '');
    const toc = findTocs(value)[index];
    if (!toc || !toc.block.closed) return null;
    const lineEnd = value.indexOf('\n', toc.block.start);
    const markerEnd = lineEnd === -1 ? value.length : (value[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd);
    const marker = tocMarkerLine(options);
    const delta = marker.length - (markerEnd - toc.block.start);
    const move = (position) => (position > toc.block.start ? Math.max(toc.block.start, position + delta) : position);
    const rewritten = {
        value: value.slice(0, toc.block.start) + marker + value.slice(markerEnd),
        selectionStart: move(state?.selectionStart ?? 0),
        selectionEnd: move(state?.selectionEnd ?? 0),
    };
    // Refresh only this table: the others keep their text until Refresh.
    const outline = documentOutline(rewritten.value, variables);
    const target = findTocs(rewritten.value)[index];
    if (!target?.config) return rewritten;
    const body = buildTocMarkdown(outline, target.config);
    return replaceMarkerBlocks(rewritten, TOC_MARKER_NAME, (block) => (block.start === target.block.start ? body : null)).state;
}

/**
 * Delete a table with its markers.
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {number} [index] which table; the first by default
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }|null}
 */
export function removeToc(state, index = 0) {
    const toc = findTocs(state?.value)[index];
    return toc ? removeMarkerBlock(state, toc.block) : null;
}

/**
 * The options a table was written with, resolved against the Document, for the
 * Options form.
 *
 * @param {string} text
 * @param {number} [index]
 * @param {object} [variables]
 * @returns {{ min: number, max: number, numbered: boolean, title: string }|null}
 */
export function tocOptions(text, index = 0, variables = {}) {
    const toc = findTocs(text)[index];
    if (!toc) return null;
    const config = toc.config || { min: null, max: null, numbered: true, title: DEFAULT_TOC_TITLE };
    const levels = resolveTocLevels(config, documentOutline(text, variables));
    return { ...levels, numbered: config.numbered, title: config.title };
}

/**
 * Text ranges to leave out of a plain-text snippet: every table, markers included.
 *
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
export function tocRanges(text) {
    return findTocs(text).map(({ block }) => ({ start: block.start, end: block.end }));
}
