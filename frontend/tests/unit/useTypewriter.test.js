// @vitest-environment jsdom
// Typewriter mode's controller (docs/specs/active/typewriter-mode.md §5, §8,
// §13.2), driven with a fake layout: jsdom has no layout, so rows, scrolling
// and padding are modelled here, one row per logical line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { createTypewriterController, useTypewriter } from '@/composables/useTypewriter';
import { defaultTypewriterSettings } from '@/utils/typewriterSettings';
import { CLICK_SETTLE_MS, LONG_TWEEN_MS } from '@/utils/typewriterScroll';

const RH = 20;
const PAD = 10; // OverType's own padding above the first row
const H = 400;

function fakeLayout(textarea) {
    const layout = {
        scrollTop: 0,
        padTop: 0,
        padBottom: 0,
        visible: true,
        lines: () => textarea.value.split('\n').length,
        contentHeight: () => PAD + layout.lines() * RH + PAD,
        maxScroll: () => Math.max(0, layout.padTop + layout.contentHeight() + layout.padBottom - H),
        beginFrame: vi.fn(),
        invalidate: vi.fn(),
        invalidateMetrics: vi.fn(),
        isVisible: () => layout.visible,
        metrics: () => ({ rh: RH, padTop: PAD, contentLeft: 10, contentRight: 590, width: 600, height: layout.contentHeight() }),
        viewport: () => ({
            scrollTop: layout.scrollTop,
            clientHeight: H,
            scrollHeight: layout.padTop + layout.contentHeight() + layout.padBottom,
            bottomInset: 0,
            wrapperTop: layout.padTop,
        }),
        positionOf: (offset, index) => {
            const text = index.text;
            const before = text.slice(0, offset);
            const line = before.split('\n').length - 1;
            const column = offset - (before.lastIndexOf('\n') + 1);
            return { top: PAD + line * RH, x: 10 + column * 8 };
        },
        getScrollTop: () => layout.scrollTop,
        setScrollTop: (value) => {
            layout.scrollTop = Math.round(Math.max(0, Math.min(layout.maxScroll(), value)));
            return layout.scrollTop;
        },
        setPadding: vi.fn((top, bottom) => { layout.padTop = top; layout.padBottom = bottom; }),
        background: () => 'rgb(255, 255, 255)',
        destroy: vi.fn(),
        /** The caret row's top from the top of the visible area. */
        caretOnScreen: () => {
            const head = textarea.selectionEnd;
            const line = textarea.value.slice(0, head).split('\n').length - 1;
            return layout.padTop + PAD + line * RH - layout.scrollTop;
        },
    };
    return layout;
}

function pointer(type, { x = 100, y = 100, button = 0, pointerType = 'mouse', pointerId = 1, detail = 1 } = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, detail });
    return Object.assign(event, { pointerId, pointerType });
}

const LINES = Array.from({ length: 100 }, (_, i) => `Line ${i} of the Document.`).join('\n');
const offsetOfLine = (n) => LINES.split('\n').slice(0, n).join('\n').length + (n ? 1 : 0);

