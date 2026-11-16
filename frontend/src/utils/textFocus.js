/**
 * Markdown-aware focus regions for typewriter mode's dimming
 * (docs/specs/active/typewriter-mode.md §7). Pure functions over the editor
 * text and character offsets; nothing here touches the DOM.
 *
 * A region is `{ start, end }` in character offsets, `end` exclusive. An empty
 * region (`start === end`) means "nothing is in focus": every block is dimmed.
 */

/** Lines scanned in each direction from the caret before a block is cut off. */
export const BLOCK_LINE_LIMIT = 500;
/** Characters on either side of the caret that sentence detection looks at. */
export const SENTENCE_WINDOW = 2000;

const BLANK = /^[ \t]*$/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const PAGEBREAK = /^[ \t]*\\pagebreak[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const BARE_QUOTE = /^ {0,3}>[ \t]*$/;
const LIST = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const FRONT_MATTER_OPEN = /^---[ \t]*$/;
const FRONT_MATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/** Kinds whose sentence focus is the caret's whole line (§7.3 rule 1). */
const SINGLE_UNIT_KINDS = new Set(['heading', 'table', 'code', 'frontmatter', 'break']);
/** A line-leading blockquote and list marker, replaced by spaces before segmenting. */
const LINE_PREFIX = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;
const INLINE_CODE = /`[^`\n]*`/g;
const LINK_DESTINATION = /\]\([^)\n]*\)/g;
const ENDS_WITH_TERMINATOR = /[.!?…。！？]["'”’)\]」』]*$/;
const WHITESPACE = /\s/;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The offset where each logical line starts.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
}

/**
 * The logical line holding an offset (binary search). An offset just after a
 * `\n` is on the next line.
 *
 * @param {number[]} starts from lineStarts
 * @param {number} offset
 * @returns {number}
 */
export function lineIndexAt(starts, offset) {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= offset) low = mid;
        else high = mid - 1;
    }
    return low;
}

/**
 * Everything about a text that does not depend on the caret: line starts,
 * fenced code ranges and the front matter. Built once per content change so
 * that each caret move is a few binary searches.
 *
 * @param {string} text
 * @returns {{ text: string, starts: number[], fences: Array<{ open: number, close: number }>, frontMatterEnd: number }}
 *   `close` is the closing fence line, or -1 for a fence left open to the end;
 *   `frontMatterEnd` is the closing line of the front matter, or -1.
 */
export function analyzeText(text) {
    const value = String(text ?? '');
    const starts = lineStarts(value);
    const count = starts.length;
    const lineAt = (i) => value.slice(starts[i], i + 1 < count ? starts[i + 1] - 1 : value.length);

    let frontMatterEnd = -1;
    if (count > 1 && FRONT_MATTER_OPEN.test(lineAt(0))) {
        for (let i = 1; i < count; i += 1) {
            const first = value.charCodeAt(starts[i]);
            if ((first === 45 || first === 46) && FRONT_MATTER_CLOSE.test(lineAt(i))) {
                frontMatterEnd = i;
                break;
            }
        }
    }

    const fences = [];
    let open = null;
    for (let i = frontMatterEnd + 1; i < count; i += 1) {
        // Only lines starting (after up to three spaces) with ` or ~ can be fences.
        let at = starts[i];
        const limit = Math.min(at + 3, value.length);
        while (at < limit && value.charCodeAt(at) === 32) at += 1;
        const code = value.charCodeAt(at);
        if (code !== 96 && code !== 126) continue;
        const match = FENCE.exec(lineAt(i));
        if (!match) continue;
        const run = match[1];
        if (open) {
            if (run[0] === open.char && run.length >= open.length && BLANK.test(match[2])) {
                fences.push({ open: open.line, close: i });
                open = null;
            }
        } else if (!(run[0] === '`' && match[2].includes('`'))) {
            open = { char: run[0], length: run.length, line: i };
        }
    }
    if (open) fences.push({ open: open.line, close: -1 });

    return { text: value, starts, fences, frontMatterEnd };
}

function lineEnd(index, i) {
    return i + 1 < index.starts.length ? index.starts[i + 1] - 1 : index.text.length;
}

function lineText(index, i) {
    return index.text.slice(index.starts[i], lineEnd(index, i));
}

