/**
 * Rectangles for typewriter mode's overlay (docs/specs/active/typewriter-mode.md
 * §4.3, §6): the current-row band and the dimming scrim. All coordinates are
 * px inside OverType's wrapper, which the overlay covers.
 */

/**
 * The scrim: at most four rectangles over everything outside the focus.
 * Above the focus, the left part of its first row, the right part of its last
 * row, and below it. A null focus (an empty region) dims the whole layer.
 *
 * @param {{ focus: { startTop: number, startX: number, endTop: number, endX: number } | null,
 *   contentBox: { left: number, right: number }, width: number, totalHeight: number, rh: number }} input
 *   `startTop`/`endTop` are the tops of the rows holding the focus start and
 *   end; `startX`/`endX` their x. A focus that covers whole rows passes
 *   `startX = contentBox.left` and `endX = contentBox.right`.
 * @returns {Array<{ x: number, y: number, w: number, h: number }>}
 */
export function scrimRects({ focus, contentBox, width, totalHeight, rh }) {
    const rects = [];
    const push = (x, y, w, h) => {
        if (w > 0.5 && h > 0.5) rects.push({ x, y, w, h });
    };
    if (!focus) {
        push(0, 0, width, totalHeight);
        return rects;
    }
    const { startTop, startX, endTop, endX } = focus;
    push(0, 0, width, startTop);
    if (startX > contentBox.left + 0.5) push(0, startTop, startX, rh);
    if (endX < contentBox.right - 0.5) push(endX, endTop, width - endX, rh);
    push(0, endTop + rh, width, totalHeight - endTop - rh);
    return rects;
}

/**
 * The current-row band, across the whole width of the text area.
 *
 * @param {{ rowTop: number, rh: number, width: number }} input
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function bandRect({ rowTop, rh, width }) {
    return { x: 0, y: rowTop, w: width, h: rh };
}

/**
 * A CSS colour at an alpha, from a computed `rgb()`/`rgba()` value. Anything
 * it cannot read becomes white, the light editor background.
 *
 * @param {string} color e.g. `rgb(44, 44, 44)`
 * @param {number} alpha 0–1
 * @returns {string} `rgb(r g b / alpha)`
 */
export function withAlpha(color, alpha) {
    const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(String(color || ''));
    const [r, g, b] = match ? match.slice(1, 4).map((part) => Math.round(Number(part))) : [255, 255, 255];
    const a = Math.min(1, Math.max(0, Number(alpha) || 0));
    return `rgb(${r} ${g} ${b} / ${a})`;
}
