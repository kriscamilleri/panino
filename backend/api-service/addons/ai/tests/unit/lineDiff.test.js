// The unified line diff behind compare_revisions (docs/specs/proposed/ai-api-expansion.md §4.4).
import { describe, expect, it } from 'vitest';
import { DiffTooLargeError, MAX_DIFF_LINES, splitLines, unifiedLineDiff } from '../../lineDiff.js';

/** Apply a unified diff to `oldText` (texts ending in a newline), to check the hunks are exact. */
function applyDiff(oldText, diff) {
    const source = splitLines(oldText);
    const out = [];
    let at = 0;
    const lines = diff.split('\n');
    for (let i = 2; i < lines.length; i += 1) {
        const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(lines[i]);
        if (header) {
            const start = Number(header[1]);
            const length = header[2] === undefined ? 1 : Number(header[2]);
            const index = length === 0 ? start : start - 1;
            while (at < index) out.push(source[at++]);
            continue;
        }
        const line = lines[i];
        if (line === '') continue;
        if (line[0] === ' ') { out.push(`${line.slice(1)}\n`); at += 1; }
        if (line[0] === '-') at += 1;
        if (line[0] === '+') out.push(`${line.slice(1)}\n`);
    }
    while (at < source.length) out.push(source[at++]);
    return out.join('');
}

describe('splitLines', () => {
    it('keeps terminators and reads CRLF as LF', () => {
        expect(splitLines('')).toEqual([]);
        expect(splitLines(null)).toEqual([]);
        expect(splitLines('a\nb')).toEqual(['a\n', 'b']);
        expect(splitLines('a\r\nb\n')).toEqual(['a\n', 'b\n']);
        expect(splitLines('\n\n')).toEqual(['\n', '\n']);
    });
});

describe('unifiedLineDiff', () => {
    it('reports identical text', () => {
        expect(unifiedLineDiff('a\nb\n', 'a\nb\n')).toMatchObject({ identical: true, diff: '', added: 0, removed: 0, hunks: 0 });
        expect(unifiedLineDiff('a\r\nb', 'a\nb').identical).toBe(true);
    });

    it('writes a hunk with context and counts', () => {
        const oldText = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n') + '\n';
        const newText = ['one', 'two', 'three', 'FOUR', 'five', 'six', 'seven', 'eight'].join('\n') + '\n';
        const result = unifiedLineDiff(oldText, newText, { fromLabel: 'old', toLabel: 'new' });
        expect(result).toMatchObject({ added: 2, removed: 1, hunks: 1, identical: false, truncated: false });
        expect(result.diff).toBe([
            '--- old',
            '+++ new',
            '@@ -1,7 +1,8 @@',
            ' one',
            ' two',
            ' three',
            '-four',
            '+FOUR',
            ' five',
            ' six',
            ' seven',
            '+eight',
            '',
        ].join('\n'));
    });

    it('splits distant changes into hunks and honours context', () => {
        const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
        const changed = [...base];
        changed[2] = 'changed 3';
        changed[25] = 'changed 26';
        const result = unifiedLineDiff(base.join('\n'), changed.join('\n'), { context: 1 });
        expect(result.hunks).toBe(2);
        expect(result.diff).toContain('@@ -2,3 +2,3 @@');
        expect(result.diff).toContain('@@ -25,3 +25,3 @@');
        const none = unifiedLineDiff(base.join('\n'), changed.join('\n'), { context: 0 });
        expect(none.diff).toContain('@@ -3 +3 @@');
    });

    it('names an empty range by the line before it', () => {
        const result = unifiedLineDiff('a\nb\n', 'x\na\nb\n', { context: 0 });
        expect(result.diff).toContain('@@ -0,0 +1 @@');
        const deleted = unifiedLineDiff('a\nb\nc\n', 'a\nc\n', { context: 0 });
        expect(deleted.diff).toContain('@@ -2 +1,0 @@');
        expect(unifiedLineDiff('', 'new\n').diff).toContain('@@ -0,0 +1 @@');
    });

    it('marks a missing final newline', () => {
        const result = unifiedLineDiff('a\nb', 'a\nb\n');
        expect(result).toMatchObject({ added: 1, removed: 1 });
        expect(result.diff).toContain('-b\n\\ No newline at end of file\n+b\n');
    });

    it('produces hunks that rebuild the new text', () => {
        let seed = 7;
        const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        for (let round = 0; round < 40; round += 1) {
            const oldLines = Array.from({ length: Math.floor(random() * 40) }, () => `w${Math.floor(random() * 6)}`);
            const newLines = [];
            for (const line of oldLines) {
                const roll = random();
                if (roll < 0.15) continue;
                if (roll < 0.3) newLines.push(`n${Math.floor(random() * 6)}`);
                newLines.push(line);
            }
            if (random() < 0.5) newLines.push('tail');
            const oldText = oldLines.length ? `${oldLines.join('\n')}\n` : '';
            const newText = newLines.length ? `${newLines.join('\n')}\n` : '';
            const result = unifiedLineDiff(oldText, newText, { context: Math.floor(random() * 4) });
            if (result.identical) continue;
            expect(applyDiff(oldText, result.diff), `round ${round}`).toBe(newText);
            const plus = result.diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
            const minus = result.diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
            expect([plus, minus]).toEqual([result.added, result.removed]);
        }
    });

    it('finds a minimal edit', () => {
        const result = unifiedLineDiff('a\nb\nc\nd\ne\n', 'a\nc\nd\nx\ne\n');
        expect([result.added, result.removed]).toEqual([1, 1]);
        const moved = unifiedLineDiff('a\nb\nc\nd\n', 'b\nc\nd\na\n');
        expect([moved.added, moved.removed]).toEqual([1, 1]);
    });

    it('refuses too many lines or too many changes', () => {
        const big = 'x\n'.repeat(MAX_DIFF_LINES + 1);
        expect(() => unifiedLineDiff(big, 'y\n')).toThrow(DiffTooLargeError);
        const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
        const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
        expect(() => unifiedLineDiff(a, b, { maxEdits: 20 })).toThrow(DiffTooLargeError);
        expect(unifiedLineDiff(a, b, { maxEdits: 100 })).toMatchObject({ added: 50, removed: 50 });
    });

    it('cuts a long diff at the byte budget and says so, keeping full counts', () => {
        const oldText = Array.from({ length: 200 }, (_, i) => `old line ${i}`).join('\n');
        const newText = Array.from({ length: 200 }, (_, i) => `new line ${i}`).join('\n');
        const result = unifiedLineDiff(oldText, newText, { maxOutputBytes: 1000 });
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.diff, 'utf8')).toBeLessThanOrEqual(1001);
        expect([result.added, result.removed]).toEqual([200, 200]);
    });
});