function fenceAt(index, i) {
    const { fences } = index;
    let low = 0;
    let high = fences.length - 1;
    let found = null;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (fences[mid].open <= i) {
            found = fences[mid];
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    if (!found) return null;
    const last = found.close === -1 ? index.starts.length - 1 : found.close;
    return i <= last ? found : null;
}

function region(index, startLine, endLine, kind) {
    return {
        start: index.starts[startLine],
        end: lineEnd(index, endLine),
        kind,
        startLine,
        endLine,
    };
}

function emptyRegion(index, offset, kind = 'blank') {
    const line = lineIndexAt(index.starts, offset);
    return { start: offset, end: offset, kind, startLine: line, endLine: line };
}

function indentWidth(prefix) {
    let width = 0;
    for (const char of prefix) width += char === '\t' ? 4 : 1;
    return width;
}

function inCodeOrFrontMatter(index, i) {
    return (index.frontMatterEnd >= 0 && i <= index.frontMatterEnd) || Boolean(fenceAt(index, i));
}

// Per text index, built on first use: the maximal runs of `|` lines and a
// running count of delimiter rows, so each line is answered in O(1) instead
// of scanning up to BLOCK_LINE_LIMIT neighbours (which made a long block of
// `|` lines without a delimiter row quadratic in the paragraph scan).
const tableRunIndex = new WeakMap();

function tableRunsOf(index) {
    let runs = tableRunIndex.get(index);
    if (runs) return runs;
    const count = index.starts.length;
    const runStart = new Int32Array(count).fill(-1);
    const runEnd = new Int32Array(count).fill(-1);
    const delimitersBefore = new Int32Array(count + 1);
    let open = -1;
    for (let j = 0; j < count; j += 1) {
        const text = lineText(index, j);
        const pipe = !inCodeOrFrontMatter(index, j) && text.includes('|') && !BLANK.test(text);
        const delimiter = pipe && text.includes('-') && TABLE_DELIMITER.test(text);
        delimitersBefore[j + 1] = delimitersBefore[j] + (delimiter ? 1 : 0);
        if (pipe) {
            if (open === -1) open = j;
            runStart[j] = open;
        } else if (open !== -1) {
            for (let k = open; k < j; k += 1) runEnd[k] = j - 1;
            open = -1;
        }
    }
    if (open !== -1) for (let k = open; k < count; k += 1) runEnd[k] = count - 1;
    runs = { runStart, runEnd, delimitersBefore };
    tableRunIndex.set(index, runs);
    return runs;
}

/**
 * A table line: it has a `|`, and its run of `|` lines (at most
 * BLOCK_LINE_LIMIT lines either side) contains a delimiter row. The line
 * itself only needs a `|`; its neighbours must be non-blank `|` lines outside
 * code and front matter.
 */
function tableRun(index, i) {
    if (!lineText(index, i).includes('|')) return null;
    const { runStart, runEnd, delimitersBefore } = tableRunsOf(index);
    // A `|` line that is itself excluded (blank-looking, in code) still looks at its neighbours.
    const above = runStart[i] !== -1 ? runStart[i] : (i > 0 && runStart[i - 1] !== -1 ? runStart[i - 1] : i);
    const below = runEnd[i] !== -1 ? runEnd[i] : (i + 1 < runEnd.length && runEnd[i + 1] !== -1 ? runEnd[i + 1] : i);
    const start = Math.max(above, i - BLOCK_LINE_LIMIT);
    const end = Math.min(below, i + BLOCK_LINE_LIMIT);
    const delimiters = delimitersBefore[end + 1] - delimitersBefore[start]
        + (runStart[i] === -1 && TABLE_DELIMITER.test(lineText(index, i)) && lineText(index, i).includes('-') ? 1 : 0);
    return delimiters > 0 ? { start, end } : null;
}

function startsOtherBlock(index, i) {
    const text = lineText(index, i);
    return ATX.test(text)
        || FENCE.test(text)
        || QUOTE.test(text)
        || THEMATIC.test(text)
        || PAGEBREAK.test(text)
        || LIST.test(text)
        || Boolean(tableRun(index, i));
}

/** A line that can be part of a plain paragraph. */
function isParagraphLine(index, i) {
    if (i < 0 || i >= index.starts.length) return false;
    if (inCodeOrFrontMatter(index, i)) return false;
    const text = lineText(index, i);
    return !BLANK.test(text) && !startsOtherBlock(index, i);
}

function codeRegion(index, fence, i, offset) {
    const count = index.starts.length;
    const firstContent = fence.open + 1;
    const lastContent = fence.close === -1 ? count - 1 : fence.close - 1;
    const isContent = (j) => j >= firstContent && j <= lastContent && !BLANK.test(lineText(index, j));

    let start;
    let end;
    if (i === fence.open) {
        start = i;
        end = i;
        while (isContent(end + 1) && end - i < BLOCK_LINE_LIMIT) end += 1;
    } else if (i === fence.close) {
        start = i;
        end = i;
        while (isContent(start - 1) && i - start < BLOCK_LINE_LIMIT) start -= 1;
    } else {
        if (!isContent(i)) return emptyRegion(index, offset);
        start = i;
        end = i;
        while (isContent(start - 1) && i - start < BLOCK_LINE_LIMIT) start -= 1;
        while (isContent(end + 1) && end - i < BLOCK_LINE_LIMIT) end += 1;
    }
    // A fence line belongs to the run next to it.
    if (start === firstContent) start = fence.open;
    if (end === lastContent && fence.close !== -1) end = fence.close;
    return region(index, start, end, 'code');
}

function listItemRegion(index, i) {
    const count = index.starts.length;
    let owner = -1;
    if (LIST.test(lineText(index, i))) {
        owner = i;
    } else {
        for (let j = i - 1; j >= 0 && i - j <= BLOCK_LINE_LIMIT; j -= 1) {
            const text = lineText(index, j);
            if (BLANK.test(text) || inCodeOrFrontMatter(index, j)) break;
            if (LIST.test(text) && !THEMATIC.test(text)) {
                owner = j;
                break;
            }
            if (ATX.test(text) || FENCE.test(text) || QUOTE.test(text) || THEMATIC.test(text) || PAGEBREAK.test(text)) break;
        }
    }
    if (owner < 0) return null;
    const indent = indentWidth(LIST.exec(lineText(index, owner))[1]);
    let end = owner;
    for (let k = owner + 1; k < count && k - owner <= BLOCK_LINE_LIMIT; k += 1) {
        const text = lineText(index, k);
        if (BLANK.test(text) || inCodeOrFrontMatter(index, k)) break;
        const marker = LIST.exec(text);
        if (marker && !THEMATIC.test(text)) {
            if (indentWidth(marker[1]) <= indent) break;
        } else if (ATX.test(text) || FENCE.test(text) || THEMATIC.test(text) || PAGEBREAK.test(text)) {
            break;
        }
        end = k;
    }
    return region(index, owner, Math.max(end, i), 'list');
}

/**
 * The Markdown block that holds an offset (§7.2): front matter, a run of
 * non-blank lines inside a fence, a heading, a list item with its
 * continuation, a blockquote section, a table, a thematic break or
 * `\pagebreak`, or a paragraph. A blank line gives an empty region at the
 * offset. Each direction stops after BLOCK_LINE_LIMIT lines.
 *
 * @param {string} text
 * @param {number} offset
 * @param {ReturnType<typeof analyzeText>} [index] analyzeText(text), when already built
 * @returns {{ start: number, end: number, kind: string, startLine: number, endLine: number }}
 */
export function findBlock(text, offset, index = analyzeText(text)) {
    const at = clamp(Number(offset) || 0, 0, index.text.length);
    const count = index.starts.length;
    const i = lineIndexAt(index.starts, at);

    if (index.frontMatterEnd >= 0 && i <= index.frontMatterEnd) {
        return region(index, 0, index.frontMatterEnd, 'frontmatter');
    }
    const fence = fenceAt(index, i);
    if (fence) return codeRegion(index, fence, i, at);

    const text_ = lineText(index, i);
    if (BLANK.test(text_)) return emptyRegion(index, at);
    if (ATX.test(text_)) return region(index, i, i, 'heading');
    if (SETEXT_UNDERLINE.test(text_) && isParagraphLine(index, i - 1)) {
        let start = i - 1;
        while (start > 0 && i - start < BLOCK_LINE_LIMIT && isParagraphLine(index, start - 1)
            && !(SETEXT_UNDERLINE.test(lineText(index, start - 1)) && isParagraphLine(index, start - 2))) start -= 1;
        return region(index, start, i, 'heading');
    }
    if (THEMATIC.test(text_) || PAGEBREAK.test(text_)) return region(index, i, i, 'break');
    if (QUOTE.test(text_)) {
        if (BARE_QUOTE.test(text_)) return emptyRegion(index, at);
        const isQuoteText = (j) => j >= 0 && j < count && !inCodeOrFrontMatter(index, j)
            && QUOTE.test(lineText(index, j)) && !BARE_QUOTE.test(lineText(index, j));
        let start = i;
        while (isQuoteText(start - 1) && i - start < BLOCK_LINE_LIMIT) start -= 1;
        let end = i;
        while (isQuoteText(end + 1) && end - i < BLOCK_LINE_LIMIT) end += 1;
        return region(index, start, end, 'blockquote');
    }
    const table = tableRun(index, i);
    if (table) return region(index, table.start, table.end, 'table');
    const item = listItemRegion(index, i);
    if (item) return item;

    // A paragraph: the run of plain lines, with a setext underline below it
    // making the whole run a heading.
    let start = i;
    while (start > 0 && i - start < BLOCK_LINE_LIMIT && isParagraphLine(index, start - 1)) {
        const above = lineText(index, start - 1);
        if (SETEXT_UNDERLINE.test(above) && isParagraphLine(index, start - 2)) break;
        start -= 1;
    }
    let end = i;
    let kind = 'paragraph';
    while (end + 1 < count && end - i < BLOCK_LINE_LIMIT) {
        const below = lineText(index, end + 1);
        if (SETEXT_UNDERLINE.test(below) && !inCodeOrFrontMatter(index, end + 1)) {
            end += 1;
            kind = 'heading';
            break;
        }
        if (!isParagraphLine(index, end + 1)) break;
        end += 1;
    }
    return region(index, start, end, kind);
}

/**
 * The text a sentence segmenter sees, with every offset kept in place: line
 * breaks become spaces, line-leading `>` and list markers become spaces, and
 * inline code and link destinations become runs of `x`, so the dots in
 * `example.com` or `file.md` do not end a sentence.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {string} of length end − start
 */
export function maskForSegmentation(text, start, end) {
    const chars = text.slice(start, end).split('');
    const fill = (from, to, char) => {
        for (let k = from; k < to; k += 1) chars[k] = char;
    };
    for (let k = 0; k < chars.length; k += 1) {
        const absolute = start + k;
        if (absolute === 0 || text.charCodeAt(absolute - 1) === 10) {
            const prefix = LINE_PREFIX.exec(text.slice(absolute, Math.min(end, absolute + 64)));
            if (prefix && prefix[0]) fill(k, Math.min(chars.length, k + prefix[0].length), ' ');
        }
        if (chars[k] === '\n') chars[k] = ' ';
    }
    const masked = chars.join('');
    for (const pattern of [INLINE_CODE, LINK_DESTINATION]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(masked)) !== null) {
            const from = pattern === LINK_DESTINATION ? match.index + 1 : match.index;
            fill(from, match.index + match[0].length, 'x');
        }
    }
    return chars.join('');
}

