import { computed, onScopeDispose, ref, shallowRef, unref, watch } from 'vue';
import { analyzeText, focusRange, lineIndexAt } from '@/utils/textFocus';
import { bandRect, scrimRects, withAlpha } from '@/utils/focusGeometry';
import { DIM_ALPHA } from '@/utils/typewriterSettings';
import {
    CLICK_SETTLE_MS,
    effectiveAnchor,
    isAttached,
    pointerRecentreDecision,
    scrollMotionFor,
    scrollTargetFor,
    tweenValue,
    typewriterPadding,
} from '@/utils/typewriterScroll';
import { caretPosition } from '@/utils/caretPosition';
import { onViewportSettled } from '@/composables/useViewport';

/**
 * Typewriter mode's controller (docs/specs/active/typewriter-mode.md §4.3, §5–§8).
 *
 * While the mode is on it listens to the editor textarea, measures the caret
 * row once per animation frame (all reads, then all writes), keeps spacer
 * padding on the editor container so both ends of the Document can reach the
 * anchor, scrolls the editor's scroll container, and hands the band and scrim
 * rectangles to TypewriterLayer. While the mode is off nothing is attached.
 */

/** How long a key press marks the selection changes after it as keyboard navigation. */
const KEY_WINDOW_MS = 500;
/** After a remote change, the caret restore that follows it is remote too. */
const REMOTE_GRACE_MS = 150;
/** A selection change this soon after pointerup still belongs to the click. */
const POINTER_GRACE_MS = 100;
/** Wait for useViewport's settle (its last timer is at 700 ms) at most this long. */
const VIEWPORT_SETTLE_FALLBACK_MS = 900;
/** The layer stays mounted this long after the mode is turned off, to fade out. */
export const LAYER_FADE_MS = 150;

const COPIED_STYLES = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontVariantLigatures',
    'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'wordSpacing', 'tabSize',
];

/** Origins in the order a frame picks between them when several arrive together. */
const ORIGIN_PRIORITY = [
    'open', 'input', 'remote', 'keyboard', 'recentre', 'programmatic', 'content',
    'composition', 'pointer', 'settings', 'resize', 'attach', 'refresh',
];
/** Origins that move the view to the caret. */
const FOLLOW = new Set(['open', 'input', 'keyboard', 'recentre', 'programmatic']);
/** Origins that only keep an attached view on the caret (instant). */
const COMPENSATE = new Set(['remote', 'content', 'resize', 'settings']);

const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;

function lineEndOf(index, line) {
    return line + 1 < index.starts.length ? index.starts[line + 1] - 1 : index.text.length;
}

/**
 * Measure the editor in the browser. Positions are px in OverType's wrapper
 * (the overlay's coordinates); the viewport is the scroll container.
 *
 * Row tops come from the highlight layer's element for the line (P1: one per
 * logical line) and a Range on its text (P2, P6: exact, and cheap even for a
 * 50,000-character line). If the layer does not match the text, a one-line
 * mirror stands in, and if the element count does not match the line count,
 * the whole-prefix mirror of caretPosition.js does.
 *
 * @param {{ textarea: HTMLTextAreaElement, wrapper: HTMLElement, preview?: HTMLElement,
 *   scrollContainer: HTMLElement, contentElement: HTMLElement, bottomInset?: () => number }} elements
 */
