import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

/**
 * The user's Odoo connection (docs/specs/active/odoo-integration.md). The API key
 * goes to the server once, on connect, and never comes back.
 */
export const useOdooStore = defineStore('odooStore', () => {
    const status = ref(null);
    /** False when the server has the integration switched off (404). */
    const available = ref(false);
    const error = ref('');
    const isLoading = ref(false);
    const isSaving = ref(false);
    const isChecking = ref(false);
    const isDisconnecting = ref(false);

    const isConnected = computed(() => Boolean(status.value?.connected));

    async function authFetch(path, options = {}) {
        const authStore = useAuthStore();
        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {}),
                Authorization: `Bearer ${authStore.token}`,
            },
        });
        let payload;
        try {
            payload = response.status === 204 ? null : await response.json();
        } catch {
            payload = null;
        }
        if (!response.ok) {
            const requestError = new Error(payload?.message || 'Something went wrong. Try again.');
            requestError.status = response.status;
            requestError.code = payload?.error;
            throw requestError;
        }
        return payload;
    }

    /** Load the status; marks the integration unavailable when the server has it off. */
    async function fetchStatus() {
        isLoading.value = true;
        error.value = '';
        try {
            status.value = await authFetch('/integrations/odoo');
            available.value = true;
        } catch (err) {
            if (err.status === 404) {
                available.value = false;
                status.value = null;
            } else {
                error.value = err.message;
            }
        } finally {
            isLoading.value = false;
        }
        return status.value;
    }

    /**
     * Verify and save a connection. Resolves `true` on success; on failure sets
     * `error` to the server's message and resolves `false`.
     *
     * @param {{ baseUrl: string, databaseName: string, apiKey: string, keyExpiresOn: string }} input
     * @returns {Promise<boolean>}
     */
    async function connect(input) {
        isSaving.value = true;
        error.value = '';
        try {
            status.value = await authFetch('/integrations/odoo', { method: 'PUT', body: JSON.stringify(input) });
            return true;
        } catch (err) {
            error.value = err.message;
            return false;
        } finally {
            isSaving.value = false;
        }
    }

    /** Re-check the stored connection; the result shows in `status.lastError`. */
    async function check() {
        isChecking.value = true;
        error.value = '';
        try {
            status.value = await authFetch('/integrations/odoo/check', { method: 'POST' });
        } catch (err) {
            error.value = err.message;
        } finally {
            isChecking.value = false;
        }
    }

    /** @returns {Promise<boolean>} */
    async function disconnect() {
        isDisconnecting.value = true;
        error.value = '';
        try {
            await authFetch('/integrations/odoo', { method: 'DELETE' });
            status.value = { connected: false };
            return true;
        } catch (err) {
            error.value = err.message;
            return false;
        } finally {
            isDisconnecting.value = false;
        }
    }

    /**
     * Documents folders matching `query`.
     *
     * @param {string} query
     * @returns {Promise<{ id: number, name: string, parentName: string|null }[]>}
     */
    async function fetchFolders(query = '') {
        const payload = await authFetch(`/integrations/odoo/folders?q=${encodeURIComponent(query)}`);
        return payload?.folders || [];
    }

    /**
     * What this Document was sent as, and the remembered folder.
     *
     * @param {string} dbKey
     * @param {string} noteId
     */
    async function fetchLinks(dbKey, noteId) {
        const params = new URLSearchParams({ dbKey, noteId });
        return authFetch(`/integrations/odoo/links?${params}`);
    }

    /**
     * Send a Document. Resolves with the server's per-destination results; a
     * refused request rejects with the server's message.
     *
     * @param {{ dbKey: string, noteId: string, title: string, pdfRequest: object, documents?: { folderId?: number } }} body
     */
    async function send(body) {
        return authFetch('/integrations/odoo/send', { method: 'POST', body: JSON.stringify(body) });
    }

    return {
        status,
        available,
        error,
        isLoading,
        isSaving,
        isChecking,
        isDisconnecting,
        isConnected,
        fetchStatus,
        connect,
        check,
        disconnect,
        fetchFolders,
        fetchLinks,
        send,
    };
});
