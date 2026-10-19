/**
 * Pure text edits behind the phone key row. Each takes and returns an editor
 * state `{ value, selectionStart, selectionEnd }`, so the Editor applies them
 * through one path that keeps undo, drafts and live sessions consistent.
 */

function lineBounds(value, selectionStart, selectionEnd) {
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    // A selection that ends at the start of a line does not include that line.
    const endAnchor = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
        ? selectionEnd - 1
        : selectionEnd;
    const newline = value.indexOf('\n', endAnchor);
    return { start, end: newline === -1 ? value.length : newline };
}

/**
 * Rewrite every line the selection touches, keeping the selection on the
 * same text. Transforms only change a line's prefix, so a position keeps its
 * column measured from the end of that prefix.
 */
function mapLines(state, transform) {
    const { value, selectionStart, selectionEnd } = state;
    const { start, end } = lineBounds(value, selectionStart, selectionEnd);
    const lines = value.slice(start, end).split('\n');
    const rewritten = lines.map(transform);
    const oldStarts = [];
    const newStarts = [];
    let oldOffset = start;
    let newOffset = start;
    lines.forEach((line, index) => {
        oldStarts.push(oldOffset);
        newStarts.push(newOffset);
        oldOffset += line.length + 1;
        newOffset += rewritten[index].length + 1;
    });
    const growth = newOffset - oldOffset;

    const mapPosition = (position) => {
        if (position < start) return position;
        if (position > end) return position + growth;
        let index = oldStarts.length - 1;
        while (index > 0 && oldStarts[index] > position) index -= 1;
        const column = position - oldStarts[index];
        const delta = rewritten[index].length - lines[index].length;
        return newStarts[index] + Math.max(0, Math.min(rewritten[index].length, column + delta));
    };

    return {
        value: value.slice(0, start) + rewritten.join('\n') + value.slice(end),
        selectionStart: mapPosition(selectionStart),
        selectionEnd: mapPosition(selectionEnd),
    };
}

const HEADING = /^(#{1,6})\s+/;
const TASK = /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
const BULLET = /^(\s*)[-*+]\s+/;

/**
 * Cycle the heading level of the touched lines: none → # → ## → ### → none.
 */
export function cycleHeading(state) {
    return mapLines(state, (line) => {
        const match = line.match(HEADING);
        if (!match) return `# ${line}`;
        const level = match[1].length;
        const rest = line.slice(match[0].length);
        return level >= 3 ? rest : `${'#'.repeat(level + 1)} ${rest}`;
    });
}

/** Turn the touched lines into bullets, or plain lines if they all are. */
export function toggleBullet(state) {
    const { value, selectionStart, selectionEnd } = state;
    const { start, end } = lineBounds(value, selectionStart, selectionEnd);
    const allBullets = value.slice(start, end).split('\n')
        .every((line) => BULLET.test(line) && !TASK.test(line));
    return mapLines(state, (line) => {
        if (allBullets) return line.replace(BULLET, '$1');
        if (TASK.test(line)) return line.replace(TASK, '$1- ');
        return `- ${line}`;
    });
}

/** Turn the touched lines into tasks, or back into plain lines if they all are. */
export function toggleTask(state) {
    const { value, selectionStart, selectionEnd } = state;
    const { start, end } = lineBounds(value, selectionStart, selectionEnd);
    const allTasks = value.slice(start, end).split('\n').every((line) => TASK.test(line));
    return mapLines(state, (line) => {
        if (allTasks) return line.replace(TASK, '$1');
        if (TASK.test(line)) return line;
        if (BULLET.test(line)) return line.replace(BULLET, '$1- [ ] ');
        return `- [ ] ${line}`;
    });
}

/**
 * Wrap the selection in a marker pair, or unwrap it when it is already
 * wrapped. With nothing selected the caret lands between the markers.
 */
export function wrapSelection(state, before, after = before) {
    const { value, selectionStart, selectionEnd } = state;
    const selected = value.slice(selectionStart, selectionEnd);
    const outerBefore = value.slice(selectionStart - before.length, selectionStart);
    const outerAfter = value.slice(selectionEnd, selectionEnd + after.length);
    if (selected && outerBefore === before && outerAfter === after) {
        return {
            value: value.slice(0, selectionStart - before.length) + selected + value.slice(selectionEnd + after.length),
            selectionStart: selectionStart - before.length,
            selectionEnd: selectionEnd - before.length,
        };
    }
    return {
        value: value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd),
        selectionStart: selectionStart + before.length,
        selectionEnd: selectionEnd + before.length,
    };
}

