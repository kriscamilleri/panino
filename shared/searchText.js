/**
 * Search text: the query language people and agents type (docs/specs/active/advanced-search.md
 * §4), and the term helpers both search engines use to match it. The app's engine
 * (`documentSearch.js`) and the AI agents add-on's `search_documents` read a query with the same
 * parser, so a query means the same in both and their results come in the same order.
 *
 * Load: a query is capped at 200 characters before it is parsed, but every function here is
 * linear in its input anyway, and so are the term helpers that run on Document bodies (up to
 * 2 MiB). No regular expression here has two quantifiers that can share characters.
 */
import { canonicalTagName, findFrontMatterBlock, MAX_TAG_LENGTH } from './frontMatter.js';
import { parseFilter } from './propertyFilter.js';

/** Most parts one query may hold (words, phrases and prefixed parts together). */
export const MAX_SEARCH_TERMS = 20;
/** Longest query, in characters. */
export const MAX_QUERY_LENGTH = 200;
/** Snippets per result in the API. */
export const MAX_SNIPPETS = 3;
/** The prefixes of §4. Anything else before a colon is part of a plain word. */
export const SEARCH_PREFIXES = Object.freeze(['title', 'in', 'tag', 'is', 'prop']);
/** Built-in properties every database has locally, so the app can filter on them. */
export const LOCAL_BUILT_IN_KEYS = Object.freeze(['word_count', 'created_on', 'modified_on']);
/** Built-in properties that come from revision history, which only the server holds. */
export const SERVER_BUILT_IN_KEYS = Object.freeze(['created_by', 'modified_by']);

const PREFIXES = new Set(SEARCH_PREFIXES);
/** One letter, in any script (tested on a single character, so it cannot backtrack). */
const LETTER = /^\p{L}$/u;

/* ------------------------------------------------------------------ *
 * Characters, words and snippets
 * ------------------------------------------------------------------ */