/**
 * Sentence boundaries by regex, for browsers without Intl.Segmenter: after
 * `.!?…` plus closing quotes or brackets when whitespace follows, or at once
 * after a CJK terminator.
 *
 * @param {string} value
 * @returns {Array<[number, number]>}
 */
export function regexSentenceSegments(value) {
    const pattern = /[.!?…]+["'”’)\]]*\s+|[。！？]+["'”’」』)\]]*\s*/g;
    const segments = [];
    let from = 0;
    let match;
    while ((match = pattern.exec(value)) !== null) {
        const to = match.index + match[0].length;
        if (to > from) segments.push([from, to]);
        from = to;
    }
    if (from < value.length || segments.length === 0) segments.push([from, value.length]);
    return segments;
}

const segmenters = new Map();

function defaultSegmenter(locale) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
    const key = locale || 'en';
    if (!segmenters.has(key)) {
        let segmenter;
        try {
            segmenter = new Intl.Segmenter(key, { granularity: 'sentence' });
        } catch {
            segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        }
        segmenters.set(key, segmenter);
    }
    return segmenters.get(key);
}

function segmentsOf(value, options) {
    const locale = options.locale
        ?? (typeof navigator !== 'undefined' && navigator.language) ?? 'en';
    const segmenter = options.segmenter === undefined ? defaultSegmenter(locale) : options.segmenter;
    if (!segmenter) return regexSentenceSegments(value);
    const segments = [];
    for (const part of segmenter.segment(value)) segments.push([part.index, part.index + part.segment.length]);
    return segments.length ? segments : [[0, value.length]];
}