export function createDomLayout({ textarea, wrapper, preview, scrollContainer, contentElement, bottomInset }) {
    const layer = preview || wrapper.querySelector('.overtype-preview');
    let lineElements = null;
    let metricsCache = null;
    let frame = null;
    let mirror = null;
    let warned = false;

    function metrics() {
        if (!metricsCache) {
            const style = window.getComputedStyle(textarea);
            const fontSize = Number.parseFloat(style.fontSize) || 16;
            metricsCache = {
                style,
                rh: Number.parseFloat(style.lineHeight) || fontSize * 1.4,
                padTop: Number.parseFloat(style.paddingTop) || 0,
                padLeft: Number.parseFloat(style.paddingLeft) || 0,
                padRight: Number.parseFloat(style.paddingRight) || 0,
            };
        }
        return metricsCache;
    }

    function elements() {
        if (!lineElements) {
            lineElements = [];
            for (const child of layer?.children || []) {
                if (child.tagName === 'UL' || child.tagName === 'OL') {
                    for (const item of child.children) lineElements.push(item);
                } else {
                    lineElements.push(child);
                }
            }
        }
        return lineElements;
    }

    function wrapperRect() {
        if (!frame) frame = { wrapper: wrapper.getBoundingClientRect() };
        return frame.wrapper;
    }

    /** The client rect of the characters [from, to) of a line element's text. */
    function charRect(element, from, to) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let start = null;
        let remaining = from;
        let node;
        while ((node = walker.nextNode())) {
            if (start === null && remaining < node.length) {
                start = { node, offset: remaining };
                remaining = to - from + remaining;
            }
            if (start !== null) {
                if (remaining <= node.length) {
                    const range = document.createRange();
                    range.setStart(start.node, start.offset);
                    range.setEnd(node, remaining);
                    const rects = range.getClientRects();
                    return rects.length ? rects[0] : range.getBoundingClientRect();
                }
            }
            remaining -= node.length;
        }
        return null;
    }

    function mirrorPosition(lineText, column, upstream) {
        const m = metrics();
        if (!mirror) {
            mirror = document.createElement('div');
            mirror.setAttribute('aria-hidden', 'true');
            mirror.className = 'pn-typewriter-mirror';
            // Outside OverType's container: its CSS reset forces padding to 0
            // on everything inside, which would change where the text wraps.
            document.body.appendChild(mirror);
        }
        for (const property of COPIED_STYLES) mirror.style[property] = m.style[property];
        Object.assign(mirror.style, {
            position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '-9999px',
            whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid',
            paddingTop: '0px', paddingBottom: '0px', height: 'auto',
        });
        let from = upstream ? column - 1 : column;
        let to = from + 1;
        if (from < 0 || from >= lineText.length) {
            from = Math.min(Math.max(column, 0), lineText.length);
            to = from;
        } else if (isLowSurrogate(lineText.charCodeAt(from)) && from > 0) {
            from -= 1;
        } else if (isHighSurrogate(lineText.charCodeAt(from)) && to < lineText.length) {
            to += 1;
        }
        mirror.textContent = lineText.slice(0, from);
        const marker = document.createElement('span');
        // The character itself, so a soft-wrap point lands on the row it starts (P2).
        marker.textContent = to > from ? lineText.slice(from, to) : '​';
        mirror.appendChild(marker);
        mirror.appendChild(document.createTextNode(lineText.slice(to)));
        const row = Math.floor((marker.offsetTop + marker.offsetHeight / 2) / m.rh);
        const x = marker.offsetLeft + (upstream && to > from ? marker.offsetWidth : 0);
        return { row, x };
    }

    return {
        /** Forget per-frame measurements. */
        beginFrame() {
            frame = null;
        },
        /** The highlight layer was rebuilt: its elements are new. */
        invalidate() {
            lineElements = null;
        },
        /** Fonts or sizes may have changed. */
        invalidateMetrics() {
            metricsCache = null;
            lineElements = null;
        },
        isVisible() {
            return wrapper.isConnected && wrapper.getClientRects().length > 0;
        },
        metrics() {
            const m = metrics();
            return {
                rh: m.rh,
                padTop: m.padTop,
                contentLeft: m.padLeft,
                contentRight: wrapper.clientWidth - m.padRight,
                width: wrapper.clientWidth,
                height: wrapper.offsetHeight,
            };
        },
        viewport() {
            const container = scrollContainer.getBoundingClientRect();
            const scrollTop = scrollContainer.scrollTop;
            return {
                scrollTop,
                clientHeight: scrollContainer.clientHeight,
                scrollHeight: scrollContainer.scrollHeight,
                bottomInset: Math.max(0, Number(bottomInset?.()) || 0),
                wrapperTop: wrapperRect().top - container.top - scrollContainer.clientTop + scrollTop,
            };
        },
        /**
         * Where an offset sits: its row's top and its x, in wrapper px.
         * `upstream` measures the end of the character before the offset (for
         * the end of a focus region); otherwise the start of the character at
         * it, as the caret is drawn.
         */
        positionOf(offset, index, upstream = false) {
            const m = metrics();
            const text = index.text;
            if (!text.length) return { top: m.padTop, x: m.padLeft };
            const at = Math.max(0, Math.min(offset, text.length));
            const line = lineIndexAt(index.starts, at);
            const list = elements();
            if (list.length !== index.starts.length) {
                if (!warned && import.meta.env?.DEV) {
                    warned = true;
                    console.warn('[typewriter] The highlight layer has', list.length, 'lines, the text', index.starts.length);
                }
                const caret = caretPosition(textarea, at);
                const row = Math.floor((caret.top - m.padTop + 0.5) / m.rh);
                return { top: m.padTop + row * m.rh, x: caret.left };
            }
            const element = list[line];
            const origin = wrapperRect();
            const box = element.getBoundingClientRect();
            const elementTop = box.top - origin.top;
            const lineStart = index.starts[line];
            const lineLength = lineEndOf(index, line) - lineStart;
            const column = at - lineStart;
            if (!lineLength) return { top: elementTop, x: m.padLeft };

            const useEnd = (upstream && column > 0) || column >= lineLength;
            let from = useEnd ? column - 1 : column;
            let to = from + 1;
            if (isLowSurrogate(text.charCodeAt(lineStart + from)) && from > 0) from -= 1;
            else if (isHighSurrogate(text.charCodeAt(lineStart + from)) && to < lineLength) to += 1;

            if (element.textContent.length === lineLength) {
                const rect = charRect(element, from, to);
                if (rect && rect.height > 0) {
                    const row = Math.floor((rect.top + rect.height / 2 - box.top) / m.rh);
                    return { top: elementTop + Math.max(0, row) * m.rh, x: (useEnd ? rect.right : rect.left) - origin.left };
                }
            }
            const lineText = text.slice(lineStart, lineStart + lineLength);
            const measured = mirrorPosition(lineText, column, useEnd);
            return { top: elementTop + measured.row * m.rh, x: measured.x };
        },
        getScrollTop() {
            return scrollContainer.scrollTop;
        },
        /** Set scrollTop and return what the browser kept. */
        setScrollTop(value) {
            scrollContainer.scrollTop = value;
            return scrollContainer.scrollTop;
        },
        setPadding(top, bottom) {
            if (top > 0) contentElement.style.setProperty('padding-top', `${top}px`, 'important');
            else contentElement.style.removeProperty('padding-top');
            if (bottom > 0) contentElement.style.setProperty('padding-bottom', `${bottom}px`, 'important');
            else contentElement.style.removeProperty('padding-bottom');
            if (!contentElement.getAttribute('style')) contentElement.removeAttribute('style');
        },
        /** The editor's background colour, for the scrim. */
        background() {
            let node = wrapper;
            while (node && node !== document.documentElement) {
                const color = window.getComputedStyle(node).backgroundColor;
                if (color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color)) return color;
                node = node.parentElement;
            }
            return 'rgb(255, 255, 255)';
        },
        destroy() {
            mirror?.remove();
            mirror = null;
            lineElements = null;
            metricsCache = null;
        },
    };
}