/** Whether a UTF-16 code unit is whitespace, as `\s` matches it. */
export function isSpaceCode(code) {
    if (code > 32 && code < 127) return false;
    return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680
        || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
        || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

/**
 * Words in a text: runs of non-whitespace, the rule the editor and the app's Document lists
 * use. Counted in one pass without building a list of words, since a body can be 2 MiB.
 * @param {string|null|undefined} content
 * @returns {number}
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

/**
 * Non-overlapping occurrences of `needle`, left to right.
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
export function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) count += 1;
    return count;
}

/**
 * A short excerpt of `content` around the first case-insensitive match of `query`, or the
 * opening of the content when there is no match (the match is only in the title).
 * @param {string} content
 * @param {string} query
 * @param {number} [width]
 * @returns {string}
 */
export function makeSnippet(content, query, width = 160) {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const index = query ? text.toLowerCase().indexOf(String(query).toLowerCase()) : -1;
    if (index < 0) return text.length > width ? `${text.slice(0, width).trimEnd()}…` : text;
    const half = Math.floor((width - query.length) / 2);
    const start = Math.max(0, index - Math.max(half, 0));
    const end = Math.min(text.length, start + width);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------ *
 * Terms (the first release's API search)
 * ------------------------------------------------------------------ */

/**
 * Search terms: words, and "quoted phrases" kept whole. Stray quotes are dropped, spacing
 * inside a phrase is collapsed, repeats (ignoring case) are dropped. This is the first
 * release's reading, kept for callers that want plain terms; `parseSearchQuery` reads the
 * whole language.
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
    const lines = body.split('\n');
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
 * @returns {string}
 */
export function likeContains(text) {
    return `%${String(text ?? '').replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Whether a term has letters outside ASCII that have a case, which LIKE cannot fold.
 * @param {string} term
 * @returns {boolean}
 */
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
 * @returns {string}
 */
export function likeShape(term) {
    let shape = '';
    for (const char of String(term ?? '').toLowerCase()) {
        if (char.charCodeAt(0) > 127 && char.toLowerCase() !== char.toUpperCase()) shape += '_';
        else shape += char.replace(/[\\%_]/g, '\\$&');
    }
    return `%${shape}%`;
}

/**
 * How many of the terms occur in `text`, ignoring case.
 * @param {string|null|undefined} text
 * @param {string[]} terms
 * @returns {number}
 */
export function termsIn(text, terms) {
    const lower = String(text ?? '').toLowerCase();
    return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

/**
 * Whether `text` contains `term`, ignoring the case of every letter (JS lower case, the
 * comparison the API's `panino_folded_contains` makes).
 * @param {string|null|undefined} text
 * @param {string} term
 * @returns {boolean}
 */
export function foldedIncludes(text, term) {
    return String(text ?? '').toLowerCase().includes(String(term ?? '').toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Checklists
 * ------------------------------------------------------------------ */

/** The checklist marker after a list bullet: `[ ]`, `[x]` or `[X]` and a space, at `i`. */
function taskMarkerAt(line, i) {
    if (line[i] !== '[' || line[i + 2] !== ']') return false;
    const mark = line[i + 1];
    if (mark !== ' ' && mark !== 'x' && mark !== 'X') return false;
    const after = i + 3;
    if (after >= line.length || !isSpaceCode(line.charCodeAt(after))) return false;
    for (let k = after; k < line.length; k += 1) if (!isSpaceCode(line.charCodeAt(k))) return true;
    return false;
}

/** Whether one line (blockquote markers allowed) is a checklist item. Linear in the line. */
function isTaskLine(line) {
    let i = 0;
    const skipSpace = () => { while (i < line.length && isSpaceCode(line.charCodeAt(i))) i += 1; };
    skipSpace();
    while (line[i] === '>') { i += 1; skipSpace(); }
    if (line[i] === '#') {
        // A heading's text may itself be a checklist item, as the card previews read it.
        let hashes = 0;
        while (line[i] === '#' && hashes < 7) { i += 1; hashes += 1; }
        if (hashes > 6 || !isSpaceCode(line.charCodeAt(i))) return false;
        skipSpace();
    }
    const bullet = line[i];
    if (bullet === '-' || bullet === '*' || bullet === '+') {
        i += 1;
    } else {
        let digits = 0;
        while (digits < 10 && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) { i += 1; digits += 1; }
        if (digits === 0 || digits > 9 || (line[i] !== '.' && line[i] !== ')')) return false;
        i += 1;
    }
    if (i >= line.length || !isSpaceCode(line.charCodeAt(i))) return false;
    skipSpace();
    return taskMarkerAt(line, i);
}

/** A fence line (```` ``` ```` or `~~~`, three or more): its character and length, or null. */
function fenceOf(line) {
    let i = 0;
    while (i < line.length && isSpaceCode(line.charCodeAt(i))) i += 1;
    const char = line[i];
    if (char !== '`' && char !== '~') return null;
    let length = 0;
    while (line[i + length] === char) length += 1;
    return length >= 3 ? { char, length } : null;
}

/**
 * Whether a body has at least one checklist item (`- [ ] milk`, `1. [x] done`) outside fenced
 * code and the front matter block: the rule of the phone's Checklists chip and of
 * `is:checklist`. One pass over the lines, linear in the body. An item needs text after its
 * box: `- [ ] ` alone is not one, as the earlier rule and the Preview's renderer
 * (markdown-it-task-lists) both read it.
 * @param {string|null|undefined} markdown
 * @returns {boolean}
 */
export function hasChecklistItem(markdown) {
    const text = String(markdown ?? '');
    if (!text.includes('[')) return false;
    const lines = text.split('\n');
    // Front matter by the shared rule (closed and YAML-shaped), so a `---` rule around
    // ordinary text is text here too, as the Preview reads it.
    const block = findFrontMatterBlock(lines);
    let index = block.end >= 0 ? block.end + 1 : 0;
    let fence = null;
    for (; index < lines.length; index += 1) {
        const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
        const found = fenceOf(line);
        if (fence) {
            if (found && found.char === fence.char && found.length >= fence.length) fence = null;
            continue;
        }
        if (found) { fence = found; continue; }
        if (line.includes('[') && isTaskLine(line)) return true;
    }
    return false;
}

/* ------------------------------------------------------------------ *
 * The query language (§4)
 * ------------------------------------------------------------------ */

function isAsciiLetter(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function collapseSpaces(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * @typedef {object} SearchToken
 * @property {number} start   index in the query where the token starts (at its `-`)
 * @property {number} end     index just after it
 * @property {string} raw     the token as typed
 * @property {boolean} negated  it starts with `-`
 * @property {string|null} prefix  `title`, `in`, `tag`, `is` or `prop` (lower case), or null
 * @property {string} value   what follows the prefix, quotes removed and spaces collapsed
 * @property {boolean} quoted the value was or held a "quoted phrase"
 * @property {boolean} unclosed a quote in a prefixed value had no closing quote, so the value
 *   runs to the end of the query
 * @property {string} rawValue the value as typed, quotes kept (prefixed tokens), for `prop:`
 */

/**
 * Split a query into tokens, in one pass. A token is an optional `-` (before a letter or a
 * quote), an optional known prefix and its colon, then its value. A prefixed value runs to
 * the next space outside quotes. Otherwise the value is a "quoted phrase" (when a closing
 * quote follows) or a run of characters up to whitespace (quotes inside it are dropped, as
 * the first release did).
 * @param {string} query
 * @returns {SearchToken[]}
 */
export function tokenizeSearchQuery(query) {
    const text = String(query ?? '');
    const n = text.length;
    const tokens = [];
    // Index from which the query holds no more quotes, once a search for one failed, so no
    // stretch of the query is searched for a quote twice.
    let noQuoteFrom = n + 1;
    const closingQuote = (from) => {
        if (from >= noQuoteFrom) return -1;
        const at = text.indexOf('"', from);
        if (at < 0) noQuoteFrom = from;
        return at;
    };
    let i = 0;
    while (i < n) {
        while (i < n && isSpaceCode(text.charCodeAt(i))) i += 1;
        if (i >= n) break;
        const start = i;
        let negated = false;
        // A dash negates only before a letter or a quote (which a prefix starts with too), so
        // `-5 degrees`, `--` and `-` alone stay words, as the first release read them.
        if (text[i] === '-' && i + 1 < n && (text[i + 1] === '"' || LETTER.test(text[i + 1]))) {
            negated = true;
            i += 1;
        }
        let prefix = null;
        let j = i;
        while (j < n && j - i < 8 && isAsciiLetter(text.charCodeAt(j))) j += 1;
        if (j > i && text[j] === ':' && PREFIXES.has(text.slice(i, j).toLowerCase())) {
            prefix = text.slice(i, j).toLowerCase();
            i = j + 1;
        }
        let value;
        let quoted = false;
        let unclosed = false;
        let rawValue;
        if (prefix !== null) {
            // A prefixed value runs to the next space outside quotes: `prop:status="in progress"`
            // and `title:"a b"c` are one part each. Each quote is paired with the next one; an
            // unclosed quote takes the rest of the query.
            const from = i;
            let k = i;
            while (k < n && !isSpaceCode(text.charCodeAt(k))) {
                if (text[k] !== '"') { k += 1; continue; }
                const close = closingQuote(k + 1);
                if (close < 0) { unclosed = true; k = n; break; }
                quoted = true;
                k = close + 1;
            }
            rawValue = text.slice(from, k);
            value = collapseSpaces(rawValue.replace(/"/g, ''));
            i = k;
        } else {
            const close = text[i] === '"' ? closingQuote(i + 1) : -1;
            if (close >= 0) {
                value = collapseSpaces(text.slice(i + 1, close));
                quoted = true;
                i = close + 1;
            } else {
                let k = i;
                while (k < n && !isSpaceCode(text.charCodeAt(k))) k += 1;
                value = text.slice(i, k).replace(/"/g, '');
                i = k;
            }
            rawValue = value;
        }
        tokens.push({ start, end: i, raw: text.slice(start, i), negated, prefix, value, quoted, unclosed, rawValue });
    }
    return tokens;
}

/**
 * @typedef {(
 *   { type: 'text', field: 'any'|'title'|'content', value: string, negated: boolean, token: number }
 *   | { type: 'in', path: string[], value: string, negated: boolean, token: number }
 *   | { type: 'is', value: 'checklist', negated: boolean, token: number }
 *   | { type: 'prop', condition: { key: string, operator: string, value?: string }, value: string, negated: boolean, token: number }
 *   | { type: 'tag', name: string, negated: boolean, token: number }
 * )} SearchPart
 */

/**
 * Write a value so the parser reads it back as one value: quoted when it holds spaces or
 * quotes (quotes inside are dropped, since a phrase cannot hold one) or is empty.
 * @param {string} value
 * @returns {string}
 */
export function quoteSearchValue(value) {
    const text = String(value ?? '');
    let plain = text.length > 0;
    for (let i = 0; i < text.length && plain; i += 1) {
        if (text[i] === '"' || isSpaceCode(text.charCodeAt(i))) plain = false;
    }
    return plain ? text : `"${text.replace(/"/g, '')}"`;
}

/**
 * The filter a `prop:` token holds: its value as typed, without the quotes around the whole
 * of it (`prop:"due <= 2026-12-01"`); quotes around a value inside are kept for
 * `parseFilter` (`prop:status="in progress"`). An unclosed quote is closed at the end.
 * @param {SearchToken} token
 * @returns {string}
 */
function filterText(token) {
    let text = token.unclosed ? `${token.rawValue}"` : token.rawValue;
    if (text.length >= 2 && text[0] === '"' && text.endsWith('"') && text.indexOf('"', 1) === text.length - 1) {
        text = text.slice(1, -1);
    }
    return collapseSpaces(text);
}

/**
 * Read a query (§4): words, "phrases", `title:`, `in:`, `tag:`, `is:checklist`, `prop:` and
 * `-` before any of them. Every part must match. A part that cannot be read becomes a notice
 * (one sentence for the person or agent) and the rest is searched.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {'app'|'api'} [options.context] the app has no revision history, so `prop:created_by`
 *   and `prop:modified_by` are a notice there
 * @param {'any'|'title'|'content'} [options.field] where plain words and phrases must occur
 *   (the API's `in` parameter); `title:` parts always mean the title
 * @param {boolean} [options.tags] whether `tag:` is available (default true; false gives the
 *   "not available yet" notice, as before tags shipped)
 * @returns {{
 *   parts: SearchPart[], notices: string[], tokens: SearchToken[], terms: string[],
 *   partCount: number, hasPositive: boolean, onlyUnavailable: boolean, truncated: boolean
 * }} `onlyUnavailable`: nothing to look for but a part that is not available yet (`tag:`), so
 *   the answer is no Documents, with the notice. `terms` are the words and phrases to find and mark, without repeats; `partCount` is how
 *   many parts were read before the 20-part limit; `truncated` says the query was longer than
 *   200 characters and was cut.
 */
export function parseSearchQuery(query, { context = 'app', field = 'any', tags = true } = {}) {
    let text = String(query ?? '');
    const notices = [];
    const truncated = text.length > MAX_QUERY_LENGTH;
    if (truncated) {
        text = text.slice(0, MAX_QUERY_LENGTH);
        notices.push(`Only the first ${MAX_QUERY_LENGTH} characters are searched.`);
    }
    const tokens = tokenizeSearchQuery(text);
    const parts = [];
    const seen = new Set();
    const add = (part, key) => {
        if (key !== undefined) {
            if (seen.has(key)) return;
            seen.add(key);
        }
        parts.push(part);
    };

    let unavailableTags = 0;
    tokens.forEach((token, index) => {
        const { prefix, value, negated } = token;
        const dash = negated ? '-' : '';
        if (token.unclosed) notices.push(`${token.raw.slice(0, 40)} has no closing quote, so the rest of the search was read as its value`);
        switch (prefix) {
            case null: {
                if (!value) return;
                add({ type: 'text', field, value, negated, token: index }, `t|${negated}|${field}|${value.toLowerCase()}`);
                return;
            }
            case 'title': {
                if (!value) { notices.push(`${dash}title: needs a word or phrase, e.g. title:kickoff`); return; }
                add({ type: 'text', field: 'title', value, negated, token: index }, `t|${negated}|title|${value.toLowerCase()}`);
                return;
            }
            case 'in': {
                const path = value.split('/').map((segment) => collapseSpaces(segment)).filter(Boolean);
                if (!path.length) { notices.push(`${dash}in: needs a folder, e.g. in:Projects/2026`); return; }
                add({ type: 'in', path, value: path.join('/'), negated, token: index },
                    `i|${negated}|${path.join('/').toLowerCase()}`);
                return;
            }
            case 'is': {
                if (value.toLowerCase() !== 'checklist') {
                    notices.push(value ? `${dash}is:${value} is not known; use is:checklist` : `${dash}is: needs a value, e.g. is:checklist`);
                    return;
                }
                add({ type: 'is', value: 'checklist', negated, token: index }, `s|${negated}`);
                return;
            }
            case 'tag': {
                if (!tags) {
                    notices.push('Tags are not available yet');
                    if (!negated && value) unavailableTags += 1;
                    return;
                }
                if (!value) { notices.push(`${dash}tag: needs a tag name, e.g. tag:urgent`); return; }
                const name = canonicalTagName(value);
                if (name === null) { notices.push(`tag:${quoteSearchValue(value.slice(0, 60))} is longer than a tag name can be (${MAX_TAG_LENGTH} characters)`); return; }
                add({ type: 'tag', name, negated, token: index }, `g|${negated}|${name}`);
                return;
            }
            case 'prop': {
                if (!value) { notices.push(`${dash}prop: needs a condition, e.g. prop:status=draft`); return; }
                const filter = filterText(token);
                const parsed = parseFilter(filter);
                if (!parsed.ok) { notices.push(`prop:${quoteSearchValue(filter)}: ${parsed.error}`); return; }
                if (parsed.conditions.length > 1) {
                    notices.push(`prop:${quoteSearchValue(filter)} holds ${parsed.conditions.length} conditions; write one prop: part for each`);
                    return;
                }
                const condition = parsed.conditions[0];
                if (context === 'app' && SERVER_BUILT_IN_KEYS.includes(condition.key.toLowerCase())) {
                    notices.push(`prop:${condition.key} needs revision history, which only the API has; it was left out`);
                    return;
                }
                add({ type: 'prop', condition, value: filter, negated, token: index },
                    `p|${negated}|${condition.key.toLowerCase()}|${condition.operator}|${String(condition.value ?? '').toLowerCase()}`);
                return;
            }
            default:
                return;
        }
    });

    const partCount = parts.length;
    if (parts.length > MAX_SEARCH_TERMS) {
        parts.length = MAX_SEARCH_TERMS;
        notices.push(`Only the first ${MAX_SEARCH_TERMS} parts of the search are used.`);
    }
    const terms = [];
    const termKeys = new Set();
    for (const part of parts) {
        if (part.type !== 'text' || part.negated) continue;
        const key = part.value.toLowerCase();
        if (termKeys.has(key)) continue;
        termKeys.add(key);
        terms.push(part.value);
    }
    const hasPositive = parts.some((part) => !part.negated);
    // A search for a tag while tags are not available finds nothing (and says why); it is not
    // a search of exclusions only.
    const onlyUnavailable = !hasPositive && unavailableTags > 0;
    if (parts.length && !hasPositive && !onlyUnavailable) notices.push('Add something to look for; a search cannot be only exclusions (-).');
    return { parts, notices: [...new Set(notices)], tokens, terms, partCount, hasPositive, onlyUnavailable, truncated };
}

/**
 * Whether a word or phrase part matches a Document's title and body, ignoring the case of
 * every letter. A negated part is not inverted here; the caller does that.
 * @param {{ field: 'any'|'title'|'content', value: string }} part
 * @param {string|null|undefined} title
 * @param {string|null|undefined} content
 * @returns {boolean}
 */
export function textPartFound(part, title, content) {
    if (part.field !== 'content' && foldedIncludes(title, part.value)) return true;
    return part.field !== 'title' && foldedIncludes(content, part.value);
}
