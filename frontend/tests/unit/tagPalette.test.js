// The pastel tag palette (tag-system.md §4.2): every colour passes the contrast,
// distance and hue rules the verification script checks, in both themes, and
// stored values outside it draw as neutral.
import { describe, expect, it } from 'vitest';
import { NEUTRAL_TAG_COLOR, TAG_PALETTE, isTagColor, tagColorHex, tagColorKey, tagColorStyle, tagPaletteEntry } from '@/utils/tagPalette';
import { verifyTagPalette } from '@/utils/tagPaletteVerify';

const entry = (key, fill, ink, darkFill, darkInk) => ({ key, fill, ink, darkFill, darkInk });

describe('tag palette', () => {
    it('passes every rule', () => {
        expect(verifyTagPalette().violations).toEqual([]);
        expect(TAG_PALETTE.some((e) => e.key === NEUTRAL_TAG_COLOR)).toBe(true);
    });

    it('reports colours that fail', () => {
        const { violations } = verifyTagPalette([
            entry('faint', '#fafafa', '#e5e5e5', '#202020', '#2a2a2a'), // ink too light on both themes
            entry('blue', '#dbeafe', '#2563eb', '#1e2a4a', '#93c5fd'),
            entry('teal', '#e0eeef', '#77a0a5', '#203033', '#a8c8cc'),
            entry('coral', '#ffddd2', '#c15f4b', '#4e2a23', '#ffb3a1'),
            entry('coral2', '#ffded3', '#c2604c', '#4e2a23', '#ffb3a1'),
        ]);
        const text = violations.join('\n');
        expect(text).toMatch(/faint: ink vs light surface/);
        expect(text).toMatch(/faint: dark ink vs dark surface/);
        expect(text).toMatch(/blue .* blue hue/);
        expect(text).toMatch(/teal .* --pn-primary/);
        expect(text).toMatch(/coral and coral2 inks are too close/);
        expect(text).toMatch(/coral and coral2 fills are too close/);
        expect(text).toMatch(/no neutral entry/);
    });

    it('keeps every hue at the same pastel lightness, so no tag shouts louder', () => {
        // Relative luminance of the fills stays in a narrow band (OKLCH L 0.935 for all hues).
        const luminance = (hex) => {
            const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
                .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const fills = TAG_PALETTE.map((e) => luminance(e.fill));
        expect(Math.max(...fills) - Math.min(...fills)).toBeLessThan(0.08);
    });

    it('has unique, frozen keys', () => {
        expect(new Set(TAG_PALETTE.map((e) => e.key)).size).toBe(TAG_PALETTE.length);
        expect(Object.isFrozen(TAG_PALETTE)).toBe(true);
    });

    it('draws anything that is not a key as neutral', () => {
        const neutral = tagPaletteEntry(NEUTRAL_TAG_COLOR);
        for (const value of ['', null, undefined, 'CORAL', '#ff0000', 'coral; background:url(x)', 'red', 42, {}]) {
            expect(tagColorKey(value)).toBe(NEUTRAL_TAG_COLOR);
            expect(tagColorHex(value)).toBe(neutral.ink);
            expect(tagColorStyle(value)['--tag-fill']).toBe(neutral.fill);
        }
        expect(tagColorHex('seafoam')).toBe('#009798');
        expect(tagColorStyle('mint')).toEqual({ '--tag-fill': '#ccf5dc', '--tag-ink': '#219761', '--tag-fill-dark': '#193e2a', '--tag-ink-dark': '#91dfb2' });
        expect(isTagColor('')).toBe(true);
        expect(isTagColor('seafoam')).toBe(true);
        expect(isTagColor('#009798')).toBe(false);
    });
});
