/**
 * Tag colours (docs/specs/active/tag-system.md §4.2). A `tags` row stores a
 * palette key, never a hex value, so colours can be retuned for contrast
 * without touching data. Rows in a space come from other members' clients, so
 * every colour reaches the page through {@link tagColorHex}, which turns any
 * unknown key into `neutral`.
 *
 * Checked by `scripts/verify-tag-palette.cjs` and `tagPaletteVerify.js`.
 */

export const NEUTRAL_TAG_COLOR = 'neutral';

/** @type {ReadonlyArray<{ key: string, label: string, hex: string }>} */
export const TAG_PALETTE = Object.freeze([
    { key: 'neutral', label: 'Neutral', hex: '#78716c' },
    { key: 'red', label: 'Red', hex: '#dc2626' },
    { key: 'orange', label: 'Orange', hex: '#c2410c' },
    { key: 'amber', label: 'Amber', hex: '#a16207' },
    { key: 'green', label: 'Green', hex: '#15803d' },
    { key: 'teal', label: 'Teal', hex: '#0f766e' },
    { key: 'violet', label: 'Violet', hex: '#7c3aed' },
    { key: 'pink', label: 'Pink', hex: '#db2777' },
].map((entry) => Object.freeze(entry)));

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
 * The hex value to draw a stored colour with.
 * @param {unknown} color
 * @returns {string}
 */
export function tagColorHex(color) {
    return BY_KEY.get(tagColorKey(color)).hex;
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
