// Pure text helpers for the Documents area of the v1 API (docs/specs/proposed/ai-api-expansion.md
// §4.1): statistics, referenced images, headings and sections, line ranges, exact edits,
// insertion with blank-line spacing, search terms and snippets, and list cursors.
// No database, no HTTP: documentService.js applies the rules around them.
//
// Line numbers are 1-based and count `content.split('\n')`, the way the editor's line count
// does, so "a\n" has two lines (the second empty). Headings are ATX (`## Text`) and setext
// (`Text` over `===` / `---`) headings outside fenced code blocks, HTML comments and the front
// matter block.
import { encodeDocumentCursor, makeSnippet } from './keyUtils.js';

export const MAX_IMAGE_IDS = 500;
export const MAX_OUTLINE_HEADINGS = 1000;
export const MAX_SEARCH_TERMS = 20;
export const MAX_SNIPPETS = 3;
export const SLUG_MAX_LENGTH = 200;
export const INSERT_POSITIONS = Object.freeze(['start', 'end', 'before_heading', 'after_heading', 'end_of_section']);
export const HEADING_POSITIONS = Object.freeze(['before_heading', 'after_heading', 'end_of_section']);
export const LIST_SORTS = Object.freeze(['updated', 'created', 'title']);
export const SEARCH_FIELDS = Object.freeze(['all', 'title', 'content']);

/* ------------------------------------------------------------------ *
 * Lines and statistics
 * ------------------------------------------------------------------ */

/** @param {string|null|undefined} content @returns {string[]} */
export function splitLines(content) {
    return String(content ?? '').split('\n');
}

/**
 * Word, character and line counts, as the editor's status bar counts them.
 * @param {string|null|undefined} content
 */
export function documentStats(content) {
    const text = String(content ?? '');
    return {
        wordCount: text ? text.trim().split(/\s+/).filter(Boolean).length : 0,
        characterCount: text.length,
        lineCount: text ? text.split('\n').length : 0,
    };
}

/**
 * Lines `startLine`..`endLine` (1-based, inclusive) of `content`, joined as they were.
 * @param {string} content
 * @param {number} startLine
 * @param {number} endLine
 */
export function sliceLines(content, startLine, endLine) {
    return splitLines(content).slice(startLine - 1, endLine).join('\n');
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

// The same match as image.js getImageUsage (`LIKE '%/images/<id>%'`), so the ids listed
// here are the ones that keep an image "in use": relative, `/api`-prefixed and absolute
// links, with or without `?space=`, anywhere in the body.
const IMAGE_REFERENCE = /\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Image ids the body references, lower case, in order of first appearance.
 * @param {string|null|undefined} content
 * @param {number} [cap]
 * @returns {string[]}
 */
export function referencedImageIds(content, cap = MAX_IMAGE_IDS) {
    const ids = [];
    const seen = new Set();
    for (const match of String(content ?? '').matchAll(IMAGE_REFERENCE)) {
        const id = match[1].toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= cap) break;
    }
    return ids;
}

/* ------------------------------------------------------------------ *
 * Headings
 * ------------------------------------------------------------------ */

