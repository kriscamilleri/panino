import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './authStore';

const IS_PROD = import.meta.env.PROD;
const API_BASE = IS_PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

function toQuery(params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    });
    const query = searchParams.toString();
    return query ? `?${query}` : '';
}

function toImageUrl(imageId) {
    return `${API_BASE}/images/${imageId}`;
}

export const useImageManagerStore = defineStore('imageManagerStore', () => {
    const images = ref([]);
    const nextCursor = ref(null);
    const isLoading = ref(false);
    const isDeleting = ref(false);
    const error = ref('');
    const stats = ref({ imageCount: 0, totalImageBytes: 0, quotaBytes: null });

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
            const message = payload?.error || `Request failed with status ${response.status}`;
            const requestError = new Error(message);
            requestError.status = response.status;
            requestError.payload = payload;
            throw requestError;
        }

        return payload;
    }

    async function fetchImages({ limit = 25, cursor = null, search = '', sort = 'created_desc' } = {}) {
        isLoading.value = true;
        error.value = '';

        try {
            const payload = await authFetch(`/images${toQuery({ limit, cursor, search, sort })}`);
            images.value = (payload?.images || []).map((item) => ({
                ...item,
                imageUrl: toImageUrl(item.id),
            }));
            nextCursor.value = payload?.nextCursor || null;
            return payload;
        } catch (err) {
            error.value = err.message;
            throw err;
        } finally {
            isLoading.value = false;
        }
    }

    async function fetchImageUsage(imageId) {
        const payload = await authFetch(`/images/${imageId}/usage`);
        return payload?.usage || { count: 0, notes: [] };
    }

    async function deleteImage(imageId, force = false) {
        isDeleting.value = true;
        try {
            return await authFetch(`/images/${imageId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force }),
            });
        } finally {
            isDeleting.value = false;
        }
    }

    async function bulkDelete(ids, force = false) {
        isDeleting.value = true;
        try {
            return await authFetch('/images/bulk-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, force }),
            });
        } finally {
            isDeleting.value = false;
        }
    }

    async function fetchStats() {
        const payload = await authFetch('/images/stats');
        stats.value = {
            imageCount: Number(payload?.imageCount || 0),
            totalImageBytes: Number(payload?.totalImageBytes || 0),
            quotaBytes: payload?.quotaBytes ?? null,
        };
        return stats.value;
    }

    return {
        images,
        nextCursor,
        isLoading,
        isDeleting,
        error,
        stats,
        fetchImages,
        fetchImageUsage,
        deleteImage,
        bulkDelete,
        fetchStats,
    };
});
