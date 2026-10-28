import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

/**
 * The user's Odoo connection (docs/specs/active/odoo-integration.md). The API key
 * goes to the server once, on connect, and never comes back. Whether the add-on
 * is available at all is the addonsStore's business (`isActive('odoo')`).
 */
export const useOdooStore = defineStore('odooStore', () => {
    const status = ref(null);
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

    /** Load the status; null when the add-on is not offered or not switched on. */
    async function fetchStatus() {
        isLoading.value = true;
        error.value = '';
        try {
            status.value = await authFetch('/addons/odoo');
        } catch (err) {
            if (err.status === 404 || err.code === 'addon_disabled') {
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
            status.value = await authFetch('/addons/odoo', { method: 'PUT', body: JSON.stringify(input) });
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
            status.value = await authFetch('/addons/odoo/check', { method: 'POST' });
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
            await authFetch('/addons/odoo', { method: 'DELETE' });
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
        const payload = await authFetch(`/addons/odoo/folders?q=${encodeURIComponent(query)}`);
        return payload?.folders || [];
    }

    /**
     * Knowledge articles matching `query`, for the parent picker.
     *
     * @param {string} query
     * @returns {Promise<{ id: number, name: string, parentName: string|null }[]>}
     */
    async function fetchArticles(query = '') {
        const payload = await authFetch(`/addons/odoo/articles?q=${encodeURIComponent(query)}`);
        return payload?.articles || [];
    }

    /**
     * Opportunities and sales orders matching `query`. With a Document named, the
     * records it was already sent to come first, flagged `sent`.
     *
     * @param {string} query
     * @param {{ dbKey?: string, noteId?: string }} [document]
     * @returns {Promise<{ resModel: string, resId: number, name: string, partnerName: string|null, status: string|null, sent: boolean }[]>}
     */
    async function fetchRecords(query = '', { dbKey, noteId } = {}) {
        const params = new URLSearchParams({ q: query });
        if (dbKey && noteId) {
            params.set('dbKey', dbKey);
            params.set('noteId', noteId);
        }
        const payload = await authFetch(`/addons/odoo/records?${params}`);
        return payload?.records || [];
    }

    /**
     * What this Document was sent as, and the remembered folder.
     *
     * @param {string} dbKey
     * @param {string} noteId
     */
    async function fetchLinks(dbKey, noteId) {
        const params = new URLSearchParams({ dbKey, noteId });
        return authFetch(`/addons/odoo/links?${params}`);
    }

    /**
     * The syncs of a database (docs/specs/active/odoo-integration.md §11).
     *
     * @param {string} dbKey
     * @returns {Promise<object[]>}
     */
    async function fetchSyncs(dbKey) {
        const payload = await authFetch(`/addons/odoo/syncs?${new URLSearchParams({ dbKey })}`);
        return payload?.syncs || [];
    }

    /**
     * Keep a folder or a Document in sync with Knowledge. Rejects with the
     * server's message.
     *
     * @param {{ dbKey: string, scope: 'folder'|'note', sourceId: string, parentArticleId?: number|null }} input
     * @returns {Promise<object>} the sync
     */
    async function createSync(input) {
        const payload = await authFetch('/addons/odoo/syncs', { method: 'POST', body: JSON.stringify(input) });
        return payload?.sync || null;
    }

    /** @returns {Promise<object>} the sync after the run */
    async function runSync(dbKey, syncId) {
        const payload = await authFetch(`/addons/odoo/syncs/${encodeURIComponent(syncId)}/run?${new URLSearchParams({ dbKey })}`, { method: 'POST' });
        return payload?.sync || null;
    }

    async function removeSync(dbKey, syncId) {
        await authFetch(`/addons/odoo/syncs/${encodeURIComponent(syncId)}?${new URLSearchParams({ dbKey })}`, { method: 'DELETE' });
    }

    /**
     * Send a Document. Resolves with the server's per-destination results; a
     * refused request rejects with the server's message.
     *
     * @param {{ dbKey: string, noteId: string, title: string, pdfRequest?: object, documents?: { folderId?: number }, chatter?: { resModel: string, resId: number }, knowledge?: { parentId?: number|null, html: string } }} body
     */
    async function send(body) {
        return authFetch('/addons/odoo/send', { method: 'POST', body: JSON.stringify(body) });
    }

    return {
        status,
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
        fetchArticles,
        fetchRecords,
        fetchLinks,
        send,
        fetchSyncs,
        createSync,
        runSync,
        removeSync,
    };
});
