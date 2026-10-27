import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

/**
 * Add-ons (docs/specs/active/addons.md): the integrations this server offers
 * and which of them the user switched on. An add-on is active when it is in the
 * list (offered) and `enabled`; every add-on entry point renders only then.
 */
export const useAddonsStore = defineStore('addonsStore', () => {
    /** @type {import('vue').Ref<{ id: string, name: string, description: string, enabled: boolean, enabledAt: string|null }[]>} */
    const addons = ref([]);
    const isLoaded = ref(false);
    const isLoading = ref(false);
    const error = ref('');
    /** Ids whose switch is being saved. */
    const switching = ref([]);
    let inFlight = null;

    const authStore = useAuthStore();
    watch(() => authStore.user?.id, () => reset());

    async function authFetch(path, options = {}) {
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

    /**
     * Load the list once; `force` reloads it. A server without add-ons (404)
     * gives an empty list, not an error.
     *
     * @param {{ force?: boolean }} [options]
     */
    async function fetchAddons({ force = false } = {}) {
        if (isLoaded.value && !force) return addons.value;
        if (inFlight) return inFlight;
        isLoading.value = true;
        error.value = '';
        inFlight = (async () => {
            try {
                const payload = await authFetch('/addons');
                addons.value = Array.isArray(payload?.addons) ? payload.addons : [];
                isLoaded.value = true;
            } catch (err) {
                if (err.status === 404) {
                    addons.value = [];
                    isLoaded.value = true;
                } else {
                    error.value = err.message;
                }
            } finally {
                isLoading.value = false;
                inFlight = null;
            }
            return addons.value;
        })();
        return inFlight;
    }

    /** @returns {object|null} the offered add-on with this id */
    function get(id) {
        return addons.value.find((addon) => addon.id === id) || null;
    }

    /** @returns {boolean} offered by the server and switched on by the user */
    function isActive(id) {
        return get(id)?.enabled === true;
    }

    /** @returns {boolean} */
    function isSwitching(id) {
        return switching.value.includes(id);
    }

    /**
     * Switch an add-on on or off. Resolves `true` on success; on failure sets
     * `error` and resolves `false`.
     *
     * @param {string} id
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async function setEnabled(id, enabled) {
        if (isSwitching(id)) return false;
        switching.value = [...switching.value, id];
        error.value = '';
        try {
            const entry = await authFetch(`/addons/${encodeURIComponent(id)}/enabled`, {
                method: 'PUT',
                body: JSON.stringify({ enabled }),
            });
            addons.value = addons.value.map((addon) => (addon.id === id ? { ...addon, ...entry } : addon));
            return true;
        } catch (err) {
            error.value = err.message;
            return false;
        } finally {
            switching.value = switching.value.filter((pending) => pending !== id);
        }
    }

    function reset() {
        addons.value = [];
        isLoaded.value = false;
        error.value = '';
    }

    return {
        addons,
        isLoaded,
        isLoading,
        error,
        switching,
        fetchAddons,
        get,
        isActive,
        isSwitching,
        setEnabled,
        reset,
    };
});
