/**
 * The YAML-like front matter block at the top of a Document: a `---` line,
 * `key: value` lines, and a closing `---`. Only flat `key: value` pairs are
 * read; anything else inside the block is skipped. Shared by the frontend
 * (Preview, templates) and the API (server-side rendering), so both read a
 * Document the same way.
 */

const FRONT_MATTER_FENCE = '---';

/**
 * Locate the block. `start` is the index of the opening fence line, `end` the
 * closing one; both are -1 when the Document has no closed block.
 * @param {string[]} lines
 * @returns {{ start: number, end: number }}
 */
function findBlock(lines) {
    let start = 0;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    if (start >= lines.length || lines[start].trim() !== FRONT_MATTER_FENCE) {
        return { start: -1, end: -1 };
    }
    for (let end = start + 1; end < lines.length; end += 1) {
        if (lines[end].trim() === FRONT_MATTER_FENCE) return { start, end };
    }
    return { start: -1, end: -1 };
}

/**
 * Split a Document into its front matter values and the body after the block.
 * A block that is opened but never closed is read to the end of the Document,
 * which leaves an empty body.
 * @param {string} markdown
 * @returns {{ metadata: Object<string,string>, body: string }}
 */
export function parseFrontMatter(markdown) {
    if (!markdown) return { metadata: {}, body: '' };
    const lines = markdown.split(/\r?\n/);
    let idx = 0;
    while (idx < lines.length && lines[idx].trim() === '') idx += 1;
    if (idx >= lines.length || lines[idx].trim() !== FRONT_MATTER_FENCE) {
        return { metadata: {}, body: markdown };
    }

    const metadata = {};
    idx += 1;
    for (; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const trimmed = line.trim();
        if (trimmed === FRONT_MATTER_FENCE) {
            idx += 1;
            break;
        }
        if (!trimmed) continue;
        const match = line.match(/^([^:\n]+?)\s*:\s*(.+)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (key) metadata[key] = value;
        }
    }

    const body = lines.slice(idx).join('\n');
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
    const { start, end } = findBlock(lines);

    if (start === -1) {
        const block = [FRONT_MATTER_FENCE, ...pairs.map(([k, v]) => `${k}: ${v}`), FRONT_MATTER_FENCE];
        return source ? `${block.join(newline)}${newline}${newline}${source}` : `${block.join(newline)}${newline}`;
    }

    const inside = lines.slice(start + 1, end);
    const added = [];
    for (const [key, value] of pairs) {
        const wanted = key.toLowerCase();
        const at = inside.findIndex((line) => {
            const match = line.match(/^\s*([^:\n]+?)\s*:/);
            return match && match[1].trim().toLowerCase() === wanted;
        });
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
    const { start, end } = findBlock(lines);
    if (start === -1) return source;

    const inside = lines.slice(start + 1, end).filter((line) => {
        const match = line.match(/^\s*([^:\n]+?)\s*:/);
        return !(match && unwanted.has(match[1].trim().toLowerCase()));
    });
    if (inside.length === end - start - 1) return source;

    if (inside.every((line) => line.trim() === '')) {
        let after = end + 1;
        if (after < lines.length && lines[after].trim() === '') after += 1;
        return [...lines.slice(0, start), ...lines.slice(after)].join(newline);
    }
    return [...lines.slice(0, start + 1), ...inside, ...lines.slice(end)].join(newline);
}
