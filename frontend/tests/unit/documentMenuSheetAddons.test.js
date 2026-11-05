// @vitest-environment jsdom
// The phone Document menu hosts add-on actions and modals
// (docs/specs/active/addon-folders.md §6.2.1). Closing the sheet, the back
// gesture included, closes the add-on modal so reopening the sheet does not
// bring it back.
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

const ui = reactive({
    addonModal: null,
    closeAddonModal: vi.fn(() => { ui.addonModal = null; }),
});
const fetchAddons = vi.fn(async () => {});

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/addonsStore', () => ({ useAddonsStore: () => ({ fetchAddons, isActive: () => true }) }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ selectedFile: ref({ id: 'd1', title: 'Doc', content: 'one two', dbKey: 'user:me' }) }) }));
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ isOnline: true }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ theme: 'system', setTheme: vi.fn() }) }));
vi.mock('@/composables/useSheetRoute', () => ({ useSheetRoute: () => ({ openSheet: vi.fn(), closeSheetAndGo: vi.fn() }) }));
vi.mock('@/composables/usePhoneStatus', () => ({ usePhoneStatus: () => ({ sync: ref({}), liveParticipants: () => [], syncNow: vi.fn() }) }));

const { default: DocumentMenuSheet } = await import('@/components/phone/DocumentMenuSheet.vue');

const stubs = {
    BottomSheet: { props: ['open'], template: '<div v-if="open"><slot name="header" /><slot /><slot name="footer" /></div>' },
    SegmentedControl: true,
    DocumentStylesModal: true,
    BaseModal: true,
    AddonActions: { props: ['surface'], template: '<div data-testid="addon-actions" :data-surface="surface" />' },
    AddonModalHost: { template: '<div data-testid="addon-modal-host" />' },
};

describe('DocumentMenuSheet and add-ons', () => {
    it('hosts the menu actions and the add-on modals while open', () => {
        const wrapper = mount(DocumentMenuSheet, { props: { open: true }, global: { stubs } });
        expect(wrapper.get('[data-testid="addon-actions"]').attributes('data-surface')).toBe('menu');
        expect(wrapper.find('[data-testid="addon-modal-host"]').exists()).toBe(true);
        expect(fetchAddons).toHaveBeenCalled();
    });

    it('closes the add-on modal when the sheet closes', async () => {
        const wrapper = mount(DocumentMenuSheet, { props: { open: true }, global: { stubs } });
        ui.addonModal = { addonId: 'odoo', modalId: 'send' };
        ui.closeAddonModal.mockClear();

        await wrapper.setProps({ open: false });
        expect(ui.closeAddonModal).toHaveBeenCalledTimes(1);
        expect(ui.addonModal).toBeNull();

        await wrapper.setProps({ open: true });
        expect(ui.addonModal).toBeNull();
    });
});
