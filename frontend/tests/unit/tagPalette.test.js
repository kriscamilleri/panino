// The tag palette (tag-system.md §4.2): every colour passes the contrast, distance and
// hue rules the verification script checks, and stored values outside it draw as neutral.
import { describe, expect, it } from 'vitest';
import { NEUTRAL_TAG_COLOR, TAG_PALETTE, isTagColor, tagColorHex, tagColorKey } from '@/utils/tagPalette';
import { verifyTagPalette } from '@/utils/tagPaletteVerify';

describe('tag palette', () => {
    it('passes every rule', () => {
        expect(verifyTagPalette().violations).toEqual([]);
        expect(TAG_PALETTE.some((entry) => entry.key === NEUTRAL_TAG_COLOR)).toBe(true);
    });

    it('reports colours that fail', () => {
        const { violations } = verifyTagPalette([
            { key: 'yellow', hex: '#f1c40f' },
            { key: 'gray', hex: '#95a5a6' },
            { key: 'blue', hex: '#2563eb' },
            { key: 'teal', hex: '#77a0a5' },
            { key: 'red', hex: '#dc2626' },
            { key: 'red2', hex: '#dd2727' },
        ]);
        expect(violations.join('\n')).toMatch(/yellow .* light surface/);
        expect(violations.join('\n')).toMatch(/gray .* light surface/);
        expect(violations.join('\n')).toMatch(/blue .* blue hue/);
        expect(violations.join('\n')).toMatch(/teal .* --pn-primary/);
        expect(violations.join('\n')).toMatch(/red and red2 are too close/);
        expect(violations.join('\n')).toMatch(/no neutral entry/);
    });

    it('has unique, frozen keys', () => {
        expect(new Set(TAG_PALETTE.map((entry) => entry.key)).size).toBe(TAG_PALETTE.length);
        expect(Object.isFrozen(TAG_PALETTE)).toBe(true);
    });

    it('draws anything that is not a key as neutral', () => {
        const neutral = TAG_PALETTE.find((entry) => entry.key === NEUTRAL_TAG_COLOR).hex;
        for (const value of ['', null, undefined, 'RED', '#ff0000', 'red; background:url(x)', 42, {}]) {
            expect(tagColorKey(value)).toBe(NEUTRAL_TAG_COLOR);
            expect(tagColorHex(value)).toBe(neutral);
        }
        expect(tagColorHex('teal')).toBe('#0f766e');
        expect(isTagColor('')).toBe(true);
        expect(isTagColor('teal')).toBe(true);
        expect(isTagColor('#0f766e')).toBe(false);
    });
});
