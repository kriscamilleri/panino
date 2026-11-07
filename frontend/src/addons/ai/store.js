import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useAuthStore } from '@/store/authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');
const BASE = '/addons/ai';

/**
 * The AI agents add-on (docs/specs/active/ai-integration.md §9): API keys,
 * connected apps (OAuth grants), the MCP setup details, and the consent calls.
 * A newly created key's secret is held only in `createdSecret` until the user
 * dismisses it.
 */
export const useAiAddonStore = defineStore('aiAddonStore', () => {
    /** @type {import('vue').Ref<Array<{ id: string, name: string, prefix: string, scope: string, spaceAccess: string, createdAt: string, expiresAt: string|null, lastUsedAt: string|null, expired: boolean }>>} */
    const keys = ref([]);
    const limit = ref(10);
    const isLoaded = ref(false);
    const isLoading = ref(false);
    const isSaving = ref(false);
    const error = ref('');
    /** @type {import('vue').Ref<{ key: object, secret: string } | null>} */
    const createdSecret = ref(null);

    /** @type {import('vue').Ref<Array<{ id: string, name: string, host: string|null, redirectHost: string, scope: string, spaceAccess: string, createdAt: string, lastUsedAt: string|null }>>} */
    const connections = ref([]);
    const connectionsError = ref('');
    /** @type {import('vue').Ref<{ mcpUrl: string|null, apiBaseUrl: string|null, oauthAvailable: boolean } | null>} */
    const setup = ref(null);

    const authStore = useAuthStore();
    watch(() => authStore.user?.id, () => reset());

    async function authFetch(path, options = {}) {
        const response = await fetch(`${API_BASE}${BASE}${path}`, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                Authorization: `Bearer ${authStore.token}`,
            },
        });
        let payload;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (!response.ok) {
            const requestError = new Error(payload?.message || payload?.error || 'Something went wrong. Try again.');
            requestError.status = response.status;
            requestError.code = payload?.code || payload?.error;
            throw requestError;
        }
        return payload;
    }

    /** Load the MCP URL and the API base URL for the setup help. */
    async function fetchSetup() {
        try {
            setup.value = await authFetch('/setup');
        } catch {
            setup.value = null;
        }
        return setup.value;
    }

    /** Load the caller's keys. */
    async function fetchKeys() {
        isLoading.value = true;
        error.value = '';
        try {
            const payload = await authFetch('/keys');
            keys.value = payload?.keys ?? [];
            limit.value = payload?.limit ?? 10;
            isLoaded.value = true;
        } catch (err) {
            error.value = err.message;
        } finally {
            isLoading.value = false;
        }
        return keys.value;
    }

    /**
     * Create a key. Its secret is kept in `createdSecret` for one display.
     * @param {{ name: string, scope: 'read'|'write', spaceAccess: 'all'|'personal', expiresInDays: number|null }} input
     */
    async function createKey(input) {
        isSaving.value = true;
        error.value = '';
        try {
            const payload = await authFetch('/keys', { method: 'POST', body: JSON.stringify(input) });
            keys.value = [payload.key, ...keys.value];
            createdSecret.value = { key: payload.key, secret: payload.secret };
            return payload;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isSaving.value = false;
        }
    }

    /**
     * Revoke a key; it stops working at once.
     * @param {string} id
     */
    async function revokeKey(id) {
        isSaving.value = true;
        error.value = '';
        try {
            await authFetch(`/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
            keys.value = keys.value.filter((key) => key.id !== id);
            if (createdSecret.value?.key?.id === id) createdSecret.value = null;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isSaving.value = false;
        }
    }

    /** Forget the one-time secret. */
    function dismissSecret() {
        createdSecret.value = null;
    }

    /** Load the apps connected through OAuth. */
    async function fetchConnections() {
        connectionsError.value = '';
        try {
            const payload = await authFetch('/connections');
            connections.value = payload?.connections ?? [];
        } catch (err) {
            connectionsError.value = err.message;
        }
        return connections.value;
    }

    /**
     * Disconnect an app; its tokens stop working at once.
     * @param {string} id
     */
    async function disconnect(id) {
        connectionsError.value = '';
        try {
            await authFetch(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
            connections.value = connections.value.filter((app) => app.id !== id);
        } catch (err) {
            connectionsError.value = err.message;
            throw err;
        }
    }

    /**
     * The sign-in request an app started, for the consent page.
     * @param {string} requestId
     */
    async function loadAuthorization(requestId) {
        const payload = await authFetch(`/oauth/requests/${encodeURIComponent(requestId)}`);
        return payload.request;
    }

    /**
     * Approve or deny a sign-in request; resolves to the URL to send the browser to.
     * @param {string} requestId
     * @param {{ approve: boolean, access?: 'read'|'write', spaceAccess?: 'all'|'personal' }} decision
     */
    async function decideAuthorization(requestId, { approve, access, spaceAccess }) {
        const path = `/oauth/requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'deny'}`;
        const payload = await authFetch(path, approve
            ? { method: 'POST', body: JSON.stringify({ access, spaceAccess }) }
            : { method: 'POST' });
        return payload.redirectTo;
    }

    function reset() {
        keys.value = [];
        isLoaded.value = false;
        error.value = '';
        createdSecret.value = null;
        connections.value = [];
        connectionsError.value = '';
        setup.value = null;
    }

    return {
        keys, limit, isLoaded, isLoading, isSaving, error, createdSecret,
        connections, connectionsError, setup,
        fetchSetup, fetchKeys, createKey, revokeKey, dismissSecret,
        fetchConnections, disconnect, loadAuthorization, decideAuthorization, reset,
    };
});
