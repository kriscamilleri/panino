/**
 * Tag colours (docs/specs/active/tag-system.md §4.2). A `tags` row stores a
 * palette key, never a hex value, so colours can be retuned without touching
 * data. Rows in a space come from other members' clients, so every colour
 * reaches the page through {@link tagPaletteEntry}, which turns any unknown key
 * into `neutral`.
 *
 * Pastel, and consistent by construction: every hue has the same OKLCH
 * lightness and chroma, so no colour shouts louder than another.
 *   - `fill`  the chip's background in light mode   (OKLCH L 0.935, C 0.055)
 *   - `ink`   its border and `#` glyph in light mode (OKLCH L 0.60,  C 0.13)
 *   - `darkFill` / `darkInk` the same roles in dark mode (L 0.33 C 0.055 / L 0.84 C 0.10)
 * The tag's name is drawn in the normal text colour, never in the tag colour.
 * Hues sit at 2–195°: blue (200–260°) is reserved for links, and violets fall
 * too close to `--pn-accent`. Checked by `scripts/verify-tag-palette.cjs` and
 * `tagPaletteVerify.js`.
 */

export const NEUTRAL_TAG_COLOR = 'neutral';

/**
 * @typedef {{ key: string, label: string, hex: string, fill: string, ink: string, darkFill: string, darkInk: string }} TagPaletteEntry
 * `hex` is `ink`, kept for callers that need one colour (a dot, a swatch border).
 */

const ENTRIES = [
    { key: 'neutral', label: 'Neutral', fill: '#ebe9e7', ink: '#7a736d', darkFill: '#363431', darkInk: '#cbc6c1' },
    { key: 'rose', label: 'Rose', fill: '#ffdbe6', ink: '#be5b7a', darkFill: '#4d2933', darkInk: '#ffafc5' },
    { key: 'coral', label: 'Coral', fill: '#ffddd2', ink: '#c15f4b', darkFill: '#4e2a23', darkInk: '#ffb3a1' },
    { key: 'apricot', label: 'Apricot', fill: '#ffe2c4', ink: '#b56c15', darkFill: '#492f15', darkInk: '#f9bc85' },
    { key: 'butter', label: 'Butter', fill: '#f4eac1', ink: '#967f00', darkFill: '#3d3510', darkInk: '#ddcb7d' },
    { key: 'pistachio', label: 'Pistachio', fill: '#e1f1c9', ink: '#6f8d2a', darkFill: '#2f3a19', darkInk: '#bcd68e' },
    { key: 'mint', label: 'Mint', fill: '#ccf5dc', ink: '#219761', darkFill: '#193e2a', darkInk: '#91dfb2' },
    { key: 'seafoam', label: 'Seafoam', fill: '#bff6f5', ink: '#009798', darkFill: '#033e3e', darkInk: '#73dfdf' },
];

/** @type {ReadonlyArray<TagPaletteEntry>} */
export const TAG_PALETTE = Object.freeze(ENTRIES.map((entry) => Object.freeze({ ...entry, hex: entry.ink })));

const BY_KEY = new Map(TAG_PALETTE.map((entry) => [entry.key, entry]));

/**
 * The palette key a stored colour stands for: itself when it is a key, else
 * `neutral` (empty, unknown, or anything another client wrote).
 * @param {unknown} color
 * @returns {string}
 */
export function tagColorKey(color) {
    return typeof color === 'string' && BY_KEY.has(color) ? color : NEUTRAL_TAG_COLOR;
}

/**
 * The palette entry to draw a stored colour with (neutral for anything unknown).
 * @param {unknown} color
 * @returns {TagPaletteEntry}
 */
export function tagPaletteEntry(color) {
    return BY_KEY.get(tagColorKey(color));
}

/**
 * One hex value for a stored colour (the light-mode ink).
 * @param {unknown} color
 * @returns {string}
 */
export function tagColorHex(color) {
    return tagPaletteEntry(color).ink;
}

/**
 * CSS custom properties that draw a tag in both themes; set them on the
 * element and let `.pn-tag-swatch` / the chip's styles pick the theme.
 * @param {unknown} color
 * @returns {Record<string, string>}
 */
export function tagColorStyle(color) {
    const entry = tagPaletteEntry(color);
    return {
        '--tag-fill': entry.fill,
        '--tag-ink': entry.ink,
        '--tag-fill-dark': entry.darkFill,
        '--tag-ink-dark': entry.darkInk,
    };
}

/**
 * Whether a value may be written as a tag colour: a palette key, or empty for
 * neutral.
 * @param {unknown} color
 * @returns {boolean}
 */
export function isTagColor(color) {
    return color === '' || (typeof color === 'string' && BY_KEY.has(color));
}
