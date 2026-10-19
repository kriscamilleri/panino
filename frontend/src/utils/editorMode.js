/**
 * Which pane a phone opens a Document in.
 */

export const MODE_WRITE = 'write';
export const MODE_PREVIEW = 'preview';

/** Values of the "Open notes in" setting. */
export const OPEN_IN_AUTO = 'auto';
export const OPEN_NOTES_IN = [OPEN_IN_AUTO, MODE_PREVIEW, MODE_WRITE];

/**
 * @param {object} input
 * @param {string} [input.requested] `?mode=` from the route; wins when valid
 * @param {string} [input.preference] the "Open notes in" setting
 * @param {string} [input.content] the Document body
 * @returns {'write'|'preview'}
 */
export function resolveInitialMode({ requested, preference, content } = {}) {
    if (requested === MODE_WRITE || requested === MODE_PREVIEW) return requested;
    if (preference === MODE_WRITE || preference === MODE_PREVIEW) return preference;
    // A new Document has only its generated heading, or nothing, to preview.
    const body = String(content ?? '').replace(/^#[^\n]*\n*/, '').trim();
    return body ? MODE_PREVIEW : MODE_WRITE;
}