/**
 * The sentence that holds an offset, inside its block (§7.3). Headings,
 * table rows, code lines, front-matter lines and breaks are one unit each:
 * the caret's line. A caret at the end of a block after a finished sentence
 * and whitespace gives an empty region. Looks at most SENTENCE_WINDOW
 * characters on either side.
 *
 * @param {string} text
 * @param {number} offset
 * @param {{ start: number, end: number, kind: string }} block from findBlock
 * @param {{ segmenter?: { segment: Function } | null, locale?: string, index?: ReturnType<typeof analyzeText> }} [options]
 *   `segmenter: null` forces the regex fallback.
 * @returns {{ start: number, end: number }}
 */
export function findSentence(text, offset, block, options = {}) {
    const index = options.index ?? analyzeText(text);
    const value = index.text;
    const at = clamp(Number(offset) || 0, 0, value.length);
    if (block.start === block.end) return { start: block.start, end: block.end };

    if (SINGLE_UNIT_KINDS.has(block.kind)) {
        const line = lineIndexAt(index.starts, at);
        return { start: index.starts[line], end: lineEnd(index, line) };
    }

    let from = block.start;
    let to = block.end;
    if (block.kind === 'list') {
        // Each list item is its own run of sentences.
        const line = lineIndexAt(index.starts, at);
        let first = line;
        while (first > block.startLine && !LIST.test(lineText(index, first))) first -= 1;
        let last = line;
        while (last < block.endLine && !LIST.test(lineText(index, last + 1))) last += 1;
        from = index.starts[first];
        to = lineEnd(index, last);
    }

    const windowStart = Math.max(from, at - SENTENCE_WINDOW);
    const windowEnd = Math.min(to, at + SENTENCE_WINDOW);
    const masked = maskForSegmentation(value, windowStart, windowEnd);
    const caret = at - windowStart;

    // The writer has finished a sentence and typed a space: nothing new yet.
    if (at === to && caret > 0 && WHITESPACE.test(masked[caret - 1])) {
        const before = masked.slice(0, caret).trimEnd();
        if (before === '' || ENDS_WITH_TERMINATOR.test(before)) return { start: at, end: at };
    }

    const segments = segmentsOf(masked, options);
    let chosen = segments[segments.length - 1];
    for (const segment of segments) {
        if (segment[0] <= caret && caret < segment[1]) {
            chosen = segment;
            break;
        }
    }
    let start = windowStart + chosen[0];
    let end = windowStart + chosen[1];
    while (end > start && WHITESPACE.test(value[end - 1])) end -= 1;
    while (start < end && start < at && WHITESPACE.test(value[start])) start += 1;
    return { start, end };
}

