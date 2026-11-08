// Pure text helpers for the Documents area of the v1 API (docs/specs/proposed/ai-api-expansion.md
// §4.1): statistics, referenced images, headings and sections, line ranges, exact edits,
// insertion with blank-line spacing, search terms and snippets, and list cursors.
// No database, no HTTP: documentService.js applies the rules around them.
//
// Line numbers are 1-based and count `content.split('\n')`, the way the editor's line count
// does, so "a\n" has two lines (the second empty). Headings are ATX (`## Text`) and setext
// (`Text` over `===` / `---`) headings outside fenced code blocks, HTML comments and the front
// matter block.
import { findFrontMatterBlock } from '@panino/content-merge/front-matter';
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

/** Whether a UTF-16 code unit is whitespace, as `\s` matches it. */
function isSpaceCode(code) {
    if (code > 32 && code < 127) return false;
    return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680
        || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
        || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

/**
 * Words in a text: runs of non-whitespace, the rule the editor and the app's Document lists
 * use. Counted in one pass without building a list of words, since a body can be 2 MiB.
 * @param {string|null|undefined} content
 */
export function countWords(content) {
    const text = String(content ?? '');
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i += 1) {
        const space = isSpaceCode(text.charCodeAt(i));
        if (!space && !inWord) count += 1;
        inWord = !space;
    }
    return count;
}

/** Lines in a text, as `text.split('\n').length` counts them, without splitting it. */
function countLines(text) {
    let count = 1;
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) count += 1;
    return count;
}

/**
 * Word, character and line counts, as the editor's status bar counts them.
 * @param {string|null|undefined} content
 */
