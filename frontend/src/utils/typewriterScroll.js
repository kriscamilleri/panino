/**
 * Typewriter scrolling decisions (docs/specs/active/typewriter-mode.md §5).
 * Pure: every function takes numbers and small records and returns numbers or
 * a decision. The controller in composables/useTypewriter.js measures the page
 * and applies what these return.
 *
 * Units are px. `rh` is the row height, `H` the visible editor height.
 */

/** Wait after a click before re-centring, so a double-click lands on unmoved text (§5.4.1). */
export const CLICK_SETTLE_MS = 350;
/** A touch that moves more than this is a scroll gesture, not a tap. */
export const TAP_SLOP_PX = 10;
/** A mouse or pen that moves more than this between down and up was a drag. */
export const CLICK_SLOP_PX = 4;
/** A touch held longer than this is a long-press, not a tap. */
export const TAP_MAX_MS = 500;
/** Tween lengths (§5.5). */
export const SHORT_TWEEN_MS = 100;
export const LONG_TWEEN_MS = 180;
/** Moves of up to this many rows use the short tween. */
export const SHORT_TWEEN_ROWS = 2;
/** A view within this many px of the last position the mode set is still attached. */
export const ATTACH_TOLERANCE_PX = 1;

/**
 * Where the caret row is held, as a row top measured from the top of the
 * visible area, with the context-line margin as a limit (§5.2).
 *
 * @param {{ anchorPercent: number, contextLines: number, H: number, rh: number }} input
 * @returns {{ anchorY: number, nEff: number, visibleRows: number }}
 */
export function effectiveAnchor({ anchorPercent, contextLines, H, rh }) {
    const rowHeight = rh > 0 ? rh : 1;
    const height = Math.max(0, H);
    const visibleRows = Math.floor(height / rowHeight);
    const nEff = Math.max(0, Math.min(Math.max(0, contextLines | 0), Math.floor((visibleRows - 1) / 2)));
    let anchorY = Math.round((anchorPercent / 100) * height - rowHeight / 2);
    const low = nEff * rowHeight;
    const high = height - (nEff + 1) * rowHeight;
    anchorY = high >= low ? Math.min(high, Math.max(low, anchorY)) : Math.max(0, Math.round((height - rowHeight) / 2));
    return { anchorY, nEff, visibleRows };
}

/**
 * Spacer padding that lets the first and the last row reach the anchor (§5.3).
 *
 * @param {{ anchorY: number, viewportHeight: number, rh: number, firstRowOffset: number, trailingSpace: number }} input
 *   `viewportHeight` is the scroll container's whole client height (on phones
 *   that includes the strip under the key row, which `H` leaves out);
 *   `firstRowOffset` is row 0's top in the scroll content without this
 *   padding; `trailingSpace` is the content below the last row (OverType's own
 *   bottom padding).
 * @returns {{ padTop: number, padBottom: number }}
 */
export function typewriterPadding({ anchorY, viewportHeight, rh, firstRowOffset, trailingSpace }) {
    return {
        padTop: Math.max(0, Math.round(anchorY - firstRowOffset)),
        padBottom: Math.max(0, Math.round(viewportHeight - anchorY - rh - trailingSpace)),
    };
}

/**
 * The scrollTop that puts the caret row where the style wants it, or null
 * when the view should stay where it is.
 *
 * @param {{ style: 'typewriter'|'margin'|'off', rowTop: number, rh: number, H: number, scrollTop: number, anchorY: number, nEff: number, maxScroll?: number }} input
 *   `rowTop` is the caret row's top in the scroll content.
 * @returns {number|null}
 */
export function scrollTargetFor({ style, rowTop, rh, H, scrollTop, anchorY, nEff, maxScroll = Infinity }) {
    let target = null;
    if (style === 'typewriter') {
        target = rowTop - anchorY;
    } else if (style === 'margin') {
        const onScreen = rowTop - scrollTop;
        const low = nEff * rh;
        const high = H - (nEff + 1) * rh;
        if (onScreen < low) target = rowTop - low;
        else if (onScreen > high) target = rowTop - Math.max(low, high);
    }
    if (target === null) return null;
    const clamped = Math.round(Math.min(Math.max(0, maxScroll), Math.max(0, target)));
    return Math.abs(clamped - scrollTop) <= ATTACH_TOLERANCE_PX ? null : clamped;
}

/**
 * Whether the view is still where the mode last put it (§5.4 "attached").
 *
 * @param {number} scrollTop
 * @param {number|null} lastSetScrollTop
 * @returns {boolean}
 */
export function isAttached(scrollTop, lastSetScrollTop) {
    return lastSetScrollTop !== null && lastSetScrollTop !== undefined
        && Math.abs(scrollTop - lastSetScrollTop) <= ATTACH_TOLERANCE_PX;
}

/**
 * What caused a caret or content change (§5.4). Local typing wins over
 * everything; a content change that is not local input is remote (a live
 * session, or text set from code); a caret move right after a key is keyboard
 * navigation; one during a pointer gesture is a click or tap; anything else
 * (find, undo, toolbar) is programmatic.
 *
 * @param {{ input?: boolean, remote?: boolean, keyboard?: boolean, pointer?: boolean }} signals
 * @returns {'input'|'remote'|'keyboard'|'pointer'|'programmatic'}
 */
