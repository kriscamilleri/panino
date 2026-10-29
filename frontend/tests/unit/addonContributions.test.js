// @vitest-environment jsdom
// The add-on contribution points (docs/specs/active/addon-folders.md §6.2),
// exercised with a throwaway manifest so the tests depend on no real add-on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, reactive } from 'vue';

const ui = reactive({
    addonModal: null,
    openAddonModal: vi.fn((addonId, modalId) => { ui.addonModal = { addonId, modalId }; }),
    closeAddonModal: vi.fn(() => { ui.addonModal = null; }),
});
const docStore = reactive({ selectedFileId: 'doc-1' });
const syncStore = reactive({ isOnline: true });

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => docStore }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => syncStore }));

const Icon = { render: () => h('svg') };
/** A modal that records each time it is mounted, to prove it stays mounted. */
const modalMounts = vi.fn();
const Modal = {
    props: ['show'],
    emits: ['close'],
    mounted: () => modalMounts(),
    render() { return this.show ? h('div', { 'data-testid': 'probe-modal' }, [h('button', { onClick: () => this.$emit('close') }, 'Close')]) : null; },
};
const SpaceCard = { props: ['dbKey', 'spaceMode'], render() { return h('section', `card for ${this.dbKey} ${this.spaceMode}`); } };
const SettingsCard = { props: ['layout'], render() { return h('div', `settings ${this.layout}`); } };

vi.mock('@/addons/registry', () => {
    const manifest = {
        id: 'probe',
        actions: [
            { id: 'go', icon: Icon, label: 'Probe', menuLabel: 'Go to probe', hint: 'Go', requires: ['online', 'document'], modal: 'main' },
            { id: 'free', icon: Icon, label: 'Free', hint: 'No needs', modal: 'main' },
            { id: 'desk', icon: Icon, label: 'Desk', hint: 'Toolbar only', surfaces: ['toolbar'], modal: 'main' },
        ],
        modals: { main: () => Promise.resolve({ __esModule: true, default: Modal }) },
        settingsCard: { component: () => Promise.resolve({ __esModule: true, default: SettingsCard }) },
        spaceCard: {
            component: () => Promise.resolve({ __esModule: true, default: SpaceCard }),
            props: ({ spaceId }) => ({ dbKey: `space:${spaceId}`, spaceMode: true }),
            whenOff: 'Turn on Probe first.',
        },
    };
    return {
        ADDON_MANIFESTS: [manifest],
        addonManifest: (id) => (id === 'probe' ? manifest : null),
        addonsContributing: (point) => (manifest[point] ? [manifest] : []),
    };
});

const { default: AddonActions } = await import('@/components/addons/AddonActions.vue');
const { default: AddonModalHost } = await import('@/components/addons/AddonModalHost.vue');
const { default: AddonCard } = await import('@/components/addons/AddonCard.vue');
const { useAddonsStore } = await import('@/store/addonsStore');

/** Set what the server says: offered (listed) and enabled or not. */
function serverSays({ offered = true, enabled = true } = {}) {
    useAddonsStore().addons = offered ? [{ id: 'probe', name: 'Probe', description: '', enabled, enabledAt: null }] : [];
}

