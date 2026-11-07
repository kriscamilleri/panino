// @vitest-environment jsdom
// The AI agents add-on beyond keys (docs/specs/active/ai-integration.md §6.4, §9):
// MCP setup snippets, connected apps, the consent page and the manifest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { KEY_PLACEHOLDER, MCP_CLIENTS, mcpSnippet } from '../utils/mcpSetup';
import manifest from '../manifest.js';

const toast = vi.fn();
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: toast }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ hash: '' }) }));

const ConnectedApps = (await import('../components/ConnectedApps.vue')).default;
const AuthorizePage = (await import('../components/AuthorizePage.vue')).default;
const AiSettingsCard = (await import('../components/AiSettingsCard.vue')).default;

const MCP_URL = 'https://panino.sh/api/addons/ai/v1/mcp';
const APP = {
    id: 'g1', name: 'ChatGPT', host: 'chatgpt.com', redirectHost: 'chatgpt.com', scope: 'write', spaceAccess: 'all',
    createdAt: '2026-11-06T10:00:00.000Z', lastUsedAt: null,
};
const REQUEST = {
    id: 'r1', client: { name: 'ChatGPT', kind: 'metadata', host: 'chatgpt.com' },
    redirectHost: 'chatgpt.com', redirectIsLoopback: false, requestedAccess: 'read', expiresAt: '2026-11-06T10:10:00.000Z',
};

