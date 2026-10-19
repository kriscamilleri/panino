/**
 * Locate and toggle markdown task items (`- [ ]` / `- [x]`) by their order in
 * the source. The Preview renders checkboxes in source order, so the Nth
 * rendered checkbox is the Nth task line found here. Fenced code and the
 * front-matter block render no checkboxes and are skipped.
 */

// Optional blockquote markers, indentation, a list marker, then the box.
const TASK_LINE = /^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s|$))/;
const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;

/**
 * Line indices of every task item, in source order.
 *
 * @param {string} source markdown text
 * @returns {number[]} zero-based line numbers
 */
export function findTaskLines(source) {
    const lines = String(source ?? '').split('\n');
    const result = [];
    let fence = null;
    let index = 0;

    // A front-matter block only counts when it opens the document.
    if (lines[0]?.trim() === '---') {
        const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
        if (close > 0) index = close + 1;
    }

    for (; index < lines.length; index += 1) {
        const line = lines[index];
        const fenceMatch = line.match(FENCE);
        if (fence) {
            if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            continue;
        }
        if (TASK_LINE.test(line)) result.push(index);
    }
    return result;
}

/**
 * Whether the task on a given line is ticked.
 *
 * @param {string} line one source line
 * @returns {boolean}
 */
export function isTaskChecked(line) {
    const match = String(line ?? '').match(TASK_LINE);
    return Boolean(match && match[2] !== ' ');
}

/**
 * Toggle the Nth task item.
 *
 * @param {string} source markdown text
 * @param {number} taskIndex zero-based position among task items
 * @param {number} [expectedCount] how many checkboxes the caller rendered; a
 *   different count means the two disagree and nothing is changed
 * @returns {{ text: string, line: number, checked: boolean } | null}
 */
export function toggleTaskAt(source, taskIndex, expectedCount) {
    const text = String(source ?? '');
    const taskLines = findTaskLines(text);
    if (expectedCount !== undefined && expectedCount !== taskLines.length) return null;
    const lineNumber = taskLines[taskIndex];
    if (lineNumber === undefined) return null;

    const lines = text.split('\n');
    const checked = !isTaskChecked(lines[lineNumber]);
    lines[lineNumber] = lines[lineNumber].replace(TASK_LINE, `$1${checked ? 'x' : ' '}$3`);
    return { text: lines.join('\n'), line: lineNumber, checked };
}
