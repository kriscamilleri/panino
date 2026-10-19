/**
 * Where a character offset sits inside a textarea, in px from the textarea's
 * top-left corner. A hidden mirror element copies the textarea's text metrics
 * and wraps the same text; the marker after the offset lands where the caret
 * would be drawn.
 */

const COPIED = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontVariantLigatures',
    'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'wordSpacing', 'tabSize',
];

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {number} offset character offset, clamped to the text
 * @returns {{ top: number, left: number, height: number }}
 */
export function caretPosition(textarea, offset) {
    const style = window.getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const property of COPIED) mirror.style[property] = style[property];
    Object.assign(mirror.style, {
        position: 'absolute',
        visibility: 'hidden',
        top: '0',
        left: '-9999px',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        borderStyle: 'solid',
    });
    const at = Math.max(0, Math.min(Number(offset) || 0, textarea.value.length));
    mirror.textContent = textarea.value.slice(0, at);
    const marker = document.createElement('span');
    // Zero-width space: an empty span has no box at the end of a line.
    marker.textContent = '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20;
    const position = {
        top: marker.offsetTop - textarea.scrollTop,
        left: marker.offsetLeft - textarea.scrollLeft,
        height: lineHeight,
    };
    mirror.remove();
    return position;
}