/**
 * The controller without Vue. Everything it touches comes in through the
 * options, so tests can drive it with a fake layout, fake timers and a fake
 * animation frame.
 *
 * @param {{
 *   textarea: HTMLTextAreaElement,
 *   layout: ReturnType<typeof createDomLayout>,
 *   settings: () => object,
 *   render: (geometry: object|null) => void,
 *   isApplyingRemote?: () => boolean,
 *   documentKey?: () => unknown,
 *   onViewportSettled?: (callback: () => void) => () => void,
 *   reducedMotion?: () => boolean,
 *   observeResize?: (callback: () => void) => () => void,
 *   doc?: Document, win?: Window,
 *   raf?: (fn: Function) => number, caf?: (id: number) => void,
 *   now?: () => number,
 *   setTimer?: (fn: Function, ms: number) => unknown, clearTimer?: (id: unknown) => void,
 * }} options
 */
export function createTypewriterController(options) {
    const {
        textarea,
        layout,
        settings,
        render,
        isApplyingRemote = () => false,
        documentKey = () => null,
        reducedMotion = () => false,
        observeResize = null,
        doc = document,
        win = window,
    } = options;
    const waitForViewport = options.onViewportSettled ?? null;
    const raf = options.raf ?? ((fn) => win.requestAnimationFrame(fn));
    const caf = options.caf ?? ((id) => win.cancelAnimationFrame(id));
    const now = options.now ?? (() => performance.now());
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

    const state = {
        attached: false,
        frameId: null,
        origins: new Set(),
        syncInput: false,
        lastSet: null,
        tween: null,
        tweenId: null,
        padTop: 0,
        padBottom: 0,
        text: null,
        index: null,
        documentKey: undefined,
        composing: false,
        lastHeadTop: null,
        lastScrims: [],
        color: null,
        lastKeyAt: -Infinity,
        remoteUntil: -Infinity,
        contentUntil: -Infinity,
        pointerUpAt: -Infinity,
        gesture: null,
        recentreTimer: null,
        settleTimer: null,
        settleStop: null,
        stopResize: null,
    };

    const listeners = [];
    function listen(target, type, handler, opts) {
        target.addEventListener(type, handler, opts);
        listeners.push(() => target.removeEventListener(type, handler, opts));
    }

    function request(origin) {
        state.origins.add(origin);
        if (state.frameId === null) state.frameId = raf(runFrame);
    }

    function runFrame() {
        state.frameId = null;
        frame();
    }

    function pickOrigin(origins) {
        for (const origin of ORIGIN_PRIORITY) if (origins.has(origin)) return origin;
        return 'refresh';
    }

    function cancelTween() {
        if (state.tweenId !== null) caf(state.tweenId);
        state.tweenId = null;
        state.tween = null;
    }

    function stepTween() {
        state.tweenId = null;
        const tween = state.tween;
        if (!tween) return;
        // The user scrolled while the view was moving: stop, never fight it.
        if (Math.abs(layout.getScrollTop() - tween.lastWritten) > 1) {
            state.tween = null;
            return;
        }
        const { value, done } = tweenValue(tween, now());
        const kept = layout.setScrollTop(value);
        tween.lastWritten = kept;
        state.lastSet = kept;
        if (done) state.tween = null;
        else state.tweenId = raf(stepTween);
    }

    function scrollTo(target, motion, from) {
        if (!motion.animate) {
            cancelTween();
            state.lastSet = layout.setScrollTop(target);
            return;
        }
        if (state.tweenId !== null) caf(state.tweenId);
        state.tween = { from, to: target, startedAt: now(), duration: motion.duration, lastWritten: from };
        state.tweenId = raf(stepTween);
    }

    /** One measure → compute → apply pass. */
    function frame({ forceInstant = false } = {}) {
        const origins = state.origins;
        state.origins = new Set();
        if (!state.attached) return;
        layout.beginFrame();
        if (!layout.isVisible()) return; // phone Preview: pause until shown again

        const s = settings();
        let origin = pickOrigin(origins);
        const text = textarea.value;
        if (text !== state.text) {
            state.text = text;
            state.index = analyzeText(text);
        }
        const index = state.index;
        const key = documentKey();
        if (key !== state.documentKey) {
            if (state.documentKey !== undefined) origin = 'open';
            state.documentKey = key;
        }

        // ── reads ──
        const m = layout.metrics();
        const vp = layout.viewport();
        const rh = m.rh;
        const H = Math.max(rh, vp.clientHeight - vp.bottomInset);
        let selectionStart = textarea.selectionStart ?? 0;
        let selectionEnd = textarea.selectionEnd ?? selectionStart;
        // Setting the value of an unfocused textarea leaves its caret at the
        // end, which is not a place anyone chose. Until the editor has focus
        // the caret is taken to be at the start, as when a Document opens.
        if (doc.activeElement !== textarea && selectionStart === selectionEnd && selectionEnd === text.length) {
            selectionStart = 0;
            selectionEnd = 0;
        }
        const collapsed = selectionStart === selectionEnd;
        const head = textarea.selectionDirection === 'backward' ? selectionStart : selectionEnd;
        const headPos = layout.positionOf(head, index, false);
        const rowChanged = state.lastHeadTop === null || Math.abs(headPos.top - state.lastHeadTop) > 0.5;

        let focus = null;
        const recomputeDim = s.dim !== 'off' && !state.composing;
        if (recomputeDim) {
            const region = focusRange(index.text, { start: selectionStart, end: selectionEnd }, s.dim, { index });
            if (!region || region.empty) {
                focus = null;
            } else {
                const a = layout.positionOf(region.start, index, false);
                const b = layout.positionOf(region.end, index, true);
                focus = s.dim === 'paragraph'
                    ? { startTop: a.top, startX: m.contentLeft, endTop: b.top, endX: m.contentRight }
                    : { startTop: a.top, startX: a.x, endTop: b.top, endX: b.x };
            }
        }

        const { anchorY, nEff } = effectiveAnchor({ anchorPercent: s.anchorPercent, contextLines: s.contextLines, H, rh });
        let padTop = 0;
        let padBottom = 0;
        if (s.scrolling === 'typewriter') {
            const lastRow = layout.positionOf(index.text.length, index, true).top;
            const firstRowOffset = vp.wrapperTop - state.padTop + m.padTop;
            const trailingSpace = Math.max(0, m.height - lastRow - rh);
            ({ padTop, padBottom } = typewriterPadding({
                anchorY, viewportHeight: vp.clientHeight, rh, firstRowOffset, trailingSpace,
            }));
        }
        const attachedBefore = state.lastSet === null || isAttached(vp.scrollTop, state.lastSet);
        if (!state.color) state.color = layout.background();

        // ── writes ──
        let scrollTop = vp.scrollTop;
        const oldPadTop = state.padTop;
        const oldPadBottom = state.padBottom;
        const padDelta = padTop - oldPadTop;
        if (padTop !== state.padTop || padBottom !== state.padBottom) {
            layout.setPadding(padTop, padBottom);
            state.padTop = padTop;
            state.padBottom = padBottom;
        }
        if (padDelta !== 0) {
            // The text must not move on screen when the padding changes.
            scrollTop = layout.setScrollTop(scrollTop + padDelta);
            if (state.tween) {
                state.tween.from += padDelta;
                state.tween.to += padDelta;
                state.tween.lastWritten = scrollTop;
            }
            if (attachedBefore) state.lastSet = scrollTop;
        }
        if (origin === 'attach' || state.lastSet === null) state.lastSet = scrollTop;

        const rowTop = vp.wrapperTop + padDelta + headPos.top;
        const maxScroll = Math.max(0, vp.scrollHeight - oldPadTop - oldPadBottom + padTop + padBottom - vp.clientHeight);
        let follow = false;
        let motionOrigin = origin;
        if (FOLLOW.has(origin)) follow = true;
        else if (COMPENSATE.has(origin)) follow = attachedBefore;
        else if (origin === 'composition') {
            follow = rowChanged && attachedBefore;
        }
        if (state.composing && (origin === 'input' || origin === 'composition')) {
            follow = rowChanged;
            motionOrigin = 'composition';
        }
        if (follow && s.scrolling !== 'off') {
            const target = scrollTargetFor({
                style: s.scrolling, rowTop, rh, H, scrollTop, anchorY, nEff, maxScroll,
            });
            if (target !== null) {
                const motion = forceInstant
                    ? { animate: false, duration: 0 }
                    : scrollMotionFor(motionOrigin, {
                        distance: target - scrollTop,
                        rh,
                        reducedMotion: reducedMotion(),
                        composing: state.composing,
                    });
                scrollTo(target, motion, scrollTop);
            } else if (!state.tween) {
                state.lastSet = scrollTop;
            }
        }
        state.lastHeadTop = headPos.top;

        if (recomputeDim) {
            state.lastScrims = scrimRects({
                focus,
                contentBox: { left: m.contentLeft, right: m.contentRight },
                width: m.width,
                totalHeight: m.height,
                rh,
            });
        } else if (s.dim === 'off') {
            state.lastScrims = [];
        }
        // An empty Document has nothing to dim, and the placeholder stays as it is.
        if (!index.text.length) state.lastScrims = [];
        render({
            band: s.highlightLine && collapsed ? bandRect({ rowTop: headPos.top, rh, width: m.width }) : null,
            scrims: state.lastScrims,
            scrimColor: withAlpha(state.color, DIM_ALPHA[s.dimStrength] ?? DIM_ALPHA.medium),
        });
    }

    /* ───── recentre after a click or tap (§5.4.1) ───── */
    function clearRecentre() {
        if (state.recentreTimer !== null) clearTimer(state.recentreTimer);
        state.recentreTimer = null;
        if (state.settleTimer !== null) clearTimer(state.settleTimer);
        state.settleTimer = null;
        state.settleStop?.();
        state.settleStop = null;
    }

    function recentrePending() {
        return state.recentreTimer !== null || state.settleTimer !== null || state.settleStop !== null;
    }

    function rowState() {
        const s = settings();
        layout.beginFrame();
        const text = textarea.value;
        if (text !== state.text) {
            state.text = text;
            state.index = analyzeText(text);
        }
        const m = layout.metrics();
        const vp = layout.viewport();
        const H = Math.max(m.rh, vp.clientHeight - vp.bottomInset);
        const { anchorY, nEff } = effectiveAnchor({ anchorPercent: s.anchorPercent, contextLines: s.contextLines, H, rh: m.rh });
        const head = textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd;
        const top = layout.positionOf(head, state.index, false).top;
        return { style: s.scrolling, rowOnScreen: vp.wrapperTop + top - vp.scrollTop, anchorY, rh: m.rh, H, nEff };
    }

    function selectionCollapsed() {
        return textarea.selectionStart === textarea.selectionEnd;
    }

    function onRecentreTimer() {
        state.recentreTimer = null;
        if (!state.attached) return;
        const decision = pointerRecentreDecision({
            phase: 'timer',
            selectionCollapsed: selectionCollapsed(),
            composing: state.composing,
            pointerDown: Boolean(state.gesture),
        }, rowState());
        if (decision === 'recentre') request('recentre');
    }

    function onViewportReady() {
        clearRecentre();
        if (!state.attached || state.gesture || state.composing || !selectionCollapsed()) return;
        if (settings().scrolling === 'off') return;
        request('recentre');
    }

    function onPointerDown(event) {
        if (recentrePending()) {
            pointerRecentreDecision({ phase: 'down', pending: true }, { style: settings().scrolling });
            clearRecentre();
        }
        state.gesture = {
            pointerId: event.pointerId,
            pointerType: event.pointerType || 'mouse',
            button: event.button ?? 0,
            downAt: now(),
            x: event.clientX ?? 0,
            y: event.clientY ?? 0,
            moved: 0,
            cancelled: false,
            detail: 1,
            hadFocus: doc.activeElement === textarea,
        };
        win.addEventListener('pointermove', onPointerMove, true);
        win.addEventListener('pointerup', onPointerUp, true);
        win.addEventListener('pointercancel', onPointerCancel, true);
    }

    function onMouseDown(event) {
        // PointerEvent.detail is 0 in Chrome; the mouse event carries the click count.
        if (state.gesture) state.gesture.detail = event.detail || 1;
    }

    function onPointerMove(event) {
        const gesture = state.gesture;
        if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
        const dx = (event.clientX ?? 0) - gesture.x;
        const dy = (event.clientY ?? 0) - gesture.y;
        gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
    }

    function endGesture() {
        win.removeEventListener('pointermove', onPointerMove, true);
        win.removeEventListener('pointerup', onPointerUp, true);
        win.removeEventListener('pointercancel', onPointerCancel, true);
        const gesture = state.gesture;
        state.gesture = null;
        state.pointerUpAt = now();
        return gesture;
    }

    function onPointerCancel() {
        endGesture();
    }

    function onPointerUp(event) {
        const gesture = state.gesture;
        if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
        onPointerMove(event);
        endGesture();
        gesture.upAt = now();
        // Let the browser finish placing the caret (touch does it after pointerup).
        setTimer(() => evaluatePointerUp(gesture), 0);
    }

    function evaluatePointerUp(gesture) {
        if (!state.attached || state.gesture) return;
        const decision = pointerRecentreDecision({
            phase: 'up',
            ...gesture,
            selectionCollapsed: selectionCollapsed(),
            composing: state.composing,
        }, { style: settings().scrolling });
        if (decision === 'schedule') {
            state.recentreTimer = setTimer(onRecentreTimer, CLICK_SETTLE_MS);
        } else if (decision === 'afterViewportSettle') {
            // The keyboard is opening and the system scrolls on its own; wait
            // for the visible area to settle, then go to the new anchor.
            if (waitForViewport) state.settleStop = waitForViewport(onViewportReady);
            state.settleTimer = setTimer(onViewportReady, VIEWPORT_SETTLE_FALLBACK_MS);
        }
    }

    /* ───── other events ───── */
    function onKeydown() {
        state.lastKeyAt = now();
        if (recentrePending()) clearRecentre();
    }

    function onInput() {
        state.contentUntil = -Infinity;
        state.origins.add(state.composing ? 'composition' : 'input');
        // P4: when the view was scrolled away, scroll before the browser
        // reveals the caret on its own, so there is one move, not two.
        const scrollTop = layout.getScrollTop();
        state.syncInput = !state.composing && state.lastSet !== null && !isAttached(scrollTop, state.lastSet);
        request(state.composing ? 'composition' : 'input');
    }

    function onSelectionChange() {
        if (doc.activeElement !== textarea) return;
        const t = now();
        let origin = 'programmatic';
        if (state.gesture || t - state.pointerUpAt < POINTER_GRACE_MS) origin = 'pointer';
        else if (t - state.lastKeyAt < KEY_WINDOW_MS) origin = 'keyboard';
        else if (t < state.remoteUntil) origin = 'remote';
        else if (t < state.contentUntil) origin = 'content';
        if (state.composing && origin !== 'pointer') origin = 'composition';
        request(origin);
    }

    function onCompositionStart() {
        state.composing = true;
        clearRecentre();
    }

    function onCompositionEnd() {
        state.composing = false;
        request('input');
    }

    /**
     * OverType rebuilt its highlight layer (Editor's onChange). Called
     * synchronously, so a remote apply in a live session can still be told
     * apart from local typing.
     */
    function notifyPreview() {
        layout.invalidate();
        if (!state.attached) return;
        if (textarea.value === state.text) {
            // A selection-driven rebuild: same text, new elements.
            return;
        }
        const t = now();
        if (state.origins.has('input') || state.origins.has('composition')) {
            if (state.syncInput) {
                state.syncInput = false;
                if (state.frameId !== null) caf(state.frameId);
                state.frameId = null;
                frame({ forceInstant: true });
            }
            return;
        }
        if (isApplyingRemote()) {
            state.remoteUntil = t + REMOTE_GRACE_MS;
            request('remote');
        } else {
            state.contentUntil = t + REMOTE_GRACE_MS;
            request('content');
        }
    }

    function attach() {
        if (state.attached) return;
        state.attached = true;
        state.documentKey = documentKey();
        state.text = textarea.value;
        state.index = analyzeText(state.text);
        listen(textarea, 'input', onInput);
        listen(textarea, 'keydown', onKeydown);
        listen(textarea, 'pointerdown', onPointerDown);
        listen(textarea, 'mousedown', onMouseDown);
        listen(textarea, 'compositionstart', onCompositionStart);
        listen(textarea, 'compositionend', onCompositionEnd);
        listen(doc, 'selectionchange', onSelectionChange);
        state.stopResize = observeResize?.(() => {
            layout.invalidateMetrics?.();
            request('resize');
        }) ?? null;
        request('attach');
    }

    /** Remove everything: listeners, timers, padding (the text does not move). */
    function detach() {
        if (!state.attached) return;
        state.attached = false;
        while (listeners.length) listeners.pop()();
        endGesture();
        clearRecentre();
        cancelTween();
        if (state.frameId !== null) caf(state.frameId);
        state.frameId = null;
        state.stopResize?.();
        state.stopResize = null;
        if (state.padTop || state.padBottom) {
            const scrollTop = layout.getScrollTop();
            const padTop = state.padTop;
            layout.setPadding(0, 0);
            if (padTop) layout.setScrollTop(scrollTop - padTop);
        }
        state.padTop = 0;
        state.padBottom = 0;
        layout.destroy?.();
    }

    return {
        attach,
        detach,
        notifyPreview,
        /** Measure again without moving the view (after a layout change). */
        refresh: () => request('refresh'),
        /** The options changed: measure again and keep an attached view on the caret. */
        settingsChanged: () => request('settings'),
        /** For tests: the state record. */
        get state() {
            return state;
        },
    };
}