export function documentStats(content) {
    const text = String(content ?? '');
    return {
        wordCount: countWords(text),
        characterCount: text.length,
        lineCount: text ? countLines(text) : 0,
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

// Every pattern here runs on Document lines, and a line can be 2 MiB long, so each one is
// built to take time linear in the line: no two quantifiers that can share the same
// characters next to each other. A pattern that could backtrack (ATX headings, the inline
// Markdown in heading text) is parsed by hand instead.
const isBlank = (line) => line.trim() === '';
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// A fence may open after indentation, quote markers and a list marker: headings inside it
// are code, whatever container it is in.
const FENCE_OPEN = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;
const LINE_TERMINATOR = /[\r\u2028\u2029]/;

/** The pattern that closes a fence opened with `count` of `char`. */
function fenceClose(char, count) {
    return new RegExp(`^[ \\t]*(?:>[ \\t]*)*${char === '`' ? '`' : '~'}{${count},}[ \\t]*$`);
}

/**
 * An ATX heading line (`## Text ##`): its level and text, or null. The text is without the
 * spaces around it and without a closing run of `#` that follows a space.
 * @param {string} line
 * @returns {{ level: number, text: string } | null}
 */
export function parseAtxHeading(line) {
    let at = 0;
    while (at < 3 && line[at] === ' ') at += 1;
    let level = 0;
    while (line[at + level] === '#') level += 1;
    if (level < 1 || level > 6) return null;
    const rest = line.slice(at + level);
    if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return null;
    if (LINE_TERMINATOR.test(rest)) return null;
    let start = 0;
    let end = rest.length;
    while (start < end && (rest[start] === ' ' || rest[start] === '\t')) start += 1;
    while (end > start && (rest[end - 1] === ' ' || rest[end - 1] === '\t')) end -= 1;
    let text = rest.slice(start, end);
    let hashes = text.length;
    while (hashes > 0 && text[hashes - 1] === '#') hashes -= 1;
    if (hashes < text.length) {
        if (hashes === 0) text = '';
        else if (text[hashes - 1] === ' ' || text[hashes - 1] === '\t') text = text.slice(0, hashes);
    }
    return { level, text: text.trim() };
}

/**
 * Index of the closing line of the front matter block at the top, or -1: the block
 * shared/frontMatter.js reads, so the outline, insertion and properties agree on it.
 * @param {string[]} lines
 */
export function frontMatterEnd(lines) {
    return findFrontMatterBlock(lines).end;
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
    let plain = String(text ?? '');
    plain = stripBracketed(plain, '![', '(', ')');
    plain = stripBracketed(plain, '[', '(', ')');
    plain = stripBracketed(plain, '[', '[', ']');
    plain = stripTags(plain);
    plain = stripCodeSpans(plain);
    plain = stripDelimited(plain, '**');
    plain = stripDelimited(plain, '__', { flanking: true });
    plain = stripDelimited(plain, '*');
    plain = stripDelimited(plain, '_', { flanking: true });
    plain = stripDelimited(plain, '~~');
    return plain.replace(/\\([!-/:-@[-`{-~])/g, '$1').trim();
}

/*
 * The inline Markdown strips below each do what one regular expression would, in time
 * linear in the text. The expressions they replace backtrack: on a heading of a few
 * thousand `[` or `<`, each start rescans to the end of the line. Each comment gives the
 * expression and replacement it stands for; the tests compare the two on random text.
 * Searches only move forward, so a remembered "next `]`" stays right until passed.
 */

/**
 * `opener([^\]]*)\]tailOpen[^tailClose]*tailClose` → `$1`, e.g. `![alt](src)` → `alt`
 * (opener `![`), `[text](href)` and `[text][ref]` → `text`.
 */
function stripBracketed(text, opener, tailOpen, tailClose) {
    let out = '';
    let copied = 0;
    let from = 0;
    let bracket = -2;
    let tail = -2;
    for (;;) {
        const at = text.indexOf(opener, from);
        if (at < 0) break;
        const inner = at + opener.length;
        if (bracket !== -1 && bracket < inner) bracket = text.indexOf(']', inner);
        if (bracket < 0) break;
        if (text[bracket + 1] === tailOpen) {
            if (tail !== -1 && tail < bracket + 2) tail = text.indexOf(tailClose, bracket + 2);
            if (tail < 0) break;
            out += text.slice(copied, at) + text.slice(inner, bracket);
            copied = tail + 1;
            from = copied;
            continue;
        }
        from = at + 1;
    }
    return out + text.slice(copied);
}

/** `<[^>]+>` → `` (HTML tags). */
function stripTags(text) {
    let out = '';
    let copied = 0;
    let from = 0;
    let close = -2;
    for (;;) {
        const at = text.indexOf('<', from);
        if (at < 0) break;
        if (close !== -1 && close < at + 1) close = text.indexOf('>', at + 1);
        if (close < 0) break;
        if (close > at + 1) {
            out += text.slice(copied, at);
            copied = close + 1;
            from = copied;
            continue;
        }
        from = at + 1;
    }
    return out + text.slice(copied);
}

/**
 * Code spans, as CommonMark reads them: a run of backticks up to the next run of the same
 * length, replaced by the text between. An unmatched run stays as written.
 */
function stripCodeSpans(text) {
    const runs = [];
    for (let i = text.indexOf('`'); i !== -1; i = text.indexOf('`', i)) {
        let end = i;
        while (text[end] === '`') end += 1;
        runs.push({ start: i, length: end - i });
        i = end;
    }
    if (runs.length < 2) return text;
    const nextSame = new Array(runs.length).fill(-1);
    const later = new Map();
    for (let k = runs.length - 1; k >= 0; k -= 1) {
        nextSame[k] = later.get(runs[k].length) ?? -1;
        later.set(runs[k].length, k);
    }
    let out = '';
    let copied = 0;
    for (let k = 0; k < runs.length;) {
        const close = nextSame[k];
        if (close < 0) {
            k += 1;
            continue;
        }
        out += text.slice(copied, runs[k].start) + text.slice(runs[k].start + runs[k].length, runs[close].start);
        copied = runs[close].start + runs[close].length;
        k = close + 1;
    }
    return out + text.slice(copied);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE_CHAR = /\s/;

/** The code point that ends just before `index`, or '' at the start. */
function codePointBefore(text, index) {
    if (index <= 0) return '';
    const low = text.charCodeAt(index - 1);
    if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
        const high = text.charCodeAt(index - 2);
        if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
    }
    return text[index - 1];
}

/**
 * `D(?=\S)(.+?)(?<=\S)D` → `$1` for a delimiter D (`**`, `*`, `~~`). With `flanking`, as
 * for `_` and `__`: `(?<![\p{L}\p{N}])D(?=\S)(.+?)(?<=\S)D(?![\p{L}\p{N}])`, so
 * snake_case words keep their underscores.
 */
function stripDelimited(text, delim, { flanking = false } = {}) {
    const width = delim.length;
    const closers = [];
    for (let j = text.indexOf(delim); j !== -1; j = text.indexOf(delim, j + 1)) {
        if (j === 0 || SPACE_CHAR.test(text[j - 1])) continue;
        if (flanking && j + width < text.length && WORD_CHAR.test(String.fromCodePoint(text.codePointAt(j + width)))) continue;
        closers.push(j);
    }
    if (closers.length === 0) return text;
    let out = '';
    let copied = 0;
    let from = 0;
    let next = 0;
    let lineEnd = -2;
    for (;;) {
        const at = text.indexOf(delim, from);
        if (at < 0) break;
        from = at + 1;
        const inner = at + width;
        if (inner >= text.length || SPACE_CHAR.test(text[inner])) continue;
        if (flanking && WORD_CHAR.test(codePointBefore(text, at))) continue;
        while (next < closers.length && closers[next] < inner + 1) next += 1;
        if (next >= closers.length) break;
        // `.` stops at a line terminator, so the closer must come before the next one.
        if (lineEnd !== -1 && lineEnd < inner) {
            const found = text.slice(inner).search(/[\n\r\u2028\u2029]/);
            lineEnd = found < 0 ? -1 : inner + found;
        }
        if (lineEnd !== -1 && lineEnd < closers[next]) continue;
        out += text.slice(copied, at) + text.slice(inner, closers[next]);
        copied = closers[next] + width;
        from = copied;
    }
    return out + text.slice(copied);
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
            if (fence.test(line)) {
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
        if (isBlank(line)) {
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
            fence = fenceClose(open[1][0], open[1].length);
            paragraphStart = -1;
            continue;
        }
        if (/^ {0,3}<!--/.test(line)) {
            comment = !line.includes('-->');
            paragraphStart = -1;
            canStartParagraph = true;
            continue;
        }
        const atx = parseAtxHeading(line);
        if (atx) {
            found.push({ level: atx.level, text: atx.text, line: i + 1, headingEndLine: i + 1 });
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

/**
 * `text` without blank lines before its first or after its last non-blank line (what
 * `/^(?:[ \t]*\r?\n)+/` and `/(?:\r?\n[ \t]*)+$/` would remove, in linear time), and empty
 * if only spaces are left.
 */
export function trimBlankLines(text) {
    const value = String(text ?? '');
    const spaceAt = (index) => value[index] === ' ' || value[index] === '\t';
    let start = 0;
    for (;;) {
        let at = start;
        while (spaceAt(at)) at += 1;
        if (value[at] === '\n') start = at + 1;
        else if (value[at] === '\r' && value[at + 1] === '\n') start = at + 2;
        else break;
    }
    let end = value.length;
    for (;;) {
        let at = end;
        while (at > start && spaceAt(at - 1)) at -= 1;
        if (at <= start || value[at - 1] !== '\n') break;
        end = at - 2 >= start && value[at - 2] === '\r' ? at - 2 : at - 1;
    }
    const trimmed = value.slice(start, end);
    return /^[ \t]+$/.test(trimmed) ? '' : trimmed;
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
    // Each line keeps its own ending, so in a Document that mixes CRLF and LF only the
    // inserted lines are new; they take the ending of the line before them.
    const lines = [];
    const endings = [];
    if (text !== '') {
        let from = 0;
        for (;;) {
            const newline = text.indexOf('\n', from);
            if (newline < 0) {
                lines.push(text.slice(from));
                endings.push('');
                break;
            }
            const crlf = newline > from && text[newline - 1] === '\r';
            lines.push(text.slice(from, crlf ? newline - 1 : newline));
            endings.push(crlf ? '\r\n' : '\n');
            from = newline + 1;
        }
    }
    if (trailingNewline) {
        lines.pop();
        endings.pop();
    }
    const block = trimBlankLines(insertion).split(/\r?\n/);
    const blankLine = '';

    let at;
    if (position === 'start') {
        at = frontMatterEnd(lines) + 1;
    } else if (position === 'end') {
        while (lines.length && isBlank(lines[lines.length - 1])) {
            lines.pop();
            endings.pop();
        }
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
    const added = [...(blankBefore ? [blankLine] : []), ...block, ...(blankAfter ? [blankLine] : [])];
    const eol = endings[at - 1] || endings[at] || (text.includes('\r\n') ? '\r\n' : '\n');
    const addedEndings = added.map(() => eol);
    if (at === lines.length) {
        // After the last line: it needs an ending now, and the new last line ends the
        // Document the way the old one did.
        if (at > 0 && !endings[at - 1]) endings[at - 1] = eol;
        if (!trailingNewline) addedEndings[addedEndings.length - 1] = '';
    }
    lines.splice(at, 0, ...added);
    endings.splice(at, 0, ...addedEndings);
    let joined = '';
    for (let index = 0; index < lines.length; index += 1) joined += lines[index] + endings[index];
    return { content: joined, line: at + (blankBefore ? 1 : 0) + 1 };
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

/**
 * A pattern for `column LIKE ? ESCAPE '\\'` that matches text containing `text`. LIKE folds
 * ASCII letters only (as SQLite's lower() does) and scans far faster than
 * `instr(lower(column), ?)`, which copies every body to lower-case it (65 ms against 8 ms per
 * term on 83 MB of Documents).
 * @param {string} text
 */
export function likeContains(text) {
    return `%${String(text ?? '').replace(/[\\%_]/g, '\\$&')}%`;
}

/** Whether a term has letters outside ASCII that have a case, which LIKE cannot fold. */
export function hasCasedNonAscii(term) {
    for (const char of String(term ?? '')) {
        if (char.charCodeAt(0) > 127 && char.toLowerCase() !== char.toUpperCase()) return true;
    }
    return false;
}

/**
 * A LIKE pattern (ESCAPE '\\') every text containing `term` matches, ignoring case, for a
 * term LIKE cannot fold: the term in lower case with each letter outside ASCII that has a
 * case replaced by `_` (one character, any case). `größe` gives `%gr__e%`. It narrows the
 * rows in SQLite before the full Unicode comparison in JS. (The two letters whose lower
 * case is ASCII, KELVIN SIGN and LATIN CAPITAL I WITH DOT, are not folded to it.)
 * @param {string} term
 */
export function likeShape(term) {
    let shape = '';
    for (const char of String(term ?? '').toLowerCase()) {
        if (char.charCodeAt(0) > 127 && char.toLowerCase() !== char.toUpperCase()) shape += '_';
        else shape += char.replace(/[\\%_]/g, '\\$&');
    }
    return `%${shape}%`;
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
