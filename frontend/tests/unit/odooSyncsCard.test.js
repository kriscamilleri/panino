// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const listFolders = vi.fn(async () => [
    { id: 'f-docs', name: 'Docs', parentId: null, path: 'Docs' },
    { id: 'f-sub', name: 'Sub', parentId: 'f-docs', path: 'Docs / Sub' },
]);
const addToast = vi.fn();
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt' }) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ personalDbKey: 'user:me', isOnline: true }) }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ listFolders }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast }) }));

const { default: OdooSyncsCard } = await import('@/components/OdooSyncsCard.vue');

const CONNECTED = { connected: true, baseUrl: 'https://acme.odoo.com', odooUserName: 'Mitchell Admin', apps: ['knowledge'] };
const SYNC = {
    id: 's1', scope: 'folder', sourceId: 'f-docs', sourceName: 'Docs', parentArticleId: 10, status: 'active', pausedReason: null,
    lastRunAt: new Date(Date.now() - 5 * 60000).toISOString(), lastResult: { created: 4, updated: 0, archived: 0, failures: [] }, running: false,
};

function api({ status = CONNECTED, syncs = [], articles = { articles: [{ id: 10, name: 'Company handbook', parentName: null }] }, created, ran } = {}) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (path === '/addons/odoo') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status) });
        if (path === '/addons/odoo/syncs' && options.method === 'POST') {
            return Promise.resolve(created?.error
                ? { ok: false, status: 409, json: () => Promise.resolve({ error: 'overlap', message: created.error }) }
                : { ok: true, status: 201, json: () => Promise.resolve({ sync: created }) });
        }
        if (path === '/addons/odoo/syncs') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ syncs }) });
        if (path === '/addons/odoo/articles') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(articles) });
        if (/\/addons\/odoo\/syncs\/[^/]+\/run$/.test(path)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ started: true, sync: ran }) });
        if (/\/addons\/odoo\/syncs\/[^/]+$/.test(path) && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not_found' }) });
    }));
    return calls;
}

describe('OdooSyncsCard', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        listFolders.mockClear();
        addToast.mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('explains when nothing can be synced', async () => {
        api({ status: { connected: false } });
        const none = mount(OdooSyncsCard);
        await flushPromises();
        expect(none.find('[data-testid="odoo-syncs-not-connected"]').exists()).toBe(true);

        setActivePinia(createPinia());
        api({ status: { ...CONNECTED, apps: ['documents'] } });
        const noApp = mount(OdooSyncsCard);
        await flushPromises();
        expect(noApp.find('[data-testid="odoo-syncs-no-knowledge"]').exists()).toBe(true);
        expect(noApp.find('[data-testid="odoo-syncs-add"]').exists()).toBe(false);
    });

    it('lists syncs with their last run, and runs one now', async () => {
        const calls = api({ syncs: [SYNC, { ...SYNC, id: 's2', scope: 'note', sourceName: 'Quote', status: 'paused', pausedReason: 'key_rejected', lastResult: { failures: [{ name: 'Quote', error: 'access_denied' }] } }], ran: { ...SYNC, lastResult: { created: 0, updated: 1, archived: 0, failures: [] }, lastRunAt: new Date().toISOString() } });
        const wrapper = mount(OdooSyncsCard);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-sync-status-s1"]').text()).toBe('Last sync 5 minutes ago: 4 created.');
        expect(wrapper.find('[data-testid="odoo-sync-status-s2"]').text()).toMatch(/Paused: Odoo rejected the API key/);
        expect(wrapper.find('[data-testid="odoo-sync-run-s2"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="odoo-sync-failures-s2"]').text()).toContain('1 record could not be written and will be retried: Quote');

        await wrapper.find('[data-testid="odoo-sync-run-s1"]').trigger('click');
        await flushPromises();
        expect(calls.some((c) => c.path === '/addons/odoo/syncs/s1/run' && c.method === 'POST')).toBe(true);
        expect(wrapper.find('[data-testid="odoo-sync-status-s1"]').text()).toBe('Last sync just now: 1 updated.');
        expect(addToast).toHaveBeenCalledWith('Synced to Odoo Knowledge.', 'success');
    });

    it('adds a folder sync under a chosen article', async () => {
        const calls = api({ created: { ...SYNC, id: 's9', sourceName: 'Sub', lastRunAt: null, lastResult: null } });
        const wrapper = mount(OdooSyncsCard);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-syncs-empty"]').exists()).toBe(true);
        await wrapper.find('[data-testid="odoo-syncs-add"]').trigger('click');
        await flushPromises();
        expect(listFolders).toHaveBeenCalledWith('user:me');
        const options = wrapper.findAll('[data-testid="odoo-sync-folder"] option');
        expect(options.map((o) => o.text())).toEqual(['Choose a folder', 'Docs', 'Docs / Sub']);
        expect(wrapper.find('[data-testid="odoo-sync-create"]').attributes('disabled')).toBeDefined();

        await wrapper.find('[data-testid="odoo-sync-folder"]').setValue('f-sub');
        await wrapper.find('[data-testid="odoo-sync-parent-10"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-sync-create"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('[data-testid="odoo-syncs-form"]').trigger('submit');
        await flushPromises();

        const created = calls.find((c) => c.path === '/addons/odoo/syncs' && c.method === 'POST');
        expect(created.body).toEqual({ dbKey: 'user:me', scope: 'folder', sourceId: 'f-sub', parentArticleId: 10 });
        expect(wrapper.find('[data-testid="odoo-sync-s9"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="odoo-sync-status-s9"]').text()).toBe('First sync is on its way.');
        expect(wrapper.find('[data-testid="odoo-syncs-form"]').exists()).toBe(false);
    });

    it('shows the server’s refusal in the form', async () => {
        api({ created: { error: 'That is already covered by a sync. Remove the other sync first.' } });
        const wrapper = mount(OdooSyncsCard);
        await flushPromises();
        await wrapper.find('[data-testid="odoo-syncs-add"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-testid="odoo-sync-folder"]').setValue('f-docs');
        await wrapper.find('[data-testid="odoo-sync-parent-top"]').trigger('click');
        await wrapper.find('[data-testid="odoo-syncs-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-sync-form-error"]').text()).toBe('That is already covered by a sync. Remove the other sync first.');
        expect(wrapper.find('[data-testid="odoo-syncs-form"]').exists()).toBe(true);
    });

    it('asks before removing a sync, and keeps the articles', async () => {
        const calls = api({ syncs: [SYNC] });
        const wrapper = mount(OdooSyncsCard);
        await flushPromises();
        await wrapper.find('[data-testid="odoo-sync-remove-s1"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-sync-confirm-s1"]').text()).toContain('The articles stay in Odoo as they are.');
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await wrapper.find('[data-testid="odoo-sync-remove-confirm-s1"]').trigger('click');
        await flushPromises();
        expect(calls.some((c) => c.path === '/addons/odoo/syncs/s1' && c.method === 'DELETE')).toBe(true);
        expect(wrapper.find('[data-testid="odoo-sync-s1"]').exists()).toBe(false);
    });
});
