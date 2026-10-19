// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFERRED_TOASTS_KEY } from '@/utils/deferredToasts';

const uiStoreMock = reactive({
    toasts: [{ id: 'toast-1', type: 'info', message: '<img src=x onerror=alert(1)>' }],
    addToast: vi.fn(),
    removeToast: vi.fn(),
});

vi.mock('@/store/uiStore', () => ({ useUiStore: () => uiStoreMock }));

const ToastContainer = (await import('@/components/ToastContainer.vue')).default;

describe('ToastContainer', () => {
    beforeEach(() => {
        uiStoreMock.addToast.mockClear();
        window.sessionStorage.clear();
    });

    it('renders toast messages as text rather than executable HTML', () => {
        const wrapper = mount(ToastContainer);

        expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('shows toasts queued before a reload, once', () => {
        window.sessionStorage.setItem(DEFERRED_TOASTS_KEY, JSON.stringify([
            { message: 'Import complete: 1 created.', type: 'success', duration: 5000 },
            { message: 'Skipped 1 item(s): img/missing.png (not found)', type: 'warning', duration: 8000 },
        ]));

        mount(ToastContainer);

        expect(uiStoreMock.addToast.mock.calls).toEqual([
            ['Import complete: 1 created.', 'success', 5000],
            ['Skipped 1 item(s): img/missing.png (not found)', 'warning', 8000],
        ]);
        expect(window.sessionStorage.getItem(DEFERRED_TOASTS_KEY)).toBeNull();

        mount(ToastContainer);
        expect(uiStoreMock.addToast).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no toasts were queued', () => {
        mount(ToastContainer);
        expect(uiStoreMock.addToast).not.toHaveBeenCalled();
    });

    it('runs a toast action once and closes the toast', async () => {
        const onSelect = vi.fn();
        uiStoreMock.toasts = [{ id: 'toast-2', type: 'success', message: 'Moved to Work', action: { label: 'Undo', onSelect } }];
        const wrapper = mount(ToastContainer);

        await wrapper.find('[data-testid="toast-action"]').trigger('click');

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(uiStoreMock.removeToast).toHaveBeenCalledWith('toast-2');
    });
});