/**
 * The focus region for a selection (§7.1). Collapsed: the block or sentence
 * at the caret. A selection: the union from the region at its start to the
 * region at its end, so selected text is never dimmed. `granularity: 'off'`
 * gives null.
 *
 * @param {string} text
 * @param {{ start: number, end: number }} selection
 * @param {'off'|'paragraph'|'sentence'} granularity
 * @param {{ index?: ReturnType<typeof analyzeText>, segmenter?: object|null, locale?: string }} [options]
 * @returns {{ start: number, end: number, empty: boolean } | null}
 */
export function focusRange(text, selection, granularity, options = {}) {
    if (granularity !== 'paragraph' && granularity !== 'sentence') return null;
    const index = options.index ?? analyzeText(text);
    const length = index.text.length;
    let start = clamp(Number(selection?.start) || 0, 0, length);
    let end = clamp(Number(selection?.end ?? start) || 0, 0, length);
    if (end < start) [start, end] = [end, start];

    const at = (offset) => {
        const block = findBlock(index.text, offset, index);
        return granularity === 'sentence' ? findSentence(index.text, offset, block, { ...options, index }) : block;
    };

    if (start === end) {
        const one = at(start);
        return { start: one.start, end: one.end, empty: one.start === one.end };
    }
    // A selection ending just after a line break (a triple-click) ends on the line it selected.
    const endProbe = index.text.charCodeAt(end - 1) === 10 ? end - 1 : end;
    const first = at(start);
    const last = at(endProbe);
    return {
        start: Math.min(first.start, start),
        end: Math.max(last.end, endProbe),
        empty: false,
    };
}
