// A unified line diff for the v1 revision tools (docs/specs/proposed/ai-api-expansion.md
// §4.4). Pure: no database, no I/O. Myers' O(ND) algorithm after trimming the common
// prefix and suffix, with caps so a request cannot make the server do unbounded work:
// too many lines, or too many changed lines, is refused (DiffTooLargeError); a long
// result is cut at a byte budget and says so.
//
// node-diff3 (used by shared/contentMerge.js) is a dependency of the shared package,
// not of the API service, and has no work budget, so it is not used here.

/** Most lines either side may have. */
export const MAX_DIFF_LINES = 20000;
/** Most changed lines (removed plus added) a diff may have. */
export const MAX_EDIT_DISTANCE = 2000;
/** Most bytes of diff text returned; the rest is cut and `truncated` is set. */
export const MAX_DIFF_OUTPUT_BYTES = 100 * 1024;
export const DEFAULT_CONTEXT = 3;
export const MAX_CONTEXT = 10;

export class DiffTooLargeError extends Error {
    /** @param {'lines'|'changes'} reason */
    constructor(reason) {
        super(reason === 'lines' ? 'Too many lines to compare.' : 'Too many changed lines to compare.');
        this.reason = reason;
    }
}

/**
 * Lines with their terminators ("a\n", "b"), CRLF read as LF, so a final line
 * without a newline differs from the same line with one.
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
export function splitLines(text) {
    if (text === null || text === undefined || text === '') return [];
    return String(text).replace(/\r\n/g, '\n').match(/[^\n]*\n|[^\n]+$/g) || [];
}

/**
 * Myers' shortest edit script of `a` into `b`, as operations in order:
 * ' ' (both), '-' (a only), '+' (b only), each with its index into a or b.
 * @returns {{ op: ' '|'-'|'+', a: number, b: number }[]}
 */
function editScript(a, b, maxEdits) {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }

    const ops = [];
    for (let i = 0; i < start; i += 1) ops.push({ op: ' ', a: i, b: i });
    ops.push(...middleScript(a, b, start, endA, start, endB, maxEdits));
    for (let i = 0; endA + i < a.length; i += 1) ops.push({ op: ' ', a: endA + i, b: endB + i });
    return ops;
}

function middleScript(a, b, a0, a1, b0, b1, maxEdits) {
    const n = a1 - a0;
    const m = b1 - b0;
    if (n === 0 && m === 0) return [];
    if (n === 0) return Array.from({ length: m }, (_, i) => ({ op: '+', a: a0, b: b0 + i }));
    if (m === 0) return Array.from({ length: n }, (_, i) => ({ op: '-', a: a0 + i, b: b0 }));
    if (n + m > 2 * MAX_DIFF_LINES) throw new DiffTooLargeError('lines');

    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    // trace[d] is the part of v (diagonals -d-1 … d+1) that round d reads.
    const trace = [];
    let found = -1;
    for (let d = 0; d <= max; d += 1) {
        if (d > maxEdits) throw new DiffTooLargeError('changes');
        trace.push(v.slice(offset - d - 1, offset + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]))
                ? v[offset + k + 1]
                : v[offset + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
                x += 1;
                y += 1;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) {
                found = d;
                break;
            }
        }
        if (found >= 0) break;
    }

    const reversed = [];
    let x = n;
    let y = m;
    for (let d = found; d >= 0; d -= 1) {
        const saved = trace[d];
        const at = (k) => saved[k + d + 1];
        const k = x - y;
        const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
        const prevX = d === 0 ? 0 : at(prevK);
        const prevY = d === 0 ? 0 : prevX - prevK;
        while (x > prevX && y > prevY) {
            x -= 1;
            y -= 1;
            reversed.push({ op: ' ', a: a0 + x, b: b0 + y });
        }
        if (d > 0) {
            if (x === prevX) reversed.push({ op: '+', a: a0 + x, b: b0 + prevY });
            else reversed.push({ op: '-', a: a0 + prevX, b: b0 + y });
        }
        x = prevX;
        y = prevY;
    }
    return reversed.reverse();
}

function hunkRange(start, length) {
    // Unified diff convention: an empty range names the line before it.
    const first = length === 0 ? start : start + 1;
    return length === 1 ? `${first}` : `${first},${length}`;
}

function lineText(prefix, line) {
    const out = [`${prefix}${line.endsWith('\n') ? line.slice(0, -1) : line}`];
    if (!line.endsWith('\n')) out.push('\\ No newline at end of file');
    return out;
}

/**
 * A unified diff of `oldText` into `newText`.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ context?: number, fromLabel?: string, toLabel?: string, maxOutputBytes?: number, maxEdits?: number }} [options]
 * @returns {{ diff: string, added: number, removed: number, hunks: number, identical: boolean, truncated: boolean }}
 * @throws {DiffTooLargeError}
 */
export function unifiedLineDiff(oldText, newText, options = {}) {
    const context = Number.isInteger(options.context)
        ? Math.min(Math.max(options.context, 0), MAX_CONTEXT) : DEFAULT_CONTEXT;
    const maxOutputBytes = options.maxOutputBytes ?? MAX_DIFF_OUTPUT_BYTES;
    const a = splitLines(oldText);
    const b = splitLines(newText);
    if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) throw new DiffTooLargeError('lines');

    const ops = editScript(a, b, options.maxEdits ?? MAX_EDIT_DISTANCE);
    let added = 0;
    let removed = 0;
    for (const entry of ops) {
        if (entry.op === '+') added += 1;
        else if (entry.op === '-') removed += 1;
    }
    if (added === 0 && removed === 0) {
        return { diff: '', added: 0, removed: 0, hunks: 0, identical: true, truncated: false };
    }

    // Group changes into hunks: a change plus `context` lines either side,
    // merging hunks whose context would touch.
    const groups = [];
    for (let i = 0; i < ops.length; i += 1) {
        if (ops[i].op === ' ') continue;
        const from = Math.max(0, i - context);
        let to = i;
        while (to + 1 < ops.length) {
            let next = to + 1;
            while (next < ops.length && ops[next].op === ' ') next += 1;
            if (next < ops.length && next - to - 1 <= 2 * context) to = next;
            else break;
        }
        const end = Math.min(ops.length - 1, to + context);
        groups.push([from, end]);
        i = end;
    }

    const lines = [`--- ${options.fromLabel ?? 'a'}`, `+++ ${options.toLabel ?? 'b'}`];
    let bytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8') + 1, 0);
    let truncated = false;
    outer:
    for (const [from, end] of groups) {
        const slice = ops.slice(from, end + 1);
        const aStart = slice[0].a;
        const bStart = slice[0].b;
        const aLength = slice.filter((entry) => entry.op !== '+').length;
        const bLength = slice.filter((entry) => entry.op !== '-').length;
        const block = [`@@ -${hunkRange(aStart, aLength)} +${hunkRange(bStart, bLength)} @@`];
        for (const entry of slice) {
            if (entry.op === '+') block.push(...lineText('+', b[entry.b]));
            else block.push(...lineText(entry.op, a[entry.a]));
        }
        for (const line of block) {
            const size = Buffer.byteLength(line, 'utf8') + 1;
            if (bytes + size > maxOutputBytes) {
                truncated = true;
                break outer;
            }
            lines.push(line);
            bytes += size;
        }
    }

    return { diff: `${lines.join('\n')}\n`, added, removed, hunks: groups.length, identical: false, truncated };
}