/** `[selection](url)` with `url` selected; with no selection, the label is selected. */
export function insertLink(state) {
    const { value, selectionStart, selectionEnd } = state;
    const selected = value.slice(selectionStart, selectionEnd);
    const label = selected || 'text';
    const inserted = `[${label}](url)`;
    const nextValue = value.slice(0, selectionStart) + inserted + value.slice(selectionEnd);
    if (selected) {
        const urlStart = selectionStart + label.length + 3;
        return { value: nextValue, selectionStart: urlStart, selectionEnd: urlStart + 3 };
    }
    return { value: nextValue, selectionStart: selectionStart + 1, selectionEnd: selectionStart + 1 + label.length };
}

/** Indent the touched lines by two spaces (one nesting level in a list). */
export function indentLines(state) {
    return mapLines(state, (line) => `  ${line}`);
}

/** Insert text at the caret, replacing any selection. */
export function insertAtCaret(state, text) {
    const { value, selectionStart, selectionEnd } = state;
    const caret = selectionStart + text.length;
    return {
        value: value.slice(0, selectionStart) + text + value.slice(selectionEnd),
        selectionStart: caret,
        selectionEnd: caret,
    };
}

/** The key-row keys that edit text, in the order the Write key row shows them. */
export const WRITE_KEYS = Object.freeze([
    { id: 'heading', label: '#', name: 'Heading' },
    { id: 'bullet', label: '-', name: 'Bulleted list' },
    { id: 'task', label: '[ ]', name: 'Checklist item' },
    { id: 'bold', label: '**', name: 'Bold' },
    { id: 'italic', label: '_', name: 'Italic' },
    { id: 'code', label: '`', name: 'Inline code' },
    { id: 'link', label: '[]()', name: 'Link' },
    { id: 'indent', label: '⇥', name: 'Indent' },
]);

/**
 * Apply one key-row key to an editor state.
 *
 * @param {string} id one of WRITE_KEYS' ids
 * @param {{value: string, selectionStart: number, selectionEnd: number}} state
 * @returns {{value: string, selectionStart: number, selectionEnd: number}}
 */
export function applyKey(id, state) {
    switch (id) {
        case 'heading': return cycleHeading(state);
        case 'bullet': return toggleBullet(state);
        case 'task': return toggleTask(state);
        case 'bold': return wrapSelection(state, '**');
        case 'italic': return wrapSelection(state, '_');
        case 'code': return wrapSelection(state, '`');
        case 'link': return insertLink(state);
        case 'indent': return indentLines(state);
        default: throw new Error(`Unknown key ${id}`);
    }
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

/**
 * Enter inside a list item: continue the list on a new line (a new task is
 * unticked, a number counts up), or end the list when the item is empty.
 * Returns null when the caret is not in a list item, so Enter behaves
 * normally.
 */
export function continueList(state) {
    const { value, selectionStart, selectionEnd } = state;
    if (selectionStart !== selectionEnd) return null;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const newline = value.indexOf('\n', selectionStart);
    const end = newline === -1 ? value.length : newline;
    const match = value.slice(start, end).match(LIST_ITEM);
    if (!match) return null;
    const [, indent, marker, gap, box, text] = match;
    if (!text.trim()) {
        // An empty item ends the list.
        return { value: value.slice(0, start) + value.slice(end), selectionStart: start, selectionEnd: start };
    }
    const nextMarker = /^\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
    return insertAtCaret(state, `\n${indent}${nextMarker}${gap}${box ? '[ ] ' : ''}`);
}
