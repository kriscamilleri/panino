import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

/**
 * Personal API keys (docs/specs/active/llm-api.md §5): list, create and revoke
 * through the session-only `/api-keys` routes. A newly created key's secret is
 * held only in `createdSecret` until the user dismisses it.
 */
export const useApiKeysStore = defineStore('apiKeysStore', () => {
    /** @type {import('vue').Ref<Array<{ id: string, name: string, prefix: string, scope: string, spaceAccess: string, createdAt: string, expiresAt: string|null, lastUsedAt: string|null, expired: boolean }>>} */
    const keys = ref([]);
    const limit = ref(10);
    const isLoaded = ref(false);
    const isLoading = ref(false);
    const isSaving = ref(false);
    const error = ref('');
    /** @type {import('vue').Ref<{ key: object, secret: string } | null>} */
    const createdSecret = ref(null);

    const authStore = useAuthStore();
    watch(() => authStore.user?.id, () => reset());

    async function authFetch(path, options = {}) {
        const response = await fetch(`${API_BASE}${path}`, {
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
            const requestError = new Error(payload?.error || 'Something went wrong. Try again.');
            requestError.status = response.status;
            requestError.code = payload?.code;
            throw requestError;
        }
        return payload;
    }

    /** Load the caller's keys. */
    async function fetchKeys() {
        isLoading.value = true;
        error.value = '';
        try {
            const payload = await authFetch('/api-keys');
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
            const payload = await authFetch('/api-keys', { method: 'POST', body: JSON.stringify(input) });
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
            await authFetch(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

    function reset() {
        keys.value = [];
        isLoaded.value = false;
        error.value = '';
        createdSecret.value = null;
    }

    return {
        keys, limit, isLoaded, isLoading, isSaving, error, createdSecret,
        fetchKeys, createKey, revokeKey, dismissSecret, reset,
    };
});