export function classifyCaretChange({ input = false, remote = false, keyboard = false, pointer = false } = {}) {
    if (input) return 'input';
    if (remote) return 'remote';
    if (keyboard) return 'keyboard';
    if (pointer) return 'pointer';
    return 'programmatic';
}

/**
 * How a scroll of this origin moves: instant, or a tween of a given length.
 *
 * @param {string} origin classifyCaretChange's value, or 'recentre', 'open', 'resize', 'attach'
 * @param {{ distance: number, rh: number, reducedMotion?: boolean, composing?: boolean }} input
 * @returns {{ animate: boolean, duration: number }}
 */
export function scrollMotionFor(origin, { distance, rh, reducedMotion = false, composing = false }) {
    const instant = { animate: false, duration: 0 };
    if (reducedMotion || composing) return instant;
    if (['open', 'resize', 'remote', 'attach'].includes(origin)) return instant;
    if (origin === 'recentre') return { animate: true, duration: LONG_TWEEN_MS };
    const rows = rh > 0 ? Math.abs(distance) / rh : Infinity;
    return { animate: true, duration: rows <= SHORT_TWEEN_ROWS + 0.01 ? SHORT_TWEEN_MS : LONG_TWEEN_MS };
}

/**
 * The click and tap re-centre rules of §5.4.1, one decision per moment of a
 * gesture.
 *
 * `gesture.phase`:
 * - `'down'` or `'key'` while a re-centre waits: `'cancel'`.
 * - `'up'`: `'none'`, `'schedule'` (wait CLICK_SETTLE_MS), or
 *   `'afterViewportSettle'` (a tap that opens the on-screen keyboard).
 * - `'timer'`: the wait is over; `'recentre'`, `'none'` or `'cancel'`.
 *
 * @param {{ phase: 'down'|'key'|'up'|'timer', pointerType?: string, button?: number, downAt?: number, upAt?: number,
 *   moved?: number, cancelled?: boolean, detail?: number, selectionCollapsed?: boolean, composing?: boolean,
 *   hadFocus?: boolean, pointerDown?: boolean, pending?: boolean }} gesture
 * @param {{ style: 'typewriter'|'margin'|'off', rowOnScreen?: number, anchorY?: number, rh?: number, H?: number, nEff?: number }} state
 *   `rowOnScreen` is the caret row's top measured from the top of the visible area.
 * @returns {'none'|'schedule'|'afterViewportSettle'|'recentre'|'cancel'}
 */
export function pointerRecentreDecision(gesture, state) {
    const { phase } = gesture;
    if (phase === 'down' || phase === 'key') return gesture.pending ? 'cancel' : 'none';
    if (state.style === 'off') return phase === 'timer' ? 'cancel' : 'none';

    if (phase === 'timer') {
        if (!gesture.selectionCollapsed || gesture.composing || gesture.pointerDown) return 'cancel';
        return rowNeedsMove(state) ? 'recentre' : 'none';
    }
    if (phase !== 'up') return 'none';

    if (gesture.composing || !gesture.selectionCollapsed) return 'none';
    if (gesture.pointerType === 'touch') {
        if (gesture.cancelled) return 'none';
        if ((gesture.moved ?? 0) > TAP_SLOP_PX) return 'none';
        if ((gesture.upAt ?? 0) - (gesture.downAt ?? 0) > TAP_MAX_MS) return 'none';
        if (!gesture.hadFocus) return 'afterViewportSettle';
    } else {
        if ((gesture.button ?? 0) !== 0) return 'none';
        if (gesture.cancelled) return 'none';
        if ((gesture.moved ?? 0) > CLICK_SLOP_PX) return 'none';
        if ((gesture.detail ?? 1) >= 2) return 'none';
    }
    return rowNeedsMove(state) ? 'schedule' : 'none';
}

function rowNeedsMove({ style, rowOnScreen, anchorY, rh, H, nEff }) {
    if (typeof rowOnScreen !== 'number') return true;
    if (style === 'typewriter') return Math.abs(rowOnScreen - anchorY) > ATTACH_TOLERANCE_PX;
    if (style === 'margin') {
        const low = nEff * rh;
        const high = H - (nEff + 1) * rh;
        return rowOnScreen < low || rowOnScreen > high;
    }
    return false;
}

/**
 * Ease-out for the scroll tween: fast start, gentle stop.
 *
 * @param {number} t progress 0–1
 * @returns {number} eased progress 0–1
 */
export function tweenStep(t) {
    const x = Math.min(1, Math.max(0, t));
    return 1 - (1 - x) ** 3;
}

/**
 * The tweened value at a moment.
 *
 * @param {{ from: number, to: number, startedAt: number, duration: number }} tween
 * @param {number} now
 * @returns {{ value: number, done: boolean }}
 */
export function tweenValue({ from, to, startedAt, duration }, now) {
    if (!(duration > 0)) return { value: to, done: true };
    const progress = (now - startedAt) / duration;
    if (progress >= 1) return { value: to, done: true };
    return { value: from + (to - from) * tweenStep(progress), done: false };
}
