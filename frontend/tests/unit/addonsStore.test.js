// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));

const { useAddonsStore } = await import('@/store/addonsStore');

const ODOO = { id: 'odoo', name: 'Odoo', description: 'Send Documents to your Odoo.', enabled: false, enabledAt: null };

/** fetch answering GET /addons with `list` and PUT /addons/:id with `put(id, body)`. */
function api({ list = { addons: [ODOO] }, listStatus = 200, put } = {}) {
    const calls = [];
    const fetch = vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
        if (path === '/addons') {
            return Promise.resolve({ ok: listStatus === 200, status: listStatus, json: () => Promise.resolve(listStatus === 200 ? list : { error: 'Not found' }) });
        }
        const match = path.match(/^\/addons\/([^/]+)\/enabled$/);
        if (match && options.method === 'PUT') {
            const result = put ? put(match[1], JSON.parse(options.body)) : { ok: true, status: 200, body: { ...ODOO, enabled: JSON.parse(options.body).enabled, enabledAt: '2026-10-27T10:00:00.000Z' } };
            return Promise.resolve({ ok: result.ok, status: result.status, json: () => Promise.resolve(result.body) });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

describe('addonsStore', () => {
    beforeEach(() => setActivePinia(createPinia()));
    afterEach(() => vi.unstubAllGlobals());

    it('loads the offered add-ons once, with the token, and reloads on force', async () => {
        const calls = api();
        const store = useAddonsStore();
        expect(store.isActive('odoo')).toBe(false);

        await Promise.all([store.fetchAddons(), store.fetchAddons()]);
        expect(calls.filter((c) => c.path === '/addons')).toHaveLength(1);
        expect(calls[0].headers.Authorization).toBe('Bearer jwt');
        expect(store.addons).toEqual([ODOO]);
        expect(store.isLoaded).toBe(true);
        expect(store.get('odoo')).toEqual(ODOO);
        expect(store.isActive('odoo')).toBe(false);

        await store.fetchAddons();
        expect(calls.filter((c) => c.path === '/addons')).toHaveLength(1);
        await store.fetchAddons({ force: true });
        expect(calls.filter((c) => c.path === '/addons')).toHaveLength(2);
    });

    it('treats a server without add-ons as offering none', async () => {
        api({ listStatus: 404 });
        const store = useAddonsStore();
        await store.fetchAddons();
        expect(store.addons).toEqual([]);
        expect(store.isLoaded).toBe(true);
        expect(store.error).toBe('');
    });

    it('keeps other failures as an error and stays unloaded', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'Server down' }) })));
        const store = useAddonsStore();
        await store.fetchAddons();
        expect(store.error).toBe('Server down');
        expect(store.isLoaded).toBe(false);
    });

    it('switches an add-on on and off through PUT and reflects the server entry', async () => {
        const calls = api();
        const store = useAddonsStore();
        await store.fetchAddons();

        expect(await store.setEnabled('odoo', true)).toBe(true);
        expect(calls.at(-1)).toMatchObject({ path: '/addons/odoo/enabled', method: 'PUT', body: { enabled: true } });
        expect(store.isActive('odoo')).toBe(true);
        expect(store.get('odoo').enabledAt).toBe('2026-10-27T10:00:00.000Z');
        expect(store.isSwitching('odoo')).toBe(false);

        expect(await store.setEnabled('odoo', false)).toBe(true);
        expect(store.isActive('odoo')).toBe(false);
    });

    it('reports a refused switch and leaves the state alone', async () => {
        api({ put: () => ({ ok: false, status: 404, body: { error: 'Not found', message: 'Not offered' } }) });
        const store = useAddonsStore();
        await store.fetchAddons();
        expect(await store.setEnabled('odoo', true)).toBe(false);
        expect(store.error).toBe('Not offered');
        expect(store.isActive('odoo')).toBe(false);
    });

    it('does not send a second switch while one is in flight', async () => {
        let release;
        const calls = [];
        vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
            calls.push(options.method || 'GET');
            if (options.method === 'PUT') return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...ODOO, enabled: true }) }); });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ addons: [ODOO] }) });
        }));
        const store = useAddonsStore();
        await store.fetchAddons();
        const first = store.setEnabled('odoo', true);
        expect(store.isSwitching('odoo')).toBe(true);
        expect(await store.setEnabled('odoo', false)).toBe(false);
        release();
        expect(await first).toBe(true);
        expect(calls.filter((m) => m === 'PUT')).toHaveLength(1);
    });

    it('forgets the list on reset', async () => {
        api();
        const store = useAddonsStore();
        await store.fetchAddons();
        store.reset();
        expect(store.addons).toEqual([]);
        expect(store.isLoaded).toBe(false);
    });
});
