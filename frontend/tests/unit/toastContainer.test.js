// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { DEFERRED_TOASTS_KEY } from '@/utils/deferredToasts';

const addToast = vi.fn();

vi.mock('@/store/uiStore', () => ({
    useUiStore: () => ({ toasts: [], addToast, removeToast: vi.fn() }),
}));

import ToastContainer from '@/components/ToastContainer.vue';

describe('ToastContainer deferred toasts', () => {
    beforeEach(() => {
        addToast.mockClear();
        window.sessionStorage.clear();
    });

    it('shows toasts queued before a reload, once', () => {
        window.sessionStorage.setItem(DEFERRED_TOASTS_KEY, JSON.stringify([
            { message: 'Import complete: 1 created.', type: 'success', duration: 5000 },
            { message: 'Skipped 1 item(s): img/missing.png (not found)', type: 'warning', duration: 8000 },
        ]));

        mount(ToastContainer);

        expect(addToast.mock.calls).toEqual([
            ['Import complete: 1 created.', 'success', 5000],
            ['Skipped 1 item(s): img/missing.png (not found)', 'warning', 8000],
        ]);
        expect(window.sessionStorage.getItem(DEFERRED_TOASTS_KEY)).toBeNull();

        mount(ToastContainer);
        expect(addToast).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no toasts were queued', () => {
        mount(ToastContainer);
        expect(addToast).not.toHaveBeenCalled();
    });
});
