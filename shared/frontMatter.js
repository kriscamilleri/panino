/**
 * The YAML-like front matter block at the top of a Document: a `---` line,
 * `key: value` lines, and a closing `---`. Only flat `key: value` pairs are
 * read; nested values (indented lines), list items and comments may sit in the
 * block and are skipped. Shared by the frontend (Preview, templates) and the
 * API (server-side rendering, Document properties), so both read a Document
 * the same way.
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
