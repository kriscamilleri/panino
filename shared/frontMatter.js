/**
 * The YAML-like front matter block at the top of a Document: a `---` line,
 * `key: value` lines, and a closing `---`. Only flat `key: value` pairs are
 * read; nested values (indented lines), list items and comments may sit in the
 * block and are skipped. Shared by the frontend (Preview, templates) and the
 * API (server-side rendering, Document properties), so both read a Document
 * the same way. `readTags` reads the one list the parser skips, `tags`.
 *
 * Every line is read in time linear in its length: a Document can be 2 MiB,
 * and the API reads the front matter of thousands of Documents per query.
 */

const FRONT_MATTER_FENCE = '---';
const LINE_TERMINATOR = /[\r\u2028\u2029]/;

/** The key of a `key: value` line (text before the first colon), or null. */
function lineKey(line) {
    const colon = line.indexOf(':');
    return colon > 0 ? line.slice(0, colon).trim() : null;
}

/**
 * A line that belongs in a YAML block: blank, `key: value`, indented (a nested
 * or continued value), a list item or a comment. Anything else — a sentence, a
 * heading — means the `---` lines around it are thematic breaks in the text.
 */
function isBlockLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (line[0] === ' ' || line[0] === '\t') return true;
    if (trimmed[0] === '#' || trimmed === '-' || trimmed.startsWith('- ')) return true;
    return Boolean(lineKey(line));
}

/**
 * Locate the block. `start` is the index of the opening fence line, `end` the
 * closing one; both are -1 when the Document has no block. A block opens on the
 * first non-blank line, closes at the next `---` line, and holds at least one
 * `key: value` line and only lines that belong in YAML. So a Document that
 * starts with a `---` rule above ordinary text has no front matter, and an
 * unclosed block is ordinary text until it is closed.
 * @param {string[]} lines
 * @returns {{ start: number, end: number }}
 */
