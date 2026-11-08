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
 * Verification of the pastel tag palette (docs/specs/active/tag-system.md §4.2),
 * shared by `scripts/verify-tag-palette.cjs` and the unit test. A chip is a
 * pastel `fill` with a border and `#` glyph in `ink`, and the name in the normal
 * text colour; dark mode uses `darkFill` and `darkInk`. Each entry must:
 *   - ink: >= 3:1 against the page surface and against its own fill, in both themes
 *     (the glyph and border are graphical objects);
 *   - text: the normal text colour >= 4.5:1 on the fill, in both themes;
 *   - ink at least Delta E 12 from --pn-primary, --pn-accent and every other ink;
 *   - fill at least Delta E 5 from every other fill, so chips stay told apart;
 *   - a hue outside the 200-260 degree blue range (blue is for links).
 */

const GRAPHIC_MIN_CONTRAST = 3.0;
const TEXT_MIN_CONTRAST = 4.5;
const MIN_INK_DELTA_E = 12.0;
const MIN_FILL_DELTA_E = 5.0;

/** The text colours the chip's name is drawn in (Tailwind gray-900, and the dark theme's body text). */
export const LIGHT_TEXT = '#111827';
export const DARK_TEXT = '#e5e5e5';

/**
 * @param {ReadonlyArray<{ key: string, fill: string, ink: string, darkFill: string, darkInk: string }>} [palette]
 * @returns {{ violations: string[] }}
 */
export function verifyTagPalette(palette = TAG_PALETTE) {
    const violations = [];
    const keys = new Set();
    const need = (ok, message) => { if (!ok) violations.push(message); };

    palette.forEach((entry, index) => {
        const { key, fill, ink, darkFill, darkInk } = entry;
        need(!keys.has(key), `${key} appears twice`);
        keys.add(key);

        const checks = [
            ['ink vs light surface', contrastRatio(ink, LIGHT_SURFACE), GRAPHIC_MIN_CONTRAST],
            ['ink vs its fill', contrastRatio(ink, fill), GRAPHIC_MIN_CONTRAST],
            ['text on fill', contrastRatio(LIGHT_TEXT, fill), TEXT_MIN_CONTRAST],
            ['dark ink vs dark surface', contrastRatio(darkInk, DARK_SURFACE), GRAPHIC_MIN_CONTRAST],
            ['dark ink vs its dark fill', contrastRatio(darkInk, darkFill), GRAPHIC_MIN_CONTRAST],
            ['dark text on dark fill', contrastRatio(DARK_TEXT, darkFill), TEXT_MIN_CONTRAST],
        ];
        for (const [what, ratio, min] of checks) need(ratio >= min, `${key}: ${what} is ${ratio.toFixed(2)}:1 (needs ${min}:1)`);

        const dEprimary = deltaE2000(ink, PN_PRIMARY);
        const dEaccent = deltaE2000(ink, PN_ACCENT);
        need(dEprimary >= MIN_INK_DELTA_E, `${key} ${ink} is too close to --pn-primary (Delta E ${dEprimary.toFixed(2)})`);
        need(dEaccent >= MIN_INK_DELTA_E, `${key} ${ink} is too close to --pn-accent (Delta E ${dEaccent.toFixed(2)})`);
        need(key === 'neutral' || !hueInBlueRange(ink), `${key} ${ink} falls in the reserved blue hue range (200-260°)`);

        for (const other of palette.slice(index + 1)) {
            const inkDistance = deltaE2000(ink, other.ink);
            const fillDistance = deltaE2000(fill, other.fill);
            need(inkDistance >= MIN_INK_DELTA_E, `${key} and ${other.key} inks are too close (Delta E ${inkDistance.toFixed(2)})`);
            need(fillDistance >= MIN_FILL_DELTA_E, `${key} and ${other.key} fills are too close (Delta E ${fillDistance.toFixed(2)})`);
        }
    });

    need(keys.has('neutral'), 'the palette has no neutral entry');
    return { violations };
}