describe('add-on contribution points', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        ui.addonModal = null;
        ui.openAddonModal.mockClear();
        ui.closeAddonModal.mockClear();
        modalMounts.mockClear();
        docStore.selectedFileId = 'doc-1';
        syncStore.isOnline = true;
    });

    describe('AddonActions', () => {
        it('renders nothing while the add-on is off or not offered', () => {
            serverSays({ enabled: false });
            expect(mount(AddonActions, { props: { surface: 'toolbar' } }).findAll('button')).toHaveLength(0);
            serverSays({ offered: false });
            expect(mount(AddonActions, { props: { surface: 'menu' } }).findAll('button')).toHaveLength(0);
        });

        it('renders the toolbar actions with derived test ids and opens the modal', async () => {
            serverSays();
            const wrapper = mount(AddonActions, { props: { surface: 'toolbar' } });
            const go = wrapper.get('[data-testid="submenu-tools-addon-probe-go"]');
            expect(go.text()).toBe('Probe');
            expect(go.attributes('title')).toBe('Go');
            await go.trigger('click');
            expect(ui.openAddonModal).toHaveBeenCalledWith('probe', 'main');
        });

        it('disables an action per `requires`, with the reason', async () => {
            serverSays();
            syncStore.isOnline = false;
            const wrapper = mount(AddonActions, { props: { surface: 'toolbar' } });
            const go = wrapper.get('[data-testid="submenu-tools-addon-probe-go"]');
            expect(go.attributes('disabled')).toBeDefined();
            expect(go.attributes('title')).toBe('Needs an internet connection');
            expect(wrapper.get('[data-testid="submenu-tools-addon-probe-free"]').attributes('disabled')).toBeUndefined();

            syncStore.isOnline = true;
            docStore.selectedFileId = null;
            await flushPromises();
            expect(go.attributes('title')).toBe('Select a document first');
            await go.trigger('click');
            expect(ui.openAddonModal).not.toHaveBeenCalled();
        });

        it('uses the menu label on the phone menu, with the offline suffix', async () => {
            serverSays();
            const wrapper = mount(AddonActions, { props: { surface: 'menu' } });
            const go = wrapper.get('[data-testid="phone-menu-addon-probe-go"]');
            expect(go.text()).toBe('Go to probe');
            syncStore.isOnline = false;
            await flushPromises();
            expect(go.text()).toBe('Go to probe (needs a connection)');
            expect(go.attributes('disabled')).toBeDefined();
        });

        it('keeps an action to the surfaces it lists', () => {
            serverSays();
            expect(mount(AddonActions, { props: { surface: 'toolbar' } }).find('[data-testid="submenu-tools-addon-probe-desk"]').exists()).toBe(true);
            const menu = mount(AddonActions, { props: { surface: 'menu' } });
            expect(menu.find('[data-testid="phone-menu-addon-probe-desk"]').exists()).toBe(false);
            expect(menu.find('[data-testid="phone-menu-addon-probe-free"]').exists()).toBe(true);
        });
    });

    describe('AddonModalHost', () => {
        it('mounts nothing while the add-on is off', async () => {
            serverSays({ enabled: false });
            mount(AddonModalHost);
            await flushPromises();
            expect(modalMounts).not.toHaveBeenCalled();
        });

        it('shows the requested modal, closes it, and keeps it mounted between openings', async () => {
            serverSays();
            const wrapper = mount(AddonModalHost);
            await flushPromises();
            expect(modalMounts).toHaveBeenCalledTimes(1);
            expect(wrapper.find('[data-testid="probe-modal"]').exists()).toBe(false);

            ui.openAddonModal('probe', 'main');
            await flushPromises();
            await wrapper.get('[data-testid="probe-modal"] button').trigger('click');
            expect(ui.closeAddonModal).toHaveBeenCalled();
            await flushPromises();
            expect(wrapper.find('[data-testid="probe-modal"]').exists()).toBe(false);

            ui.openAddonModal('probe', 'main');
            await flushPromises();
            expect(wrapper.find('[data-testid="probe-modal"]').exists()).toBe(true);
            expect(modalMounts).toHaveBeenCalledTimes(1);
        });
    });

    describe('AddonCard', () => {
        const spaceCard = () => mount(AddonCard, { props: { addonId: 'probe', point: 'spaceCard', context: { spaceId: 's1' } } });

        it('renders the card with the manifest props while the add-on is on', async () => {
            serverSays();
            const wrapper = spaceCard();
            await flushPromises();
            expect(wrapper.get('[data-testid="space-addon-probe"]').text()).toBe('card for space:s1 true');
        });

        it('shows whenOff only while the add-on is offered but off', async () => {
            serverSays({ enabled: false });
            const wrapper = spaceCard();
            await flushPromises();
            expect(wrapper.get('[data-testid="space-addon-probe-hint"]').text()).toBe('Turn on Probe first.');

            serverSays({ offered: false });
            await flushPromises();
            expect(wrapper.html()).not.toContain('Turn on Probe first.');
        });

        it('passes the layout to a settings card', async () => {
            serverSays();
            const wrapper = mount(AddonCard, { props: { addonId: 'probe', point: 'settingsCard', layout: 'phone' } });
            await flushPromises();
            expect(wrapper.get('[data-testid="settings-addon-probe"]').text()).toBe('settings phone');
        });
    });
});
