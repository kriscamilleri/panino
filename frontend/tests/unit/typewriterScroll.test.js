import { describe, expect, it } from 'vitest';
import {
    CLICK_SETTLE_MS,
    CLICK_SLOP_PX,
    LONG_TWEEN_MS,
    SHORT_TWEEN_MS,
    TAP_MAX_MS,
    TAP_SLOP_PX,
    classifyCaretChange,
    effectiveAnchor,
    isAttached,
    pointerRecentreDecision,
    scrollMotionFor,
    scrollTargetFor,
    tweenStep,
    tweenValue,
    typewriterPadding,
} from '@/utils/typewriterScroll';

const rh = 20;

describe('constants', () => {
    it('match §5.4.1', () => {
        expect({ CLICK_SETTLE_MS, TAP_SLOP_PX, CLICK_SLOP_PX, TAP_MAX_MS }).toEqual({
            CLICK_SETTLE_MS: 350, TAP_SLOP_PX: 10, CLICK_SLOP_PX: 4, TAP_MAX_MS: 500,
        });
    });
});

describe('effectiveAnchor (§5.2)', () => {
    it('puts the middle anchor at half the visible height, by row top', () => {
        expect(effectiveAnchor({ anchorPercent: 50, contextLines: 3, H: 600, rh })).toEqual({ anchorY: 290, nEff: 3, visibleRows: 30 });
    });

    it('keeps N rows above and below whatever the anchor says', () => {
        // 20 % of 200 px would put the row 30 px down; N = 3 needs 60.
        expect(effectiveAnchor({ anchorPercent: 20, contextLines: 3, H: 200, rh }).anchorY).toBe(60);
        // 80 % of 200 px: the row would end within 3 rows of the bottom.
        expect(effectiveAnchor({ anchorPercent: 80, contextLines: 3, H: 200, rh }).anchorY).toBe(200 - 4 * rh);
    });

    it('clamps N on a phone with the keyboard up (6 visible rows, N = 3 → 2)', () => {
        const result = effectiveAnchor({ anchorPercent: 50, contextLines: 3, H: 6 * rh, rh });
        expect(result.visibleRows).toBe(6);
        expect(result.nEff).toBe(2);
        expect(result.anchorY).toBeGreaterThanOrEqual(2 * rh);
        expect(result.anchorY).toBeLessThanOrEqual(6 * rh - 3 * rh);
    });

    it('survives a visible area smaller than one row', () => {
        const result = effectiveAnchor({ anchorPercent: 50, contextLines: 3, H: 10, rh });
        expect(result.nEff).toBe(0);
        expect(Number.isFinite(result.anchorY)).toBe(true);
    });
});

describe('typewriterPadding (§5.3)', () => {
    it('lets the first and last rows reach the anchor', () => {
        const { padTop, padBottom } = typewriterPadding({ anchorY: 290, viewportHeight: 600, rh, firstRowOffset: 16, trailingSpace: 16 });
        expect(padTop).toBe(274);
        expect(padBottom).toBe(600 - 290 - 20 - 16);
    });

    it('counts banners above the editor in the first row offset', () => {
        expect(typewriterPadding({ anchorY: 100, viewportHeight: 600, rh, firstRowOffset: 150, trailingSpace: 0 }).padTop).toBe(0);
    });

    it('measures the bottom against the whole scroll viewport, under the key row too', () => {
        const phone = typewriterPadding({ anchorY: 100, viewportHeight: 500, rh, firstRowOffset: 16, trailingSpace: 96 });
        expect(phone.padBottom).toBe(500 - 100 - 20 - 96);
    });

    it('turning the mode on and off shifts scrollTop by padTop (compensation)', () => {
        const before = { scrollTop: 400, padTop: 0 };
        const { padTop } = typewriterPadding({ anchorY: 290, viewportHeight: 600, rh, firstRowOffset: 16, trailingSpace: 16 });
        const on = before.scrollTop + (padTop - before.padTop);
        expect(on).toBe(674);
        const off = on + (0 - padTop);
        expect(off).toBe(400);
    });
});

