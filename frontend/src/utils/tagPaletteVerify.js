import { TAG_PALETTE } from './tagPalette.js';
import {
    DARK_SURFACE,
    LIGHT_SURFACE,
    PN_ACCENT,
    PN_PRIMARY,
    contrastRatio,
    deltaE2000,
    hueInBlueRange,
} from './identityPaletteVerify.js';

/**
 * Verification of the tag palette (docs/specs/active/tag-system.md §4.2), shared
 * by `scripts/verify-tag-palette.cjs` and the unit test. A tag colour is drawn
 * as a chip border, a tint and a `#` glyph, never as the colour of the name, so
 * it is held to the graphical-object threshold. Each entry must:
 *   - clear >= 3:1 against both surfaces;
 *   - be at least Delta E 12 from --pn-primary, --pn-accent and every other entry;
 *   - keep its hue outside the 200-260 degree blue range (blue is for links).
 */

const SWATCH_MIN_CONTRAST = 3.0;
const MIN_DELTA_E = 12.0;

/**
 * @param {ReadonlyArray<{ key: string, hex: string }>} [palette]
 * @returns {{ violations: string[] }}
 */
export function verifyTagPalette(palette = TAG_PALETTE) {
    const violations = [];
    const keys = new Set();

    palette.forEach(({ key, hex }, index) => {
        if (keys.has(key)) violations.push(`${key} appears twice`);
        keys.add(key);

        const vsLight = contrastRatio(hex, LIGHT_SURFACE);
        const vsDark = contrastRatio(hex, DARK_SURFACE);
        if (vsLight < SWATCH_MIN_CONTRAST) {
            violations.push(`${key} ${hex} fails contrast vs light surface (${vsLight.toFixed(2)})`);
        }
        if (vsDark < SWATCH_MIN_CONTRAST) {
            violations.push(`${key} ${hex} fails contrast vs dark surface (${vsDark.toFixed(2)})`);
        }

        const dEprimary = deltaE2000(hex, PN_PRIMARY);
        const dEaccent = deltaE2000(hex, PN_ACCENT);
        if (dEprimary < MIN_DELTA_E) {
            violations.push(`${key} ${hex} is too close to --pn-primary (Delta E ${dEprimary.toFixed(2)})`);
        }
        if (dEaccent < MIN_DELTA_E) {
            violations.push(`${key} ${hex} is too close to --pn-accent (Delta E ${dEaccent.toFixed(2)})`);
        }
        if (hueInBlueRange(hex)) {
            violations.push(`${key} ${hex} falls in the reserved blue hue range (200-260°)`);
        }

        for (const other of palette.slice(index + 1)) {
            const distance = deltaE2000(hex, other.hex);
            if (distance < MIN_DELTA_E) {
                violations.push(`${key} and ${other.key} are too close (Delta E ${distance.toFixed(2)})`);
            }
        }
    });

    if (!keys.has('neutral')) violations.push('the palette has no neutral entry');
    return { violations };
}
