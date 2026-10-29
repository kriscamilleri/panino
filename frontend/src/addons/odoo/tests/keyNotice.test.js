// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt' }) }));

const { default: OdooKeyNotice } = await import('@/addons/odoo/components/OdooKeyNotice.vue');

function api(status) {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status) }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

describe('OdooKeyNotice', () => {
    beforeEach(() => setActivePinia(createPinia()));
    afterEach(() => vi.unstubAllGlobals());

    it('says nothing while the key is fine, or without a connection', async () => {
        api({ connected: true, keyExpiresOn: inDays(60), lastError: null });
        const wrapper = mount(OdooKeyNotice);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-key-notice"]').exists()).toBe(false);

        api({ connected: false });
        const none = mount(OdooKeyNotice);
        await flushPromises();
        expect(none.find('[data-testid="odoo-key-notice"]').exists()).toBe(false);
    });

    it('warns from 14 days before the key expires', async () => {
        api({ connected: true, keyExpiresOn: inDays(3), lastError: null });
        const wrapper = mount(OdooKeyNotice);
        await flushPromises();
        const notice = wrapper.find('[data-testid="odoo-key-notice"]');
        expect(notice.classes()).toContain('pn-alert-warning');
        expect(notice.text()).toMatch(/expires in 3 days/);
        expect(wrapper.find('[data-testid="odoo-key-notice-settings"]').exists()).toBe(false);
    });

    it('shows a rejected key as an error and can point to Settings', async () => {
        api({ connected: true, keyExpiresOn: inDays(60), lastError: 'key_rejected', lastErrorMessage: 'Odoo rejected the API key. Check it, or create a new one in Odoo under Preferences → Account Security.' });
        const wrapper = mount(OdooKeyNotice, { props: { settingsLink: true } });
        await flushPromises();
        const notice = wrapper.find('[data-testid="odoo-key-notice"]');
        expect(notice.classes()).toContain('pn-alert-error');
        expect(notice.text()).toContain('Odoo rejected the API key.');
        await wrapper.find('[data-testid="odoo-key-notice-settings"]').trigger('click');
        expect(wrapper.emitted('open-settings')).toHaveLength(1);
    });

    it('does not fetch when told the parent already did', async () => {
        const fetch = api({ connected: true, keyExpiresOn: inDays(1) });
        mount(OdooKeyNotice, { props: { fetch: false } });
        await flushPromises();
        expect(fetch).not.toHaveBeenCalled();
    });
});