describe('scrollTargetFor', () => {
    const base = { rh, H: 600, anchorY: 290, nEff: 3 };

    it('holds the row at the anchor in typewriter style', () => {
        expect(scrollTargetFor({ ...base, style: 'typewriter', rowTop: 1290, scrollTop: 0 })).toBe(1000);
    });

    it('returns null when already there (±1 px)', () => {
        expect(scrollTargetFor({ ...base, style: 'typewriter', rowTop: 1290, scrollTop: 1000.6 })).toBeNull();
    });

    it('in margin style, does nothing inside the margin and scrolls just enough outside it', () => {
        const margin = { ...base, style: 'margin', scrollTop: 1000 };
        expect(scrollTargetFor({ ...margin, rowTop: 1300 })).toBeNull(); // inside
        // above: the row would be 20 px from the top, the margin wants 60
        expect(scrollTargetFor({ ...margin, rowTop: 1020 })).toBe(960);
        // below: the row at 590 from the top; at most 600 − 4 rows = 520
        expect(scrollTargetFor({ ...margin, rowTop: 1590 })).toBe(1070);
    });

    it('never scrolls in style off', () => {
        expect(scrollTargetFor({ ...base, style: 'off', rowTop: 5000, scrollTop: 0 })).toBeNull();
    });

    it('clamps to the scroll range', () => {
        expect(scrollTargetFor({ ...base, style: 'typewriter', rowTop: 100, scrollTop: 50 })).toBe(0);
        expect(scrollTargetFor({ ...base, style: 'typewriter', rowTop: 5000, scrollTop: 0, maxScroll: 3000 })).toBe(3000);
    });
});

describe('isAttached', () => {
    it('is true within ±1 px of the last position the mode set', () => {
        expect(isAttached(100, 100)).toBe(true);
        expect(isAttached(100.9, 100)).toBe(true);
        expect(isAttached(98.9, 100)).toBe(false);
        expect(isAttached(100, null)).toBe(false);
    });
});

describe('classifyCaretChange', () => {
    it('ranks input, remote, keyboard, pointer, programmatic', () => {
        expect(classifyCaretChange({ input: true, remote: true, keyboard: true })).toBe('input');
        expect(classifyCaretChange({ remote: true, keyboard: true })).toBe('remote');
        expect(classifyCaretChange({ keyboard: true, pointer: true })).toBe('keyboard');
        expect(classifyCaretChange({ pointer: true })).toBe('pointer');
        expect(classifyCaretChange({})).toBe('programmatic');
        expect(classifyCaretChange()).toBe('programmatic');
    });
});

describe('scrollMotionFor (§5.5)', () => {
    it('tweens 100 ms for up to two rows and 180 ms for longer jumps', () => {
        expect(scrollMotionFor('input', { distance: 2 * rh, rh })).toEqual({ animate: true, duration: SHORT_TWEEN_MS });
        expect(scrollMotionFor('keyboard', { distance: -5 * rh, rh })).toEqual({ animate: true, duration: LONG_TWEEN_MS });
        expect(scrollMotionFor('recentre', { distance: rh, rh })).toEqual({ animate: true, duration: LONG_TWEEN_MS });
    });

    it('is instant for opening, resizes, remote edits, IME and reduced motion', () => {
        for (const origin of ['open', 'resize', 'remote', 'attach']) {
            expect(scrollMotionFor(origin, { distance: 500, rh }).animate).toBe(false);
        }
        expect(scrollMotionFor('input', { distance: 500, rh, composing: true }).animate).toBe(false);
        expect(scrollMotionFor('recentre', { distance: 500, rh, reducedMotion: true }).animate).toBe(false);
    });
});