const isBlank = (line) => line.trim() === '';
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// A fence may open after indentation, a list marker or a quote marker: headings inside it
// are code, whatever container it is in.
const FENCE_OPEN = /^(?:\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])?\s*)(`{3,}|~{3,})(.*)$/;

/**
 * Index of the closing line of a front matter block at the top, or -1. The same block
 * shared/frontMatter.js reads: the first non-blank line is `---`, closed by another.
 * @param {string[]} lines
 */
export function frontMatterEnd(lines) {
    let start = 0;
    while (start < lines.length && isBlank(lines[start])) start += 1;
    if (start >= lines.length || lines[start].trim() !== '---') return -1;
    for (let end = start + 1; end < lines.length; end += 1) {
        if (lines[end].trim() === '---') return end;
    }
    return -1;
}

/** A line that can be (part of) a paragraph, and so the text of a setext heading. */
function isParagraphText(line) {
    if (isBlank(line) || /^(?: {4}|\t)/.test(line)) return false;
    const body = line.trimStart();
    return !LIST_ITEM.test(line) && !/^[>|<]/.test(body) && !THEMATIC_BREAK.test(line);
}

/**
 * Heading text without inline Markdown: link and image targets, code ticks, emphasis
 * markers, HTML tags and backslash escapes. Used for slugs and for matching.
 * @param {string} text
 */
export function headingPlainText(text) {
    return String(text ?? '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/(`+)(.+?)\1/g, '$2')
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
        .replace(/(?<![\p{L}\p{N}])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}])/gu, '$1')
        .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
        .replace(/(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu, '$1')
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
        .replace(/\\([!-/:-@[-`{-~])/g, '$1')
        .trim();
}

/**
 * GitHub-compatible slug of a heading's plain text (the rule in
 * docs/specs/proposed/editor-toc-and-internal-links.md §5.1; the shared renderer has no
 * slug rule yet): lower case; drop everything but letters, marks, numbers, spaces, `-`
 * and `_`; each space becomes `-`; empty becomes `section`; at most 200 characters.
 * @param {string} text plain heading text
 */
export function slugify(text) {
    const slug = String(text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
        .replace(/ /g, '-')
        .slice(0, SLUG_MAX_LENGTH);
    return slug || 'section';
}

/** github-slugger's de-duplication: `x`, `x-1`, `x-2`, … in Document order. */
function slugger() {
    const occurrences = new Map();
    return (base) => {
        let result = base;
        while (occurrences.has(result)) {
            occurrences.set(base, occurrences.get(base) + 1);
            result = `${base}-${occurrences.get(base)}`;
        }
        occurrences.set(result, 0);
        return result;
    };
}

/**
 * Every heading, in order.
 * @param {string|null|undefined} content
 * @returns {Array<{ level: number, text: string, plain: string, slug: string,
 *   line: number, headingEndLine: number, endLine: number }>}
 *   `line` is the heading's first line, `headingEndLine` its last (the underline of a setext
 *   heading), `endLine` the last line of its section: the line before the next heading of the
 *   same or a higher level, or the last line of the Document.
 */
export function parseHeadings(content) {
    const lines = splitLines(content).map((line) => line.replace(/\r$/, ''));
    const found = [];
    let fence = null;
    let comment = false;
    let paragraphStart = -1;
    // Whether a paragraph may start on the next line: after the start, a blank line, a
    // heading, a fence or a thematic break, but not as the lazy continuation of a list
    // item or a quote.
    let canStartParagraph = true;

    for (let i = frontMatterEnd(lines) + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (fence) {
            if (new RegExp(`^\\s*(?:>\\s*)*${fence.char === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(line)) {
                fence = null;
                canStartParagraph = true;
            }
            continue;
        }
        if (comment) {
            if (line.includes('-->')) {
                comment = false;
                canStartParagraph = true;
            }
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
            fence = { char: open[1][0], length: open[1].length };
            paragraphStart = -1;
            continue;
        }
        if (/^ {0,3}<!--/.test(line)) {
            comment = !line.includes('-->');
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        if (isBlank(line)) {
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        const atx = ATX.exec(line);
        if (atx) {
            const text = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
            found.push({ level: atx[1].length, text, line: i + 1, headingEndLine: i + 1 });
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        const setext = SETEXT.exec(line);
        if (setext && paragraphStart >= 0) {
            const text = lines.slice(paragraphStart, i).map((part) => part.trim()).join(' ');
            found.push({ level: setext[1][0] === '=' ? 1 : 2, text, line: paragraphStart + 1, headingEndLine: i + 1 });
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        if (paragraphStart >= 0) {
            // A paragraph continues over any non-blank line that does not start a block.
            if (!isParagraphText(line) && !/^(?: {4}|\t)/.test(line)) {
                paragraphStart = -1;
                canStartParagraph = THEMATIC_BREAK.test(line);
            }
            continue;
        }
        if (canStartParagraph && isParagraphText(line)) {
            paragraphStart = i;
            continue;
        }
        canStartParagraph = THEMATIC_BREAK.test(line);
    }

    const unique = slugger();
    return found.map((heading, index) => {
        let endLine = lines.length;
        for (let next = index + 1; next < found.length; next += 1) {
            if (found[next].level <= heading.level) {
                endLine = found[next].line - 1;
                break;
            }
        }
        const plain = headingPlainText(heading.text);
        return { ...heading, plain, slug: unique(slugify(plain)), endLine };
    });
}

/** Lower case, single spaces, no leading `#` markers: how heading names are compared. */
function headingKey(text) {
    return String(text ?? '').replace(/^\s*#{1,6}\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Headings whose text (as written, or without inline Markdown) equals `text`, ignoring case
 * and spacing; failing that, headings whose slug equals it. With `line`, only the heading
 * starting on that line.
 * @param {ReturnType<typeof parseHeadings>} headings
 * @param {string} text
 * @param {number} [line]
 */
export function findHeadings(headings, text, line) {
    const wanted = headingKey(text);
    if (!wanted) return [];
    let matches = headings.filter((heading) => headingKey(heading.text) === wanted || headingKey(heading.plain) === wanted);
    if (matches.length === 0) matches = headings.filter((heading) => heading.slug === wanted);
    if (line !== undefined && line !== null) matches = matches.filter((heading) => heading.line === line);
    return matches;
}

/* ------------------------------------------------------------------ *
 * Edits and insertion
 * ------------------------------------------------------------------ */

/** Non-overlapping occurrences of `needle`, left to right. */
export function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) count += 1;
    return count;
}

/**
 * Replace exact text. A Document stored with CRLF line endings also matches `oldText`
 * written with LF, and the replacement gets the Document's line endings.
 * @param {string} content
 * @param {string} oldText non-empty
 * @param {string} newText
 * @param {boolean} replaceAll
 * @returns {{ ok: true, content: string, replacements: number, line: number }
 *   | { ok: false, reason: 'no_match' | 'ambiguous', matchCount: number }}
 *   `line` is where the first replacement starts.
 */
export function applyEdit(content, oldText, newText, replaceAll = false) {
    let from = oldText;
    let to = newText;
    let matchCount = countOccurrences(content, from);
    if (matchCount === 0 && content.includes('\r\n') && from.includes('\n') && !from.includes('\r')) {
        from = from.replace(/\n/g, '\r\n');
        to = to.replace(/\r?\n/g, '\r\n');
        matchCount = countOccurrences(content, from);
    }
    if (matchCount === 0) return { ok: false, reason: 'no_match', matchCount };
    if (matchCount > 1 && !replaceAll) return { ok: false, reason: 'ambiguous', matchCount };
    const first = content.indexOf(from);
    const line = content.slice(0, first).split('\n').length;
    // split/join, not String.replace: `$` in the new text must stay literal.
    const next = replaceAll
        ? content.split(from).join(to)
        : content.slice(0, first) + to + content.slice(first + from.length);
    return { ok: true, content: next, replacements: matchCount, line };
}

/** `text` without blank lines before its first or after its last non-blank line. */
export function trimBlankLines(text) {
    return String(text ?? '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '').replace(/^[ \t]+$/, '');
}

/** Two adjacent lines that belong to one list or one table need no blank line between. */
function sameBlock(a, b) {
    if (LIST_ITEM.test(a) && LIST_ITEM.test(b)) return true;
    return a.trimStart().startsWith('|') && b.trimStart().startsWith('|');
}

/**
 * Insert Markdown at a position, a blank line apart from the text around it (none between
 * items of one list or rows of one table). `start` is after any front matter; `end` drops
 * trailing blank lines first, as append does; `end_of_section` goes after the section's last
 * non-blank line, before the next heading of the same or a higher level.
 * @param {string} content
 * @param {string} insertion non-blank Markdown
 * @param {string} position one of INSERT_POSITIONS
 * @param {{ line: number, headingEndLine: number, endLine: number }} [heading] for heading positions
 * @returns {{ content: string, line: number }} the new body and the line the insertion starts on
 */
export function insertContent(content, insertion, position, heading) {
    const text = String(content ?? '');
    const trailingNewline = text.endsWith('\n');
    // A Document stored with CRLF keeps CRLF; the line count is the same either way.
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text === '' ? [] : text.split(eol === '\r\n' ? /\r?\n/ : '\n');
    if (trailingNewline) lines.pop();
    const block = trimBlankLines(insertion).split(/\r?\n/);
    const blankLine = '';

    let at;
    if (position === 'start') {
        at = frontMatterEnd(lines) + 1;
    } else if (position === 'end') {
        while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
        at = lines.length;
    } else if (position === 'before_heading') {
        // Next to the text above, so a list item joins the list before the heading.
        at = heading.line - 1;
        while (at > 0 && isBlank(lines[at - 1])) at -= 1;
    } else if (position === 'after_heading') {
        // Next to the text below, so a list item joins the list under the heading.
        at = heading.headingEndLine;
        while (at < lines.length && isBlank(lines[at])) at += 1;
    } else if (position === 'end_of_section') {
        at = Math.min(heading.endLine, lines.length);
        while (at > heading.headingEndLine && isBlank(lines[at - 1])) at -= 1;
    } else {
        throw new Error(`unknown position ${position}`);
    }

    const blankBefore = at > 0 && !isBlank(lines[at - 1]) && !sameBlock(lines[at - 1], block[0]);
    const blankAfter = at < lines.length && !isBlank(lines[at]) && !sameBlock(block[block.length - 1], lines[at]);
    lines.splice(at, 0, ...(blankBefore ? [blankLine] : []), ...block, ...(blankAfter ? [blankLine] : []));
    const joined = lines.join(eol);
    return { content: trailingNewline ? `${joined}${eol}` : joined, line: at + (blankBefore ? 1 : 0) + 1 };
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * Search terms: words, and "quoted phrases" kept whole. Stray quotes are dropped, spacing
 * inside a phrase is collapsed, repeats (ignoring case) are dropped.
 * @param {string} query
 * @returns {string[]}
 */
export function parseSearchTerms(query) {
    const terms = [];
    const seen = new Set();
    for (const match of String(query ?? '').matchAll(/"([^"]*)"|(\S+)/g)) {
        const term = match[1] !== undefined ? match[1].replace(/\s+/g, ' ').trim() : match[2].replace(/"/g, '');
        const key = term.toLowerCase();
        if (!term || seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
    }
    return terms;
}

/**
 * How often the terms occur in `text`, and up to `max` snippets: the lines with the most
 * distinct terms (earlier lines first on a tie), returned in Document order, each an
 * excerpt around its first match.
 * @param {string|null|undefined} text
 * @param {string[]} terms
 * @param {number} [max]
 * @returns {{ matchCount: number, snippets: Array<{ line: number, text: string }> }}
 */
export function termMatches(text, terms, max = MAX_SNIPPETS) {
    const body = String(text ?? '');
    const lowerTerms = terms.map((term) => term.toLowerCase());
    const lowerBody = body.toLowerCase();
    let matchCount = 0;
    for (const term of lowerTerms) matchCount += countOccurrences(lowerBody, term);
    if (matchCount === 0 || max <= 0) return { matchCount, snippets: [] };

    const candidates = [];
    const lines = splitLines(body);
    for (let index = 0; index < lines.length; index += 1) {
        const lower = lines[index].toLowerCase();
        let distinct = 0;
        let first = -1;
        let firstTerm = '';
        lowerTerms.forEach((term, termIndex) => {
            const at = lower.indexOf(term);
            if (at < 0) return;
            distinct += 1;
            if (first < 0 || at < first) {
                first = at;
                firstTerm = terms[termIndex];
            }
        });
        if (distinct) candidates.push({ index, distinct, firstTerm });
    }
    const snippets = candidates
        .sort((a, b) => b.distinct - a.distinct || a.index - b.index)
        .slice(0, max)
        .sort((a, b) => a.index - b.index)
        .map(({ index, firstTerm }) => ({ line: index + 1, text: makeSnippet(lines[index], firstTerm) }));
    return { matchCount, snippets };
}

/** How many of the terms occur in `text`, ignoring case. */
export function termsIn(text, terms) {
    const lower = String(text ?? '').toLowerCase();
    return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

/* ------------------------------------------------------------------ *
 * List cursors
 * ------------------------------------------------------------------ */

/**
 * The cursor after `row` in a list sorted by `sort`. The `updated` cursor keeps the first
 * release's format, so cursors issued before sorting existed stay valid.
 * @param {'updated'|'created'|'title'} sort
 * @param {{ id: string, updated_at?: string|null, created_at?: string|null, title?: string|null }} row
 */
export function encodeListCursor(sort, row) {
    if (sort === 'updated') return encodeDocumentCursor(row);
    const value = sort === 'created' ? row.created_at ?? '' : row.title ?? '';
    return Buffer.from(JSON.stringify([sort, value, row.id]), 'utf8').toString('base64url');
}

/**
 * @param {unknown} cursor
 * @returns {{ sort: string, value: string, id: string } | null}
 */
export function decodeListCursor(cursor) {
    if (typeof cursor !== 'string' || !cursor) return null;
    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(decoded) || !decoded.every((part) => typeof part === 'string')) return null;
        if (decoded.length === 2) return { sort: 'updated', value: decoded[0], id: decoded[1] };
        if (decoded.length === 3 && (decoded[0] === 'created' || decoded[0] === 'title')) {
            return { sort: decoded[0], value: decoded[1], id: decoded[2] };
        }
        return null;
    } catch {
        return null;
    }
}

/** Byte order of UTF-8, as SQLite's BINARY collation compares. */
export function compareBinary(a, b) {
    return Buffer.compare(Buffer.from(String(a ?? ''), 'utf8'), Buffer.from(String(b ?? ''), 'utf8'));
}

/** SQLite's NOCASE collation: ASCII letters folded, then byte order. */
export function compareNoCase(a, b) {
    const fold = (value) => String(value ?? '').replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    return compareBinary(fold(a), fold(b));
}
