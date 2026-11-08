import { describe, expect, it } from 'vitest';
import { bandRect, scrimRects, withAlpha } from '@/utils/focusGeometry';

const contentBox = { left: 16, right: 624 };
const base = { contentBox, width: 640, totalHeight: 1000, rh: 20 };

describe('scrimRects', () => {
    it('covers above and below a block focus (2 rectangles)', () => {
        const rects = scrimRects({ ...base, focus: { startTop: 200, startX: 16, endTop: 260, endX: 624 } });
        expect(rects).toEqual([
            { x: 0, y: 0, w: 640, h: 200 },
            { x: 0, y: 280, w: 640, h: 720 },
        ]);
    });

    it('adds the two partial rows of a sentence that starts and ends mid-row (4)', () => {
        const rects = scrimRects({ ...base, focus: { startTop: 200, startX: 120, endTop: 240, endX: 300 } });
        expect(rects).toEqual([
            { x: 0, y: 0, w: 640, h: 200 },
            { x: 0, y: 200, w: 120, h: 20 },
            { x: 300, y: 240, w: 340, h: 20 },
            { x: 0, y: 260, w: 640, h: 740 },
        ]);
    });

    it('handles a single-row sentence', () => {
        const rects = scrimRects({ ...base, focus: { startTop: 200, startX: 120, endTop: 200, endX: 300 } });
        expect(rects).toHaveLength(4);
        expect(rects[1]).toEqual({ x: 0, y: 200, w: 120, h: 20 });
        expect(rects[2]).toEqual({ x: 300, y: 200, w: 340, h: 20 });
    });

    it('needs only one rectangle for a focus at the start or at the end (1)', () => {
        expect(scrimRects({ ...base, focus: { startTop: 0, startX: 16, endTop: 40, endX: 624 } }))
            .toEqual([{ x: 0, y: 60, w: 640, h: 940 }]);
        expect(scrimRects({ ...base, focus: { startTop: 900, startX: 16, endTop: 980, endX: 624 } }))
            .toEqual([{ x: 0, y: 0, w: 640, h: 900 }]);
    });

    it('dims the whole layer for an empty focus', () => {
        expect(scrimRects({ ...base, focus: null })).toEqual([{ x: 0, y: 0, w: 640, h: 1000 }]);
    });

    it('covers a selection union like any other focus', () => {
        const rects = scrimRects({ ...base, focus: { startTop: 100, startX: 16, endTop: 500, endX: 624 } });
        expect(rects.map((rect) => rect.y)).toEqual([0, 520]);
    });
});

describe('bandRect', () => {
    it('spans the full width of the row', () => {
        expect(bandRect({ rowTop: 240, rh: 22.4, width: 640 })).toEqual({ x: 0, y: 240, w: 640, h: 22.4 });
    });
});

describe('withAlpha', () => {
    it('reads computed colours and falls back to white', () => {
        expect(withAlpha('rgb(44, 44, 44)', 0.6)).toBe('rgb(44 44 44 / 0.6)');
        expect(withAlpha('rgba(255, 255, 255, 1)', 0.4)).toBe('rgb(255 255 255 / 0.4)');
        expect(withAlpha('transparent', 0.75)).toBe('rgb(255 255 255 / 0.75)');
        expect(withAlpha(undefined, 2)).toBe('rgb(255 255 255 / 1)');
    });
});