describe('pointerRecentreDecision (§5.4.1)', () => {
    const state = { style: 'typewriter', rowOnScreen: 500, anchorY: 290, rh, H: 600, nEff: 3 };
    const click = {
        phase: 'up', pointerType: 'mouse', button: 0, downAt: 0, upAt: 80, moved: 0,
        cancelled: false, detail: 1, selectionCollapsed: true, composing: false, hadFocus: true,
    };
    const tap = { ...click, pointerType: 'touch', detail: 1 };

    it('schedules for a primary single click with a collapsed selection and little movement', () => {
        expect(pointerRecentreDecision(click, state)).toBe('schedule');
        expect(pointerRecentreDecision({ ...click, moved: CLICK_SLOP_PX }, state)).toBe('schedule');
        expect(pointerRecentreDecision({ ...click, pointerType: 'pen' }, state)).toBe('schedule');
    });

    it('does nothing for right or middle clicks', () => {
        expect(pointerRecentreDecision({ ...click, button: 2 }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...click, button: 1 }, state)).toBe('none');
    });

    it('does nothing for the second and third click of a double or triple click', () => {
        expect(pointerRecentreDecision({ ...click, detail: 2 }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...click, detail: 3 }, state)).toBe('none');
    });

    it('does nothing with a selection (drag, Shift+click, double-click)', () => {
        expect(pointerRecentreDecision({ ...click, selectionCollapsed: false }, state)).toBe('none');
    });

    it('does nothing after a drag of more than 4 px, while composing, or in style off', () => {
        expect(pointerRecentreDecision({ ...click, moved: 5 }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...click, composing: true }, state)).toBe('none');
        expect(pointerRecentreDecision(click, { ...state, style: 'off' })).toBe('none');
    });

    it('schedules for a tap, and waits for the viewport when the tap opens the keyboard', () => {
        expect(pointerRecentreDecision(tap, state)).toBe('schedule');
        expect(pointerRecentreDecision({ ...tap, hadFocus: false }, state)).toBe('afterViewportSettle');
    });

    it('does nothing for a swipe, a long-press, a cancelled touch or a touch selection', () => {
        expect(pointerRecentreDecision({ ...tap, moved: TAP_SLOP_PX + 1 }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...tap, upAt: TAP_MAX_MS + 1 }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...tap, cancelled: true }, state)).toBe('none');
        expect(pointerRecentreDecision({ ...tap, selectionCollapsed: false }, state)).toBe('none');
    });

    it('in margin style, moves only a row within N rows of an edge', () => {
        const margin = { ...state, style: 'margin' };
        expect(pointerRecentreDecision(click, { ...margin, rowOnScreen: 300 })).toBe('none');
        expect(pointerRecentreDecision(click, { ...margin, rowOnScreen: 20 })).toBe('schedule');
        expect(pointerRecentreDecision(click, { ...margin, rowOnScreen: 580 })).toBe('schedule');
    });

    it('does nothing for a row already at the anchor', () => {
        expect(pointerRecentreDecision(click, { ...state, rowOnScreen: 290.5 })).toBe('none');
    });

    it('cancels on a pointerdown or a key before the timer', () => {
        expect(pointerRecentreDecision({ phase: 'down', pending: true }, state)).toBe('cancel');
        expect(pointerRecentreDecision({ phase: 'key', pending: true }, state)).toBe('cancel');
        expect(pointerRecentreDecision({ phase: 'down', pending: false }, state)).toBe('none');
    });

    it('re-checks when the timer fires', () => {
        const timer = { phase: 'timer', selectionCollapsed: true, composing: false, pointerDown: false };
        expect(pointerRecentreDecision(timer, state)).toBe('recentre');
        expect(pointerRecentreDecision({ ...timer, selectionCollapsed: false }, state)).toBe('cancel');
        expect(pointerRecentreDecision({ ...timer, composing: true }, state)).toBe('cancel');
        expect(pointerRecentreDecision({ ...timer, pointerDown: true }, state)).toBe('cancel');
        expect(pointerRecentreDecision(timer, { ...state, rowOnScreen: 290 })).toBe('none');
    });
});

describe('tween', () => {
    it('eases out from 0 to 1', () => {
        expect(tweenStep(0)).toBe(0);
        expect(tweenStep(1)).toBe(1);
        expect(tweenStep(0.5)).toBeGreaterThan(0.5);
        expect(tweenStep(2)).toBe(1);
    });

    it('finishes exactly at the target', () => {
        const tween = { from: 0, to: 300, startedAt: 1000, duration: 180 };
        expect(tweenValue(tween, 1000)).toEqual({ value: 0, done: false });
        expect(tweenValue(tween, 1090).value).toBeGreaterThan(150);
        expect(tweenValue(tween, 1180)).toEqual({ value: 300, done: true });
        expect(tweenValue({ ...tween, duration: 0 }, 1000)).toEqual({ value: 300, done: true });
    });

    it('restarts from wherever the view is now', () => {
        const first = { from: 0, to: 300, startedAt: 0, duration: 180 };
        const midway = tweenValue(first, 60).value;
        const second = { from: midway, to: 600, startedAt: 60, duration: 180 };
        expect(tweenValue(second, 60).value).toBe(midway);
        expect(tweenValue(second, 240)).toEqual({ value: 600, done: true });
    });
});
