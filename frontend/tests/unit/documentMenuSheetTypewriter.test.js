// @vitest-environment jsdom
// The phone Document menu's Typewriter mode switch and Settings → Writing
// (docs/specs/active/typewriter-mode.md §9.5, §9.6).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive, ref } from 'vue';

const ui = reactive({ addonModal: null, closeAddonModal: vi.fn() });
const editorStore = { focus: vi.fn() };
const typewriter = reactive({
    enabled: false,
    profiles: {
        desktop: { enabled: false, scrolling: 'typewriter', anchorPercent: 50, contextLines: 3, highlightLine: true, dim: 'paragraph', dimStrength: 'medium' },
        phone: { enabled: false, scrolling: 'typewriter', anchorPercent: 50, contextLines: 2, highlightLine: true, dim: 'paragraph', dimStrength: 'medium' },
    },
    toggle: vi.fn(() => { typewriter.enabled = !typewriter.enabled; return typewriter.enabled; }),
    update: vi.fn((patch, target) => {
        typewriter.profiles[target] = { ...typewriter.profiles[target], ...patch };
    }),
});

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/addonsStore', () => ({ useAddonsStore: () => ({ fetchAddons: vi.fn(async () => {}), isActive: () => true }) }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ selectedFile: ref({ id: 'd1', title: 'Doc', content: 'one two', dbKey: 'user:me' }) }) }));
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ isOnline: true }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ preference: 'system', setPreference: vi.fn() }) }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => editorStore }));
vi.mock('@/store/typewriterStore', () => ({ useTypewriterStore: () => typewriter }));
vi.mock('@/composables/useSheetRoute', () => ({ useSheetRoute: () => ({ openSheet: vi.fn(), closeSheetAndGo: vi.fn() }) }));
vi.mock('@/composables/usePhoneStatus', () => ({ usePhoneStatus: () => ({ sync: ref({}), liveParticipants: () => [], syncNow: vi.fn() }) }));

const { default: DocumentMenuSheet } = await import('@/components/phone/DocumentMenuSheet.vue');
const { default: PhoneTypewriterSettings } = await import('@/components/phone/PhoneTypewriterSettings.vue');

const stubs = {
    BottomSheet: { props: ['open'], template: '<div v-if="open"><slot name="header" /><slot /><slot name="footer" /></div>' },
    SegmentedControl: true,
    DocumentStylesModal: true,
    BaseModal: true,
    AddonActions: true,
    AddonModalHost: true,
};

describe('Document menu: Typewriter mode switch', () => {
    beforeEach(() => {
        typewriter.enabled = false;
        typewriter.toggle.mockClear();
        editorStore.focus.mockClear();
    });

    it('shows the state of the mode', async () => {
        const wrapper = mount(DocumentMenuSheet, { props: { open: true }, global: { stubs } });
        const toggle = wrapper.get('[data-testid="phone-menu-typewriter"]');
        expect(toggle.attributes('role')).toBe('switch');
        expect(toggle.attributes('aria-checked')).toBe('false');
        typewriter.enabled = true;
        await nextTick();
        expect(toggle.attributes('aria-checked')).toBe('true');
    });

    it('toggles, closes the sheet, and gives focus back to the editor once it has closed', async () => {
        const wrapper = mount(DocumentMenuSheet, { props: { open: true }, global: { stubs } });
        await wrapper.get('[data-testid="phone-menu-typewriter"]').trigger('click');
        expect(typewriter.toggle).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(editorStore.focus).not.toHaveBeenCalled();

        await wrapper.setProps({ open: false });
        await nextTick();
        expect(editorStore.focus).toHaveBeenCalledTimes(1);

        // Closing for any other reason does not move focus.
        await wrapper.setProps({ open: true });
        await wrapper.setProps({ open: false });
        await nextTick();
        expect(editorStore.focus).toHaveBeenCalledTimes(1);
    });
});

describe('Settings → Writing (PhoneTypewriterSettings)', () => {
    const SegmentedControl = {
        props: ['modelValue', 'options', 'label', 'testidPrefix'],
        emits: ['update:modelValue'],
        template: `<div :data-testid="testidPrefix" :data-value="modelValue">
            <button v-for="o in options" :key="o.value" :data-testid="testidPrefix + '-' + o.value" @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
        </div>`,
    };

    beforeEach(() => {
        typewriter.update.mockClear();
        typewriter.profiles.phone = { ...typewriter.profiles.phone, enabled: false, scrolling: 'typewriter', dim: 'paragraph', contextLines: 2, anchorPercent: 50 };
    });

    it('round-trips every control through the phone profile only', async () => {
        const wrapper = mount(PhoneTypewriterSettings, { global: { stubs: { SegmentedControl } } });
        await wrapper.get('[data-testid="phone-settings-typewriter-enabled"]').trigger('click');
        expect(typewriter.update).toHaveBeenLastCalledWith({ enabled: true }, 'phone');
        await wrapper.get('[data-testid="phone-settings-typewriter-anchor-33"]').trigger('click');
        expect(typewriter.update).toHaveBeenLastCalledWith({ anchorPercent: 33 }, 'phone');
        await wrapper.get('[data-testid="phone-settings-typewriter-lines-plus"]').trigger('click');
        expect(typewriter.update).toHaveBeenLastCalledWith({ contextLines: 3 }, 'phone');
        await wrapper.get('[data-testid="phone-settings-typewriter-strength-subtle"]').trigger('click');
        expect(typewriter.update).toHaveBeenLastCalledWith({ dimStrength: 'subtle' }, 'phone');
        await wrapper.get('[data-testid="phone-settings-typewriter-highlight"]').trigger('click');
        expect(typewriter.update).toHaveBeenLastCalledWith({ highlightLine: false }, 'phone');
        for (const [, target] of typewriter.update.mock.calls) expect(target).toBe('phone');
        expect(typewriter.profiles.desktop.anchorPercent).toBe(50);
    });

    it('hides the dependent controls (§9.6)', async () => {
        const wrapper = mount(PhoneTypewriterSettings, { global: { stubs: { SegmentedControl } } });
        expect(wrapper.find('[data-testid="phone-settings-typewriter-anchor"]').exists()).toBe(true);
        await wrapper.get('[data-testid="phone-settings-typewriter-scrolling-margin"]').trigger('click');
        expect(wrapper.find('[data-testid="phone-settings-typewriter-anchor"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="phone-settings-typewriter-lines"]').exists()).toBe(true);
        await wrapper.get('[data-testid="phone-settings-typewriter-scrolling-off"]').trigger('click');
        expect(wrapper.find('[data-testid="phone-settings-typewriter-lines"]').exists()).toBe(false);
        await wrapper.get('[data-testid="phone-settings-typewriter-dim-off"]').trigger('click');
        expect(wrapper.find('[data-testid="phone-settings-typewriter-strength"]').exists()).toBe(false);
    });

    it('limits the lines to 0–10', async () => {
        typewriter.profiles.phone = { ...typewriter.profiles.phone, contextLines: 10 };
        const wrapper = mount(PhoneTypewriterSettings, { global: { stubs: { SegmentedControl } } });
        expect(wrapper.get('[data-testid="phone-settings-typewriter-lines-plus"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('[data-testid="phone-settings-typewriter-lines-value"]').text()).toBe('10');
    });
});
