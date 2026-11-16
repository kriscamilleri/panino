// stripInline backtracks on long hostile lines, so it strips only the start of
// a line (integration fix, 2026-11-08).
import { describe, expect, it } from 'vitest';
import { STRIP_INLINE_MAX, stripInline } from '@/utils/markdownSnippet';

describe('stripInline on hostile lines', () => {
    it('stays fast on a 2 MiB line that would backtrack', () => {
        const started = performance.now();
        for (const piece of ['{{ ', '[', '![', '**', '`']) stripInline(piece.repeat(Math.ceil((2 * 1024 * 1024) / piece.length)));
        expect(performance.now() - started).toBeLessThan(500);
    });

    it('still strips markup within the limit', () => {
        expect(stripInline('**bold** and [a link](x) and {{ name }}')).toBe('bold and a link and name');
        expect(stripInline('x'.repeat(STRIP_INLINE_MAX + 50))).toHaveLength(STRIP_INLINE_MAX);
    });
});