/** A ResizeObserver over the elements whose size changes the layout, ignoring height-only wrapper growth. */
function resizeObserverFor(elements) {
    if (typeof ResizeObserver === 'undefined') return null;
    return (callback) => {
        const sizes = new Map();
        const observer = new ResizeObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
                const target = entry.target;
                const { width, height } = entry.contentRect;
                // The wrapper grows with every new line; only its width rewraps text.
                const size = target === elements.wrapper ? `${Math.round(width)}` : `${Math.round(width)}x${Math.round(height)}`;
                if (sizes.has(target) && sizes.get(target) !== size) changed = true;
                sizes.set(target, size);
            }
            if (changed) callback();
        });
        for (const element of Object.values(elements)) if (element) observer.observe(element);
        return () => observer.disconnect();
    };
}

function findScrollContainer(element) {
    let node = element?.parentElement;
    while (node && node !== document.body) {
        const overflow = window.getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return node;
        node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

const resolve = (source) => (typeof source === 'function' ? source() : unref(source));

/**
 * Typewriter mode for one Editor. Attaches the controller while the mode is
 * on and the editor exists, and detaches it when either goes away (a theme
 * change rebuilds the editor: the wrapper is replaced and the controller with
 * it).
 *
 * @param {{
 *   settings: import('vue').Ref<object>,
 *   textarea: () => HTMLTextAreaElement|null,
 *   wrapper: import('vue').Ref<HTMLElement|null>,
 *   contentElement: import('vue').Ref<HTMLElement|null>,
 *   scrollContainer?: (() => HTMLElement|null) | import('vue').Ref<HTMLElement|null> | null,
 *   bottomInset?: (() => number) | import('vue').Ref<number> | null,
 *   isApplyingRemote?: () => boolean,
 *   documentKey?: () => unknown,
 * }} options
 * @returns {{ active: import('vue').ComputedRef<boolean>, layerMounted: import('vue').Ref<boolean>,
 *   layerHost: import('vue').ShallowRef<HTMLElement|null>,
 *   layerRef: (component: object|null) => void, onPreviewChange: () => void }}
 *   `layerHost` is the element in OverType's wrapper to teleport TypewriterLayer
 *   into; it exists only while the layer is mounted, so nothing is left in the
 *   wrapper once the mode is off (Teleport leaves its anchor nodes behind).
 */
export function useTypewriter(options) {
    const { settings, textarea, wrapper, contentElement } = options;
    const active = computed(() => Boolean(settings.value?.enabled));
    const layer = shallowRef(null);
    const layerMounted = ref(false);
    const layerHost = shallowRef(null);
    let controller = null;
    let fadeTimer = null;
    let reducedMotionQuery = null;

    const reducedMotion = () => {
        if (!reducedMotionQuery && typeof window !== 'undefined' && window.matchMedia) {
            reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        }
        return Boolean(reducedMotionQuery?.matches);
    };

    function stop() {
        controller?.detach();
        controller = null;
    }

    function start() {
        stop();
        const wrapperEl = wrapper.value;
        const textareaEl = textarea();
        const contentEl = contentElement.value;
        if (!wrapperEl || !textareaEl || !contentEl) return;
        const scrollEl = resolve(options.scrollContainer) || findScrollContainer(wrapperEl);
        const layout = createDomLayout({
            textarea: textareaEl,
            wrapper: wrapperEl,
            scrollContainer: scrollEl,
            contentElement: contentEl,
            bottomInset: () => resolve(options.bottomInset) || 0,
        });
        controller = createTypewriterController({
            textarea: textareaEl,
            layout,
            settings: () => settings.value,
            render: (geometry) => layer.value?.render?.(geometry),
            isApplyingRemote: options.isApplyingRemote,
            documentKey: options.documentKey,
            reducedMotion,
            onViewportSettled,
            observeResize: resizeObserverFor({
                container: scrollEl,
                wrapper: wrapperEl,
                region: contentEl.parentElement,
            }),
        });
        controller.attach();
    }

    // Sync: the editor clears its wrapper ref right before OverType's destroy,
    // and the padding has to come off while the old layout is still there.
    watch(
        () => [active.value, wrapper.value],
        ([on, wrapperEl]) => {
            if (on && wrapperEl) start();
            else stop();
        },
        { flush: 'sync' },
    );

    watch(active, (on) => {
        clearTimeout(fadeTimer);
        if (on) layerMounted.value = true;
        else fadeTimer = setTimeout(() => { layerMounted.value = false; }, LAYER_FADE_MS + 50);
    }, { immediate: true });

    // A plain static div: the layer inside it is positioned against the
    // wrapper, and paints after the highlight layer.
    watch(
        () => [layerMounted.value, wrapper.value],
        ([mounted, wrapperEl]) => {
            const host = layerHost.value;
            if (mounted && wrapperEl) {
                if (host?.parentNode === wrapperEl) return;
                host?.remove();
                const next = document.createElement('div');
                next.className = 'pn-typewriter-host';
                wrapperEl.appendChild(next);
                layerHost.value = next;
            } else if (host) {
                host.remove();
                layerHost.value = null;
            }
        },
        { flush: 'sync', immediate: true },
    );

    // An option changed while on: apply it at once, and show a new line
    // position by moving an attached view there. Turning the mode on is not
    // such a change: then the text stays where it is (§5.3).
    watch(() => {
        const { enabled: _enabled, ...rest } = settings.value || {};
        return JSON.stringify(rest);
    }, () => controller?.settingsChanged());

    onScopeDispose(() => {
        clearTimeout(fadeTimer);
        stop();
        layerHost.value?.remove();
        layerHost.value = null;
    });

    return {
        active,
        layerMounted,
        layerHost,
        /** Template ref callback for TypewriterLayer. */
        layerRef: (component) => {
            layer.value = component;
            if (component) controller?.refresh();
        },
        /** Call from OverType's onChange, synchronously. */
        onPreviewChange: () => controller?.notifyPreview(),
    };
}
