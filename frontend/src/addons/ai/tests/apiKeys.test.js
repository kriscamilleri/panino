// @vitest-environment jsdom
// The AI agents add-on's API keys (docs/specs/active/llm-api.md §5.4): helpers, store and section.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import {
    accessLabel,
    apiV1BaseUrl,
    curlExample,
    expiryLabel,
    formatKeyDate,
    spacesLabel,
} from '../utils/apiKeys';

const toast = vi.fn();
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: toast }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ hash: '' }) }));

const { useAiAddonStore: useApiKeysStore } = await import('../store');
const ApiKeysSection = (await import('../components/ApiKeysSection.vue')).default;

const KEY = {
    id: 'k1', name: 'Claude Code', prefix: 'pnk_abcdefgh', scope: 'write', spaceAccess: 'all',
    createdAt: '2026-11-06T10:00:00.000Z', expiresAt: '2027-02-04T10:00:00.000Z', lastUsedAt: null, expired: false,
};
const SECRET = `pnk_abcdefgh${'x'.repeat(35)}`;

/** fetch answering the three /addons/ai/keys routes. */
function api({ keys = [KEY], createStatus = 201 } = {}) {
    const calls = [];
    const fetch = vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        const method = options.method || 'GET';
        calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
        const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
        if (path === '/addons/ai/keys' && method === 'GET') return reply(200, { keys, limit: 10 });
        if (path === '/addons/ai/keys' && method === 'POST') {
            if (createStatus !== 201) return reply(createStatus, { error: 'You can have at most 10 API keys. Revoke one first.', code: 'API_KEY_LIMIT' });
            const body = JSON.parse(options.body);
            return reply(201, { key: { ...KEY, id: 'k2', name: body.name, scope: body.scope }, secret: SECRET });
        }
        if (path.startsWith('/addons/ai/keys/') && method === 'DELETE') return reply(200, { revoked: true });
        return reply(404, { error: 'Not found' });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

describe('api key helpers', () => {
    it('builds the base URL for production and development', () => {
        expect(apiV1BaseUrl({ isProd: true, origin: 'https://panino.sh' })).toBe('https://panino.sh/api/addons/ai/v1');
        expect(apiV1BaseUrl({ isProd: false, origin: 'http://localhost:5173', apiServiceUrl: 'http://localhost:8000/' })).toBe('http://localhost:8000/addons/ai/v1');
        expect(apiV1BaseUrl({ isProd: false, origin: 'x' })).toBe('http://localhost:8000/addons/ai/v1');
    });

    it('writes a curl example and labels', () => {
        expect(curlExample('https://panino.sh/api/v1', 'pnk_x')).toBe('curl -H "Authorization: Bearer pnk_x" "https://panino.sh/api/v1/search?q=meeting"');
        expect(accessLabel('read')).toBe('Read only');
        expect(accessLabel('write')).toBe('Read & write');
        expect(spacesLabel('personal')).toBe('Personal only');
        expect(spacesLabel('all')).toBe('All spaces');
        expect(formatKeyDate(null, 'never')).toBe('never');
        expect(formatKeyDate('junk', '—')).toBe('—');
        expect(expiryLabel({ expired: true, expiresAt: '2020-01-01' })).toBe('Expired');
        expect(expiryLabel({ expired: false, expiresAt: null })).toBe('Never');
    });
});

describe('AI add-on store: keys', () => {
    beforeEach(() => setActivePinia(createPinia()));
    afterEach(() => vi.unstubAllGlobals());

    it('lists with the session token, creates holding the secret once, revokes', async () => {
        const calls = api();
        const store = useApiKeysStore();
        await store.fetchKeys();
        expect(calls[0].headers.Authorization).toBe('Bearer jwt');
        expect(store.keys).toEqual([KEY]);

        await store.createKey({ name: 'Agent', scope: 'read', spaceAccess: 'personal', expiresInDays: null });
        expect(calls[1].body).toEqual({ name: 'Agent', scope: 'read', spaceAccess: 'personal', expiresInDays: null });
        expect(store.keys.map((key) => key.id)).toEqual(['k2', 'k1']);
        expect(store.createdSecret.secret).toBe(SECRET);
        store.dismissSecret();
        expect(store.createdSecret).toBeNull();

        await store.revokeKey('k1');
        expect(calls[2]).toMatchObject({ path: '/addons/ai/keys/k1', method: 'DELETE' });
        expect(store.keys.map((key) => key.id)).toEqual(['k2']);
    });

    it('shows the server message when creating fails', async () => {
        api({ createStatus: 409 });
        const store = useApiKeysStore();
        await expect(store.createKey({ name: 'x', scope: 'read', spaceAccess: 'all', expiresInDays: 90 })).rejects.toThrow('at most 10');
        expect(store.error).toContain('at most 10');
        expect(store.createdSecret).toBeNull();
    });
});

describe('ApiKeysSection', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        toast.mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('creates a key and shows it once with a curl example', async () => {
        const calls = api({ keys: [] });
        const wrapper = mount(ApiKeysSection);
        await flushPromises();
        expect(wrapper.find('[data-testid="api-keys-empty"]').exists()).toBe(true);

        await wrapper.get('[data-testid="api-keys-new"]').trigger('click');
        await wrapper.get('[data-testid="api-keys-name"]').setValue('Claude Code');
        await wrapper.get('[data-testid="api-keys-scope-write"]').setValue(true);
        await wrapper.get('[data-testid="api-keys-form"]').trigger('submit');
        await flushPromises();

        expect(calls.find((c) => c.method === 'POST').body).toEqual({ name: 'Claude Code', scope: 'write', spaceAccess: 'all', expiresInDays: 90 });
        expect(wrapper.get('[data-testid="api-keys-secret"]').text()).toBe(SECRET);
        expect(wrapper.get('[data-testid="api-keys-curl"]').text()).toContain(`Bearer ${SECRET}`);
        expect(wrapper.find('[data-testid="api-keys-form"]').exists()).toBe(false);

        await wrapper.get('[data-testid="api-keys-done"]').trigger('click');
        expect(wrapper.find('[data-testid="api-keys-secret"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(SECRET);
        expect(wrapper.get('[data-testid="api-key-k2"]').text()).toContain('pnk_abcdefgh…');
        wrapper.unmount();
    });

    it('forgets the secret when the user leaves Settings', async () => {
        api({ keys: [] });
        const store = useApiKeysStore();
        const wrapper = mount(ApiKeysSection);
        await flushPromises();
        await store.createKey({ name: 'x', scope: 'read', spaceAccess: 'all', expiresInDays: 90 });
        expect(store.createdSecret).not.toBeNull();
        wrapper.unmount();
        expect(store.createdSecret).toBeNull();
        const again = mount(ApiKeysSection);
        await flushPromises();
        expect(again.find('[data-testid="api-keys-secret"]').exists()).toBe(false);
        again.unmount();
    });

    it('asks before revoking', async () => {
        const calls = api();
        const wrapper = mount(ApiKeysSection);
        await flushPromises();
        expect(wrapper.get('[data-testid="api-key-k1"]').text()).toContain('Read & write');

        await wrapper.get('[data-testid="api-key-k1-revoke"]').trigger('click');
        expect(wrapper.get('[data-testid="api-key-k1-confirm"]').text()).toContain('stops working immediately');
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await wrapper.get('[data-testid="api-key-k1-revoke-confirm"]').trigger('click');
        await flushPromises();
        expect(calls.some((c) => c.method === 'DELETE' && c.path === '/addons/ai/keys/k1')).toBe(true);
        expect(wrapper.find('[data-testid="api-key-k1"]').exists()).toBe(false);
        expect(toast).toHaveBeenCalledWith('Revoked “Claude Code”', 'success');
        wrapper.unmount();
    });
});
