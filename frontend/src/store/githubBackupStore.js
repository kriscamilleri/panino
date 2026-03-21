import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

export const useGithubBackupStore = defineStore('githubBackupStore', () => {
    const status = ref(null);
    const repos = ref([]);
    const error = ref('');
    const isLoadingStatus = ref(false);
    const isLoadingRepos = ref(false);
    const isSavingRepo = ref(false);
    const isCreatingRepo = ref(false);
    const isDisconnecting = ref(false);
    const isStartingBackup = ref(false);

    const isConnected = computed(() => Boolean(status.value?.connected));
    const selectedRepoFullName = computed(() => status.value?.repoFullName || '');

    async function authFetch(path, options = {}) {
        const authStore = useAuthStore();
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${authStore.token}`,
        };

        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const requestError = new Error(payload?.error || `Request failed with status ${response.status}`);
            requestError.status = response.status;
            requestError.payload = payload;
            throw requestError;
        }

        return payload;
    }

    async function fetchStatus() {
        isLoadingStatus.value = true;
        error.value = '';

        try {
            const payload = await authFetch('/backup/github/status');
            status.value = payload;
            return payload;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isLoadingStatus.value = false;
        }
    }

    async function fetchRepos() {
        isLoadingRepos.value = true;
        error.value = '';

        try {
            const payload = await authFetch('/backup/github/repos');
            repos.value = payload?.repos || [];
            return repos.value;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isLoadingRepos.value = false;
        }
    }

    async function startConnect() {
        error.value = '';
        const payload = await authFetch('/backup/github/connect', { method: 'POST' });
        return payload?.authorizeUrl || '';
    }

    async function disconnect() {
        isDisconnecting.value = true;
        error.value = '';

        try {
            await authFetch('/backup/github/disconnect', { method: 'DELETE' });
            status.value = null;
            repos.value = [];
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isDisconnecting.value = false;
        }
    }

    async function createRepo(name) {
        isCreatingRepo.value = true;
        error.value = '';

        try {
            const payload = await authFetch('/backup/github/repos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            await fetchStatus();
            await fetchRepos();
            return payload?.repo || null;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isCreatingRepo.value = false;
        }
    }

    async function selectRepo(repoFullName) {
        isSavingRepo.value = true;
        error.value = '';

        try {
            const payload = await authFetch('/backup/github/repo', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoFullName }),
            });
            await fetchStatus();
            return payload?.repo || null;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isSavingRepo.value = false;
        }
    }

    async function runBackup() {
        isStartingBackup.value = true;
        error.value = '';

        try {
            const payload = await authFetch('/backup/github/run', { method: 'POST' });
            await fetchStatus();
            return payload;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isStartingBackup.value = false;
        }
    }

    return {
        status,
        repos,
        error,
        isLoadingStatus,
        isLoadingRepos,
        isSavingRepo,
        isCreatingRepo,
        isDisconnecting,
        isStartingBackup,
        isConnected,
        selectedRepoFullName,
        fetchStatus,
        fetchRepos,
        startConnect,
        disconnect,
        createRepo,
        selectRepo,
        runBackup,
    };
});