function api(routes) {
    const calls = [];
    const fetch = vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        const method = options.method || 'GET';
        calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
        const [status, body] = routes[`${method} ${path}`] || [404, { error: 'Not found' }];
        return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

beforeEach(() => {
    setActivePinia(createPinia());
    toast.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('MCP setup snippets', () => {
    it('builds the Claude Code command with or without a key', () => {
        expect(mcpSnippet('claude-code', MCP_URL)).toBe(`claude mcp add --transport http panino ${MCP_URL}`);
        expect(mcpSnippet('claude-code', MCP_URL, { key: 'pnk_real' }))
            .toBe(`claude mcp add --transport http panino ${MCP_URL} --header "Authorization: Bearer pnk_real"`);
        expect(mcpSnippet('claude-code', MCP_URL, { useKey: true })).toContain(`Bearer ${KEY_PLACEHOLDER}`);
    });

    it('writes JSON configs for Gemini CLI and generic clients', () => {
        expect(JSON.parse(mcpSnippet('gemini-cli', MCP_URL, { key: 'pnk_k' })))
            .toEqual({ mcpServers: { panino: { httpUrl: MCP_URL, headers: { Authorization: 'Bearer pnk_k' } } } });
        expect(JSON.parse(mcpSnippet('json', MCP_URL))).toEqual({ mcpServers: { panino: { url: MCP_URL } } });
    });

    it('has steps for every client and no snippet for URL-only apps', () => {
        for (const client of MCP_CLIENTS) expect(client.steps.length).toBeGreaterThan(20);
        expect(mcpSnippet('claude-apps', MCP_URL)).toBe('');
        expect(mcpSnippet('nope', MCP_URL)).toBe('');
    });
});

describe('manifest', () => {
    it('contributes a settings card and the consent page, lazily', () => {
        expect(manifest.id).toBe('ai');
        expect(typeof manifest.settingsCard.component).toBe('function');
        expect(manifest.pages.map((page) => page.id)).toEqual(['authorize']);
    });
});

describe('ConnectedApps', () => {
    it('lists apps and disconnects after confirmation', async () => {
        const calls = api({
            'GET /addons/ai/connections': [200, { connections: [APP], limit: 20 }],
            'DELETE /addons/ai/connections/g1': [200, { disconnected: true }],
        });
        const wrapper = mount(ConnectedApps);
        await flushPromises();
        expect(wrapper.get('[data-testid="ai-connected-app-g1"]').text()).toContain('From chatgpt.com · Read & write · All spaces');

        await wrapper.get('[data-testid="ai-connected-app-disconnect-g1"]').trigger('click');
        await wrapper.get('[data-testid="ai-connected-app-confirm-g1"]').trigger('click');
        await flushPromises();
        expect(calls.some((call) => call.method === 'DELETE' && call.path === '/addons/ai/connections/g1')).toBe(true);
        expect(wrapper.find('[data-testid="ai-connected-apps-empty"]').exists()).toBe(true);
        expect(toast).toHaveBeenCalledWith('Disconnected “ChatGPT”', 'success');
    });
});

describe('AiSettingsCard', () => {
    it('shows the MCP URL from the server', async () => {
        api({
            'GET /addons/ai/setup': [200, { mcpUrl: MCP_URL, apiBaseUrl: 'https://panino.sh/api/addons/ai/v1', oauthAvailable: true }],
            'GET /addons/ai/connections': [200, { connections: [] }],
            'GET /addons/ai/keys': [200, { keys: [], limit: 10 }],
        });
        const wrapper = mount(AiSettingsCard, { props: { layout: 'phone' } });
        await flushPromises();
        expect(wrapper.get('[data-testid="ai-mcp-url"]').text()).toBe(MCP_URL);
        expect(wrapper.get('[data-testid="ai-mcp-snippet"]').text()).toContain('claude mcp add');
        await wrapper.get('[data-testid="ai-mcp-client"]').setValue('claude-apps');
        expect(wrapper.find('[data-testid="ai-mcp-snippet"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="ai-mcp-steps"]').text()).toContain('custom connector');
    });

    it('says when the server cannot offer MCP sign-in', async () => {
        api({
            'GET /addons/ai/setup': [200, { mcpUrl: null, apiBaseUrl: null, oauthAvailable: false }],
            'GET /addons/ai/connections': [200, { connections: [] }],
            'GET /addons/ai/keys': [200, { keys: [], limit: 10 }],
        });
        const wrapper = mount(AiSettingsCard);
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-mcp-unavailable"]').exists()).toBe(true);
    });
});

describe('AuthorizePage', () => {
    let assign;
    beforeEach(() => {
        assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
    });

    it('shows who is asking and approves with the chosen access', async () => {
        const calls = api({
            'GET /addons/ai/oauth/requests/r1': [200, { request: REQUEST }],
            'POST /addons/ai/oauth/requests/r1/approve': [200, { redirectTo: 'https://chatgpt.com/cb?code=c&state=s&iss=x' }],
        });
        const wrapper = mount(AuthorizePage, { props: { query: { request: 'r1' } } });
        await flushPromises();
        expect(wrapper.get('[data-testid="ai-authorize-title"]').text()).toBe('Connect ChatGPT to Panino?');
        expect(wrapper.get('[data-testid="ai-authorize-identity"]').text()).toBe('Identified by chatgpt.com.');
        expect(wrapper.get('[data-testid="ai-authorize-access-read"]').element.checked).toBe(true);

        await wrapper.get('[data-testid="ai-authorize-access-write"]').setValue(true);
        await wrapper.get('[data-testid="ai-authorize-spaces-personal"]').setValue(true);
        await wrapper.get('[data-testid="ai-authorize-form"]').trigger('submit');
        await flushPromises();
        expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/addons/ai/oauth/requests/r1/approve', body: { access: 'write', spaceAccess: 'personal' } });
        expect(assign).toHaveBeenCalledWith('https://chatgpt.com/cb?code=c&state=s&iss=x');
        expect(wrapper.get('[data-testid="ai-authorize-leaving"]').text()).toContain('Returning to chatgpt.com');
    });

    it('cancels without approving', async () => {
        const calls = api({
            'GET /addons/ai/oauth/requests/r1': [200, { request: REQUEST }],
            'POST /addons/ai/oauth/requests/r1/deny': [200, { redirectTo: 'https://chatgpt.com/cb?error=access_denied' }],
        });
        const wrapper = mount(AuthorizePage, { props: { query: { request: 'r1' } } });
        await flushPromises();
        await wrapper.get('[data-testid="ai-authorize-deny"]').trigger('click');
        await flushPromises();
        expect(calls.some((call) => call.path.endsWith('/approve'))).toBe(false);
        expect(assign).toHaveBeenCalledWith('https://chatgpt.com/cb?error=access_denied');
    });

    it('warns about apps that registered themselves and loopback returns', async () => {
        api({ 'GET /addons/ai/oauth/requests/r2': [200, { request: { ...REQUEST, id: 'r2', client: { name: 'CLI', kind: 'registered', host: null }, redirectHost: 'localhost:7777', redirectIsLoopback: true } }] });
        const wrapper = mount(AuthorizePage, { props: { query: { request: 'r2' } } });
        await flushPromises();
        expect(wrapper.get('[data-testid="ai-authorize-identity"]').text()).toContain('registered itself');
        expect(wrapper.get('[data-testid="ai-authorize-redirect"]').text()).toContain('an app on this computer');
    });

    it('explains errors from the server and from the request itself', async () => {
        api({ 'GET /addons/ai/oauth/requests/gone': [404, { error: 'expired', code: 'REQUEST_NOT_FOUND' }] });
        const expired = mount(AuthorizePage, { props: { query: { request: 'gone' } } });
        await flushPromises();
        expect(expired.get('[data-testid="ai-authorize-error"]').text()).toContain('expired or was already used');

        const badClient = mount(AuthorizePage, { props: { query: { error: 'invalid_redirect_uri' } } });
        await flushPromises();
        expect(badClient.get('[data-testid="ai-authorize-error"]').text()).toContain('has not registered');
    });
});
