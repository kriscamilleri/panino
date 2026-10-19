// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

function fakeViewport(initial) {
    const target = new EventTarget();
    const state = { ...initial };
    Object.defineProperty(target, 'height', { get: () => state.height });
    Object.defineProperty(target, 'offsetTop', { get: () => state.offsetTop });
    target.set = (next) => {
        Object.assign(state, next);
        target.dispatchEvent(new Event('resize'));
    };
    return target;
}

describe('useViewport', () => {
    let viewport;

    beforeEach(() => {
        vi.resetModules();
        viewport = fakeViewport({ height: 735, offsetTop: 0 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        window.matchMedia = () => ({ matches: true, addEventListener: () => {} });
    });

    it('pins phone screens to the visible part of the screen', async () => {
        const { useViewport } = await import('@/composables/useViewport');
        const { visibleStyle, isPhone } = useViewport();
        expect(isPhone.value).toBe(true);
        expect(visibleStyle.value).toEqual({ top: '0px', height: '735px' });

        viewport.set({ height: 455 });
        expect(visibleStyle.value).toEqual({ top: '0px', height: '455px' });

        viewport.set({ offsetTop: 120 });
        expect(visibleStyle.value).toEqual({ top: '120px', height: '455px' });
    });

    it('ignores innerHeight, which iOS updates at a different moment', async () => {
        const { useViewport } = await import('@/composables/useViewport');
        const { visibleStyle } = useViewport();
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 985 });
        viewport.set({ height: 455 });
        // The old inset arithmetic made this 205px tall and hid the editor.
        expect(visibleStyle.value.height).toBe('455px');
    });

    it('falls back to the dynamic viewport height without visualViewport', async () => {
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
        const { useViewport } = await import('@/composables/useViewport');
        expect(useViewport().visibleStyle.value).toEqual({ top: '0px', height: '100dvh' });
    });
});