describe('createTypewriterController', () => {
    let textarea;
    let layout;
    let frames;
    let clock;
    let settings;
    let render;
    let settledCallbacks;
    let applyingRemote;
    let reduced;
    let current = null;

    const flushFrames = (times = 1) => {
        for (let i = 0; i < times; i += 1) {
            const queue = frames;
            frames = [];
            queue.forEach((fn) => fn(clock));
        }
    };
    /** Run animation frames 16 ms apart for `ms`. */
    const animate = (ms) => {
        const end = clock + ms;
        while (clock < end) {
            clock += 16;
            flushFrames();
        }
    };

    function create() {
        const controller = createTypewriterController({
            textarea,
            layout,
            settings: () => settings,
            render,
            isApplyingRemote: () => applyingRemote,
            documentKey: () => 'doc-1',
            onViewportSettled: (callback) => {
                settledCallbacks.push(callback);
                return () => { settledCallbacks = settledCallbacks.filter((entry) => entry !== callback); };
            },
            reducedMotion: () => reduced,
            raf: (fn) => { frames.push(fn); return frames.length; },
            caf: () => {},
            now: () => clock,
        });
        controller.attach();
        flushFrames();
        current = controller;
        return controller;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.value = LINES;
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        layout = fakeLayout(textarea);
        frames = [];
        clock = 1000;
        settings = { ...defaultTypewriterSettings('desktop'), enabled: true };
        render = vi.fn();
        settledCallbacks = [];
        applyingRemote = false;
        reduced = false;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const anchorY = Math.round(0.5 * H - RH / 2); // 190

    it('adds spacer padding on attach without moving the text', () => {
        layout.scrollTop = 0;
        create();
        // padTop lets row 0 reach the anchor; scrollTop moved by the same amount.
        expect(layout.padTop).toBe(anchorY - PAD);
        expect(layout.scrollTop).toBe(anchorY - PAD);
        expect(layout.caretOnScreen()).toBe(PAD); // row 0 is where it was
        expect(layout.padBottom).toBe(H - anchorY - RH - PAD);
    });

    it('follows typing to the anchor, and keeps the first row there at the top', () => {
        create();
        textarea.setSelectionRange(offsetOfLine(40), offsetOfLine(40));
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        expect(layout.caretOnScreen()).toBe(anchorY);

        textarea.setSelectionRange(0, 0);
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        expect(layout.scrollTop).toBe(0);
        expect(layout.caretOnScreen()).toBe(anchorY);
    });

    it('lets the last row reach the anchor too', () => {
        create();
        textarea.setSelectionRange(LINES.length, LINES.length);
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        expect(layout.caretOnScreen()).toBe(anchorY);
        expect(layout.scrollTop).toBe(layout.maxScroll());
    });

    it('re-centres a single click only after the settle delay, then tweens for 180 ms', () => {
        create();
        const target = offsetOfLine(30);
        textarea.dispatchEvent(pointer('pointerdown'));
        textarea.dispatchEvent(pointer('mousedown'));
        textarea.setSelectionRange(target, target);
        window.dispatchEvent(pointer('pointerup'));
        document.dispatchEvent(new Event('selectionchange'));
        flushFrames();
        const before = layout.scrollTop;
        vi.advanceTimersByTime(CLICK_SETTLE_MS - 1);
        flushFrames();
        expect(layout.scrollTop).toBe(before); // band and dim moved, the view did not
        expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ band: expect.objectContaining({ y: PAD + 30 * RH }) }));

        vi.advanceTimersByTime(1);
        flushFrames(); // the re-centre frame starts the tween
        clock += 90;
        flushFrames();
        const midway = layout.scrollTop;
        expect(midway).not.toBe(before);
        expect(layout.caretOnScreen()).not.toBe(anchorY);
        clock += 90;
        flushFrames();
        expect(layout.caretOnScreen()).toBe(anchorY);
    });

    it('cancels the click re-centre on a second pointerdown, and never scrolls while a pointer is down', () => {
        create();
        const target = offsetOfLine(30);
        textarea.dispatchEvent(pointer('pointerdown'));
        textarea.setSelectionRange(target, target);
        window.dispatchEvent(pointer('pointerup'));
        vi.advanceTimersByTime(100);
        const before = layout.scrollTop;
        textarea.dispatchEvent(pointer('pointerdown')); // second click of a double-click
        vi.advanceTimersByTime(CLICK_SETTLE_MS * 2);
        animate(400);
        expect(layout.scrollTop).toBe(before);
        window.dispatchEvent(pointer('pointerup', { detail: 2 }));
    });

    it('does not re-centre the second click of a double-click or a drag', () => {
        create();
        const before = layout.scrollTop;
        textarea.dispatchEvent(pointer('pointerdown'));
        textarea.dispatchEvent(pointer('mousedown', { detail: 2 }));
        textarea.setSelectionRange(offsetOfLine(30), offsetOfLine(30) + 4);
        window.dispatchEvent(pointer('pointerup'));
        vi.advanceTimersByTime(1000);
        animate(300);
        expect(layout.scrollTop).toBe(before);

        textarea.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
        window.dispatchEvent(pointer('pointermove', { x: 40, y: 80 }));
        textarea.setSelectionRange(offsetOfLine(31), offsetOfLine(31));
        window.dispatchEvent(pointer('pointerup', { x: 40, y: 80 }));
        vi.advanceTimersByTime(1000);
        animate(300);
        expect(layout.scrollTop).toBe(before);
    });

    it('cancels the click re-centre on a key press', () => {
        create();
        textarea.dispatchEvent(pointer('pointerdown'));
        textarea.setSelectionRange(offsetOfLine(30), offsetOfLine(30));
        window.dispatchEvent(pointer('pointerup'));
        vi.advanceTimersByTime(10);
        const before = layout.scrollTop;
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
        vi.advanceTimersByTime(CLICK_SETTLE_MS * 2);
        flushFrames();
        expect(layout.scrollTop).toBe(before);
    });

    it('re-centres a focusing tap after the viewport settles, not on the click timer', () => {
        create();
        textarea.blur();
        const before = layout.scrollTop;
        textarea.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
        textarea.focus();
        textarea.setSelectionRange(offsetOfLine(30), offsetOfLine(30));
        window.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
        vi.advanceTimersByTime(CLICK_SETTLE_MS + 50);
        animate(300);
        expect(layout.scrollTop).toBe(before);
        expect(settledCallbacks).toHaveLength(1);

        settledCallbacks[0]();
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        expect(layout.caretOnScreen()).toBe(anchorY);
        expect(settledCallbacks).toHaveLength(0);
    });

    it('does not re-centre a touch that turned into a scroll (pointercancel)', () => {
        create();
        const before = layout.scrollTop;
        textarea.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
        textarea.setSelectionRange(offsetOfLine(30), offsetOfLine(30));
        window.dispatchEvent(pointer('pointercancel', { pointerType: 'touch' }));
        vi.advanceTimersByTime(2000);
        animate(300);
        expect(layout.scrollTop).toBe(before);
    });

    it('holds back dimming during IME composition, and catches up at the end', () => {
        settings.dim = 'paragraph';
        textarea.value = 'First paragraph.\n\nSecond paragraph.';
        textarea.setSelectionRange(3, 3);
        create();
        const scrimsBefore = render.mock.lastCall[0].scrims;
        textarea.dispatchEvent(new Event('compositionstart'));
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        expect(render.mock.lastCall[0].scrims).toEqual(scrimsBefore);
        textarea.dispatchEvent(new Event('compositionend'));
        flushFrames();
        expect(render.mock.lastCall[0].scrims).not.toEqual(scrimsBefore);
    });

    it('re-anchors instantly on a remote edit while attached, and leaves a scrolled-away view alone', () => {
        create();
        textarea.setSelectionRange(offsetOfLine(40), offsetOfLine(40));
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        expect(layout.caretOnScreen()).toBe(anchorY);

        // A collaborator adds two lines above: the binding sets the value and moves the caret.
        applyingRemote = true;
        textarea.value = `new one\nnew two\n${textarea.value}`;
        const caret = offsetOfLine(40) + 16;
        textarea.setSelectionRange(caret, caret);
        frames.length = 0;
        // OverType's onChange
        current.notifyPreview();
        applyingRemote = false;
        flushFrames();
        expect(layout.caretOnScreen()).toBe(anchorY); // same frame, no tween

        // Scrolled away to read: remote edits do not pull the view back.
        layout.scrollTop -= 200;
        applyingRemote = true;
        textarea.value = `another\n${textarea.value}`;
        textarea.setSelectionRange(caret + 8, caret + 8);
        current.notifyPreview();
        applyingRemote = false;
        flushFrames();
        expect(layout.caretOnScreen()).toBe(anchorY + 200 + RH);
    });

    it('scrolls instantly under reduced motion', () => {
        reduced = true;
        create();
        textarea.setSelectionRange(offsetOfLine(50), offsetOfLine(50));
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        expect(layout.caretOnScreen()).toBe(anchorY);
    });

    it('stops a tween when the user scrolls, and does not fight the scroll', () => {
        create();
        textarea.setSelectionRange(offsetOfLine(60), offsetOfLine(60));
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        clock += 16;
        flushFrames();
        layout.scrollTop -= 300; // wheel
        animate(400);
        const after = layout.scrollTop;
        animate(400);
        expect(layout.scrollTop).toBe(after);
        expect(layout.caretOnScreen()).not.toBe(anchorY);
    });

    it('scrolls before the browser reveals the caret when typing in a scrolled-away view (P4)', () => {
        create();
        layout.scrollTop = layout.maxScroll(); // far from the caret
        textarea.value = `x${textarea.value}`; // a character typed at the start
        textarea.setSelectionRange(1, 1);
        textarea.dispatchEvent(new Event('input'));
        // OverType's document listener runs after the textarea's, then onChange:
        current.notifyPreview();
        expect(layout.caretOnScreen()).toBe(anchorY); // synchronously, no frame needed
    });

    it('keeps lines visible in margin style without padding', () => {
        settings.scrolling = 'margin';
        settings.contextLines = 3;
        create();
        expect(layout.padTop).toBe(0);
        for (let line = 1; line < 40; line += 1) {
            textarea.setSelectionRange(offsetOfLine(line), offsetOfLine(line));
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
            document.dispatchEvent(new Event('selectionchange'));
            flushFrames();
            animate(120);
            expect(layout.caretOnScreen()).toBeLessThanOrEqual(H - 4 * RH);
        }
    });

    it('hides the band while text is selected', () => {
        create();
        textarea.setSelectionRange(5, 12);
        document.dispatchEvent(new Event('selectionchange'));
        flushFrames();
        expect(render.mock.lastCall[0].band).toBeNull();
        textarea.setSelectionRange(12, 12);
        document.dispatchEvent(new Event('selectionchange'));
        flushFrames();
        expect(render.mock.lastCall[0].band).not.toBeNull();
    });

    it('pauses while the editor is hidden (phone Preview)', () => {
        create();
        layout.visible = false;
        render.mockClear();
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        expect(render).not.toHaveBeenCalled();
    });

    it('removes the padding on detach without moving the text', () => {
        create();
        textarea.setSelectionRange(offsetOfLine(40), offsetOfLine(40));
        textarea.dispatchEvent(new Event('input'));
        flushFrames();
        animate(LONG_TWEEN_MS + 32);
        const onScreen = layout.caretOnScreen();
        current.detach();
        expect(layout.padTop).toBe(0);
        expect(layout.padBottom).toBe(0);
        expect(layout.caretOnScreen()).toBe(onScreen);
        expect(layout.destroy).toHaveBeenCalled();
    });

    it('detaches every listener and timer', () => {
        const textareaAdd = vi.spyOn(textarea, 'addEventListener');
        const textareaRemove = vi.spyOn(textarea, 'removeEventListener');
        const documentAdd = vi.spyOn(document, 'addEventListener');
        const documentRemove = vi.spyOn(document, 'removeEventListener');
        create();
        textarea.dispatchEvent(pointer('pointerdown'));
        window.dispatchEvent(pointer('pointerup'));
        vi.advanceTimersByTime(1);
        current.detach();
        expect(textareaRemove).toHaveBeenCalledTimes(textareaAdd.mock.calls.length);
        expect(documentRemove.mock.calls.map((call) => call[0])).toEqual(documentAdd.mock.calls.map((call) => call[0]));
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('useTypewriter', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    function setup(enabled) {
        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'overtype-wrapper';
        const textareaEl = document.createElement('textarea');
        const preview = document.createElement('div');
        preview.className = 'overtype-preview';
        wrapperEl.append(textareaEl, preview);
        const content = document.createElement('div');
        const scroller = document.createElement('div');
        content.appendChild(wrapperEl);
        scroller.appendChild(content);
        document.body.appendChild(scroller);
        const settings = ref({ ...defaultTypewriterSettings('desktop'), enabled });
        const wrapper = shallowRef(null);
        const scope = effectScope();
        const api = scope.run(() => useTypewriter({
            settings,
            textarea: () => textareaEl,
            wrapper,
            contentElement: ref(content),
            scrollContainer: () => scroller,
        }));
        return { api, scope, settings, wrapper, wrapperEl, textareaEl };
    }

    it('attaches nothing while the mode is off', async () => {
        const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
        const { api, scope, wrapper, wrapperEl } = setup(false);
        wrapper.value = wrapperEl;
        await nextTick();
        expect(add).not.toHaveBeenCalled();
        expect(api.active.value).toBe(false);
        expect(api.layerMounted.value).toBe(false);
        api.onPreviewChange(); // the always-on cost: a call that does nothing
        scope.stop();
        add.mockRestore();
    });

    it('attaches when turned on and detaches when turned off, when the wrapper goes and on unmount', async () => {
        const { scope, settings, wrapper, wrapperEl, textareaEl } = setup(false);
        const add = vi.spyOn(textareaEl, 'addEventListener');
        const remove = vi.spyOn(textareaEl, 'removeEventListener');
        wrapper.value = wrapperEl;
        settings.value = { ...settings.value, enabled: true };
        expect(add).toHaveBeenCalled();
        const attached = add.mock.calls.length;

        settings.value = { ...settings.value, enabled: false };
        expect(remove).toHaveBeenCalledTimes(attached);

        settings.value = { ...settings.value, enabled: true };
        expect(add).toHaveBeenCalledTimes(attached * 2);
        wrapper.value = null; // the editor is rebuilt (theme change)
        expect(remove).toHaveBeenCalledTimes(attached * 2);

        wrapper.value = wrapperEl;
        expect(add).toHaveBeenCalledTimes(attached * 3);
        scope.stop();
        expect(remove).toHaveBeenCalledTimes(attached * 3);
    });

    it('keeps the layer mounted long enough to fade out', async () => {
        vi.useFakeTimers();
        try {
            const { api, scope, settings } = setup(true);
            expect(api.layerMounted.value).toBe(true);
            settings.value = { ...settings.value, enabled: false };
            await nextTick();
            expect(api.layerMounted.value).toBe(true);
            vi.advanceTimersByTime(250);
            expect(api.layerMounted.value).toBe(false);
            scope.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