export function findFrontMatterBlock(lines) {
    const none = { start: -1, end: -1 };
    let start = 0;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    if (start >= lines.length || lines[start].trim() !== FRONT_MATTER_FENCE) return none;
    let keys = 0;
    for (let end = start + 1; end < lines.length; end += 1) {
        const line = lines[end];
        if (line.trim() === FRONT_MATTER_FENCE) return keys > 0 ? { start, end } : none;
        if (!isBlockLine(line)) return none;
        if (!/^[ \t#-]/.test(line) && lineKey(line)) keys += 1;
    }
    return none;
}

/**
 * Split a Document into its front matter values and the body after the block.
 * Without a block, the metadata is empty and the body is the whole Document.
 * @param {string} markdown
 * @returns {{ metadata: Object<string,string>, body: string }}
 */
export function parseFrontMatter(markdown) {
    if (!markdown) return { metadata: {}, body: '' };
    const lines = markdown.split(/\r?\n/);
    const { start, end } = findFrontMatterBlock(lines);
    if (start === -1) return { metadata: {}, body: markdown };

    const metadata = {};
    for (let idx = start + 1; idx < end; idx += 1) {
        const line = lines[idx];
        if (!line.trim()) continue;
        // `key: value`: the key is before the first colon; the value needs at
        // least one character after it, on this line.
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const rest = line.slice(colon + 1);
        if (!rest || LINE_TERMINATOR.test(rest)) continue;
        const key = line.slice(0, colon).trim();
        if (key) metadata[key] = rest.trim();
    }

    const body = lines.slice(end + 1).join('\n');
    return { metadata, body };
}

/**
 * A front matter value without the single or double quotes around it.
 * @param {string|undefined} value
 * @returns {string}
 */
export function unquoteValue(value) {
    const text = String(value ?? '').trim();
    const match = text.match(/^(["'])(.*)\1$/);
    return (match ? match[2] : text).trim();
}

/**
 * Set `key: value` lines in the Document's front matter, replacing a line with
 * the same key (compared case-insensitively) or adding one before the closing
 * fence. A Document without a closed block gets a new block at the top. Empty
 * values are skipped.
 * @param {string} markdown
 * @param {Object<string,string|null|undefined>} entries
 * @returns {string}
 */
export function setFrontMatterValues(markdown, entries) {
    const pairs = Object.entries(entries || {})
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([key, value]) => key && value);
    const source = markdown ?? '';
    if (pairs.length === 0) return source;

    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/);
    const { start, end } = findFrontMatterBlock(lines);

    if (start === -1) {
        const block = [FRONT_MATTER_FENCE, ...pairs.map(([k, v]) => `${k}: ${v}`), FRONT_MATTER_FENCE];
        return source ? `${block.join(newline)}${newline}${newline}${source}` : `${block.join(newline)}${newline}`;
    }

    const inside = lines.slice(start + 1, end);
    const added = [];
    for (const [key, value] of pairs) {
        const wanted = key.toLowerCase();
        const at = inside.findIndex((line) => lineKey(line)?.toLowerCase() === wanted);
        if (at === -1) added.push(`${key}: ${value}`);
        else inside[at] = `${key}: ${value}`;
    }

    return [
        ...lines.slice(0, start + 1),
        ...inside,
        ...added,
        ...lines.slice(end),
    ].join(newline);
}

/**
 * Remove `key: value` lines (keys compared case-insensitively) from the
 * Document's front matter. A block left empty is removed with the blank line
 * that followed it.
 * @param {string} markdown
 * @param {string[]} keys
 * @returns {string}
 */
export function removeFrontMatterKeys(markdown, keys) {
    const source = markdown ?? '';
    const unwanted = new Set((keys || []).map((key) => key.toLowerCase()));
    if (unwanted.size === 0) return source;

    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/);
    const { start, end } = findFrontMatterBlock(lines);
    if (start === -1) return source;

    const inside = lines.slice(start + 1, end).filter((line) => {
        const key = lineKey(line);
        return !(key !== null && unwanted.has(key.toLowerCase()));
    });
    if (inside.length === end - start - 1) return source;

    if (inside.every((line) => line.trim() === '')) {
        let after = end + 1;
        if (after < lines.length && lines[after].trim() === '') after += 1;
        return [...lines.slice(0, start), ...lines.slice(after)].join(newline);
    }
    return [...lines.slice(0, start + 1), ...inside, ...lines.slice(end)].join(newline);
}

/** Longest tag name, in characters, after trimming. Longer names are ignored, never cut. */
export const MAX_TAG_LENGTH = 50;
/** Most tags read from one Document. */
export const MAX_TAGS_PER_DOCUMENT = 100;

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', ' ']);

/** Collapse runs of white space to one space and trim, without a regular expression. */
function collapseWhitespace(text) {
    let out = '';
    let pendingSpace = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (WHITESPACE.has(ch)) {
            pendingSpace = out.length > 0;
            continue;
        }
        if (pendingSpace) out += ' ';
        pendingSpace = false;
        out += ch;
    }
    return out;
}

/**
 * A tag name as written, trimmed and with white space collapsed, or null when
 * it is empty or longer than {@link MAX_TAG_LENGTH}.
 * @param {unknown} value
 * @returns {string|null}
 */
export function tagDisplayName(value) {
    if (typeof value !== 'string') return null;
    // Only a short value can be a name; checking first keeps the work small
    // however long a hostile line is.
    let text = value;
    if (text.length > MAX_TAG_LENGTH * 4) {
        text = text.trim();
        if (text.length > MAX_TAG_LENGTH * 4) return null;
    }
    const label = collapseWhitespace(text);
    if (!label || label.length > MAX_TAG_LENGTH) return null;
    return label;
}

/**
 * The canonical form of a tag name: trimmed, white space runs collapsed to one
 * space, letters lower-cased. The key of a `tags` row, of a tag filter and of
 * a `tag:` search part.
 * @param {unknown} value
 * @returns {string|null} null for an empty name or one over {@link MAX_TAG_LENGTH}
 */
export function canonicalTagName(value) {
    const label = tagDisplayName(value);
    return label === null ? null : label.toLowerCase();
}

/** A value without a trailing YAML comment (` # …`), trimmed. */
function stripComment(value) {
    const space = value.indexOf(' #');
    const tab = value.indexOf('\t#');
    const cut = space === -1 ? tab : tab === -1 ? space : Math.min(space, tab);
    return (cut === -1 ? value : value.slice(0, cut)).trim();
}

/** One scalar: the text between matching quotes, or the trimmed text itself. */
function scalarValue(value) {
    const text = value.trim();
    if (text.length >= 2) {
        const quote = text[0];
        if ((quote === '"' || quote === "'") && text[text.length - 1] === quote) {
            return text.slice(1, -1);
        }
    }
    return text;
}

/**
 * The items of an inline list's inner text (`a, "b, c", 'd'`), split on commas
 * outside quotes. Stops after {@link MAX_TAGS_PER_DOCUMENT} items.
 * @param {string} inner
 * @returns {string[]}
 */
function inlineItems(inner) {
    const items = [];
    let from = 0;
    let quote = null;
    for (let i = 0; i < inner.length && items.length <= MAX_TAGS_PER_DOCUMENT; i += 1) {
        const ch = inner[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === ',') {
            items.push(inner.slice(from, i));
            from = i + 1;
        }
    }
    if (items.length <= MAX_TAGS_PER_DOCUMENT) items.push(inner.slice(from));
    return items;
}

/** A line of the block that holds a key at the top level (not indented, not a list item or comment). */
function isTopLevelKeyLine(line) {
    if (!line || line[0] === ' ' || line[0] === '\t' || line[0] === '-' || line[0] === '#') return false;
    return lineKey(line) !== null;
}

/**
 * The raw values a Document's front matter declares under `tags`, in order.
 * @param {string} markdown
 * @returns {string[]}
 */
function rawTagValues(markdown) {
    if (!markdown || typeof markdown !== 'string') return [];
    const lines = markdown.split(/\r?\n/);
    const { start, end } = findFrontMatterBlock(lines);
    if (start === -1) return [];

    for (let idx = start + 1; idx < end; idx += 1) {
        const line = lines[idx];
        if (!isTopLevelKeyLine(line) || lineKey(line).toLowerCase() !== 'tags') continue;
        const value = stripComment(line.slice(line.indexOf(':') + 1));
        if (value) {
            if (value === '~' || value === 'null') return [];
            if (value[0] === '[' && value[value.length - 1] === ']') {
                return inlineItems(value.slice(1, -1)).map(scalarValue);
            }
            return [scalarValue(value)];
        }
        // A block list on the following lines, up to the next key.
        const values = [];
        for (let item = idx + 1; item < end && values.length <= MAX_TAGS_PER_DOCUMENT * 2; item += 1) {
            const trimmed = lines[item].trim();
            if (!trimmed || trimmed[0] === '#' || trimmed === '-') continue;
            if (!trimmed.startsWith('- ')) break;
            values.push(scalarValue(stripComment(trimmed.slice(2))));
        }
        return values;
    }
    return [];
}

/**
 * The tags a Document declares in its front matter, as `{ name, label }`:
 * `name` is the canonical name ({@link canonicalTagName}), `label` the first
 * spelling found. `tags` may be a list on the following lines, a single
 * string or an inline `[a, b]` list; items may be quoted, and a ` # comment`
 * is ignored. Duplicates are dropped, names that are empty or longer than
 * {@link MAX_TAG_LENGTH} are ignored, and at most
 * {@link MAX_TAGS_PER_DOCUMENT} are read. The block rules are
 * {@link findFrontMatterBlock}'s: an unclosed block has no tags. Linear in the
 * length of the text.
 * @param {string} markdown
 * @returns {{ name: string, label: string }[]}
 */
export function readTagEntries(markdown) {
    const seen = new Set();
    const entries = [];
    for (const raw of rawTagValues(markdown)) {
        const label = tagDisplayName(raw);
        if (label === null) continue;
        const name = label.toLowerCase();
        if (seen.has(name)) continue;
        seen.add(name);
        entries.push({ name, label });
        if (entries.length >= MAX_TAGS_PER_DOCUMENT) break;
    }
    return entries;
}

/**
 * The canonical names of the tags a Document declares, in order, without
 * duplicates (see {@link readTagEntries}).
 * @param {string} markdown
 * @returns {string[]}
 */
export function readTags(markdown) {
    return readTagEntries(markdown).map((entry) => entry.name);
}
