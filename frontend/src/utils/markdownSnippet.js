/**
 * Plain-text previews of markdown for cards, list rows and search results.
 * No markup survives: headings lose their markers, emphasis and links keep
 * only their text, images, code fences, tables and HTML are skipped, and
 * checklist items keep their state so a card can draw a tick.
 */

/**
 * @typedef {{ kind: 'text'|'bullet'|'task', text: string, checked?: boolean }} SnippetLine
 */

const FENCE = /^\s*(`{3,}|~{3,})/;
const TASK = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Strip inline markdown from one line of text.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripInline(text) {
    return String(text ?? '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links → their text
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')        // reference links
        .replace(/<[^>]+>/g, '')                          // inline HTML
        .replace(/(\*\*|__)(.+?)\1/g, '$2')               // bold
        .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')         // italic
        .replace(/(^|\W)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1$2') // _italic_, never snake_case
        .replace(/~~(.+?)~~/g, '$1')                      // strikethrough
        .replace(/`([^`]*)`/g, '$1')                      // inline code
        .replace(/\{\{\s*([^}]+?)\s*\}\}/g, '$1')         // template variables
        .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')    // escapes
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTitle(title) {
    return stripInline(title).toLowerCase();
}

/**
 * Readable lines for a card preview.
 *
 * @param {string} markdown Document body
 * @param {object} [options]
 * @param {string} [options.title] dropped when the body opens with it as a heading
 * @param {number} [options.maxLines]
 * @returns {SnippetLine[]}
 */
export function toSnippetLines(markdown, { title = '', maxLines = 8 } = {}) {
    const lines = String(markdown ?? '').split(/\r?\n/);
    const result = [];
    let index = 0;
    let fence = null;

    if (lines[0]?.trim() === '---') {
        const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
        if (close > 0) index = close + 1;
    }

    let titleChecked = false;
    for (; index < lines.length && result.length < maxLines; index += 1) {
        const raw = lines[index];
        const fenceMatch = raw.match(FENCE);
        if (fence) {
            if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            continue;
        }
        let line = raw.replace(/^\s*(>\s*)+/, '');
        if (!line.trim()) continue;
        if (/^\s*(\\pagebreak|<!--.*-->|---\s*pagebreak\s*---|[-*_]{3,})\s*$/i.test(line)) continue;
        if (TABLE_RULE.test(line)) continue;

        const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
        if (heading) line = heading[1].replace(/\s+#+\s*$/, '');

        // createFile starts every Document with `# <title>`; the card shows
        // the title already.
        if (!titleChecked) {
            titleChecked = true;
            if (heading && title && normalizeTitle(line) === normalizeTitle(title)) continue;
        }

        const task = line.match(TASK);
        if (task) {
            const text = stripInline(task[2]);
            if (text) result.push({ kind: 'task', text, checked: task[1] !== ' ' });
            continue;
        }
        const bullet = !heading && line.match(BULLET);
        if (bullet) {
            const text = stripInline(bullet[1]);
            if (text) result.push({ kind: 'bullet', text });
            continue;
        }
        const text = stripInline(line.includes('|') ? line.split('|').map((cell) => cell.trim()).filter(Boolean).join(' · ') : line);
        if (text) result.push({ kind: 'text', text });
    }
    return result;
}

/**
 * One line of plain text for list rows.
 *
 * @param {string} markdown
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {number} [options.maxLength]
 * @returns {string}
 */
export function toSummary(markdown, { title = '', maxLength = 140 } = {}) {
    const text = toSnippetLines(markdown, { title, maxLines: 6 })
        .map((line) => (line.kind === 'task' ? `${line.checked ? '☑' : '☐'} ${line.text}` : line.text))
        .join(' · ');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/**
 * Title and body for a quick-capture Document. With no typed title the first
 * line becomes the title. With one, the body starts with it as a heading,
 * the way every new Document starts.
 *
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.body]
 * @returns {{ title: string, content: string } | null} null when there is nothing to save
 */
export function buildCaptureDocument({ title = '', body = '' } = {}) {
    const typedTitle = String(title).trim();
    const text = String(body).replace(/\s+$/, '');
    // A checklist with only its empty first box has no content yet.
    const hasBody = text.replace(/^\s*-\s*\[[ xX]\]\s*$/gm, '').trim().length > 0;
    if (!typedTitle && !hasBody) return null;

    if (typedTitle) {
        return {
            title: typedTitle.slice(0, 200),
            content: hasBody ? `# ${typedTitle}\n\n${text}\n` : `# ${typedTitle}\n\n`,
        };
    }
    const firstLine = text.split('\n').map((line) => stripInline(
        line.replace(/^\s*#{1,6}\s+/, '').replace(TASK, '$2').replace(BULLET, '$1'),
    )).find(Boolean) || 'Untitled';
    const derived = firstLine.length > 80 ? `${firstLine.slice(0, 79).trimEnd()}…` : firstLine;
    return { title: derived, content: `${text}\n` };
}
