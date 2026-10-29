// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const addToast = vi.fn();
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast }) }));
// The card under the switch comes from the add-on's manifest (settingsCard).
vi.mock('@/addons/registry', async () => {
    const { h } = await import('vue');
    const card = { props: ['layout'], render: () => h('button', { 'data-testid': 'odoo-card' }, 'Odoo connection') };
    const manifest = { id: 'odoo', settingsCard: { component: () => Promise.resolve({ __esModule: true, default: card }) } };
    return { ADDON_MANIFESTS: [manifest], addonManifest: (id) => (id === 'odoo' ? manifest : null), addonsContributing: () => [] };
});

const { default: AddonsSection } = await import('@/components/AddonsSection.vue');
const { useAddonsStore } = await import('@/store/addonsStore');

const ODOO = { id: 'odoo', name: 'Odoo', description: 'Send Documents to your Odoo.', enabled: false, enabledAt: null };

function api(list = { addons: [ODOO] }) {
    const puts = [];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        if (options.method === 'PUT') {
            const body = JSON.parse(options.body);
            puts.push({ path, body });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...ODOO, enabled: body.enabled }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list) });
    }));
    return puts;
}

const mountSection = () => mount(AddonsSection);

describe('AddonsSection', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        addToast.mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lists the offered add-ons off, without their cards', async () => {
        api();
        const wrapper = mountSection();
        await useAddonsStore().fetchAddons();
        await flushPromises();
        const toggle = wrapper.get('[data-testid="addon-odoo-switch"]');
        expect(toggle.attributes('aria-checked')).toBe('false');
        expect(toggle.attributes('role')).toBe('switch');
        expect(wrapper.text()).toContain('Send Documents to your Odoo.');
        expect(wrapper.find('[data-testid="settings-addon-odoo"]').exists()).toBe(false);
    });

    it('says when the server offers none', async () => {
        api({ addons: [] });
        const wrapper = mountSection();
        await useAddonsStore().fetchAddons();
        await flushPromises();
        expect(wrapper.get('[data-testid="addons-empty"]').text()).toContain('No add-ons are available');
    });

    it('switches on without asking, then shows the card', async () => {
        const puts = api();
        const wrapper = mountSection();
        await useAddonsStore().fetchAddons();
        await flushPromises();
        await wrapper.get('[data-testid="addon-odoo-switch"]').trigger('click');
        await flushPromises();
        expect(puts).toEqual([{ path: '/addons/odoo/enabled', body: { enabled: true } }]);
        expect(wrapper.get('[data-testid="addon-odoo-switch"]').attributes('aria-checked')).toBe('true');
        expect(wrapper.get('[data-testid="settings-addon-odoo"]').text()).toBe('Odoo connection');
        expect(addToast).toHaveBeenCalledWith('Odoo is on.', 'success');
    });

    it('asks before switching off, and can keep it on', async () => {
        const puts = api({ addons: [{ ...ODOO, enabled: true }] });
        const wrapper = mountSection();
        await useAddonsStore().fetchAddons();
        await flushPromises();
        expect(wrapper.find('[data-testid="settings-addon-odoo"]').exists()).toBe(true);

        await wrapper.get('[data-testid="addon-odoo-switch"]').trigger('click');
        expect(puts).toEqual([]);
        const confirm = wrapper.get('[data-testid="addon-odoo-confirm"]');
        expect(confirm.text()).toContain('Your connection and what you sent are kept');
        expect(wrapper.find('[data-testid="settings-addon-odoo"]').exists()).toBe(false);

        const buttons = confirm.findAll('button');
        await buttons.find((b) => b.text() === 'Keep on').trigger('click');
        expect(wrapper.find('[data-testid="addon-odoo-confirm"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="addon-odoo-switch"]').attributes('aria-checked')).toBe('true');
        expect(wrapper.find('[data-testid="settings-addon-odoo"]').exists()).toBe(true);

        await wrapper.get('[data-testid="addon-odoo-switch"]').trigger('click');
        await wrapper.get('[data-testid="addon-odoo-turn-off"]').trigger('click');
        await flushPromises();
        expect(puts).toEqual([{ path: '/addons/odoo/enabled', body: { enabled: false } }]);
        expect(wrapper.get('[data-testid="addon-odoo-switch"]').attributes('aria-checked')).toBe('false');
        expect(wrapper.find('[data-testid="settings-addon-odoo"]').exists()).toBe(false);
        expect(addToast).toHaveBeenCalledWith('Odoo is off. Your connection is kept.', 'info');
    });

    it('shows the store error', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'Server down' }) })));
        const wrapper = mountSection();
        await useAddonsStore().fetchAddons();
        await flushPromises();
        expect(wrapper.get('[data-testid="addons-error"]').text()).toBe('Server down');
    });
});
