import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './authStore';

const isProd = import.meta.env.PROD;
const API_URL = isProd ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

function toQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export const useRevisionStore = defineStore('revisionStore', () => {
  const revisions = ref([]);
  const selectedRevisionId = ref(null);
  const revisionDetailCache = ref({});

  const isListLoading = ref(false);
  const listError = ref('');
  const isDetailLoading = ref(false);
  const detailError = ref('');
  const isActionLoading = ref(false);

  const hasMore = ref(false);
  const lastCursor = ref({ before: null, beforeId: null });

  const selectedRevision = computed(() => {
    if (!selectedRevisionId.value) return null;
    return revisions.value.find((item) => item.id === selectedRevisionId.value) || null;
  });

  const selectedRevisionDetail = computed(() => {
    if (!selectedRevisionId.value) return null;
    return revisionDetailCache.value[selectedRevisionId.value] || null;
  });

  function getAuthHeaders() {
    const auth = useAuthStore();
    return {
      Authorization: `Bearer ${auth.token || ''}`,
      'Content-Type': 'application/json',
    };
  }

  function resetState() {
    revisions.value = [];
    selectedRevisionId.value = null;
    revisionDetailCache.value = {};
    listError.value = '';
    detailError.value = '';
    hasMore.value = false;
    lastCursor.value = { before: null, beforeId: null };
  }

  async function fetchRevisions(noteId, { reset = true, limit = 50 } = {}) {
    if (!noteId) return;

    if (reset) {
      revisions.value = [];
      selectedRevisionId.value = null;
      revisionDetailCache.value = {};
      lastCursor.value = { before: null, beforeId: null };
      hasMore.value = false;
    }

    isListLoading.value = true;
    listError.value = '';

    try {
      const query = toQuery({
        limit,
        before: reset ? null : lastCursor.value.before,
        beforeId: reset ? null : lastCursor.value.beforeId,
      });

      const response = await fetch(`${API_URL}/notes/${noteId}/revisions?${query}`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load revisions');
      }

      const incoming = Array.isArray(data.revisions) ? data.revisions : [];
      revisions.value = reset ? incoming : [...revisions.value, ...incoming];

      hasMore.value = incoming.length === limit;
      if (revisions.value.length > 0) {
        const oldest = revisions.value[revisions.value.length - 1];
        lastCursor.value = {
          before: oldest.createdAt,
          beforeId: oldest.id,
        };
      }
    } catch (error) {
      listError.value = error.message || 'Failed to load revisions';
      throw error;
    } finally {
      isListLoading.value = false;
    }
  }

  async function loadMore(noteId, limit = 50) {
    if (!hasMore.value || isListLoading.value) return;
    return fetchRevisions(noteId, { reset: false, limit });
  }

  async function fetchRevisionDetail(noteId, revisionId) {
    if (!noteId || !revisionId) return null;
    if (revisionDetailCache.value[revisionId]) {
      selectedRevisionId.value = revisionId;
      return revisionDetailCache.value[revisionId];
    }

    isDetailLoading.value = true;
    detailError.value = '';
    selectedRevisionId.value = revisionId;

    try {
      const response = await fetch(`${API_URL}/notes/${noteId}/revisions/${revisionId}`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load revision');
      }

      revisionDetailCache.value = {
        ...revisionDetailCache.value,
        [revisionId]: data.revision,
      };

      return data.revision;
    } catch (error) {
      detailError.value = error.message || 'Failed to load revision';
      throw error;
    } finally {
      isDetailLoading.value = false;
    }
  }

  async function saveManualRevision(noteId) {
    if (!noteId) return { created: false };

    isActionLoading.value = true;
    try {
      const response = await fetch(`${API_URL}/notes/${noteId}/revisions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save version');
      }

      await fetchRevisions(noteId, { reset: true, limit: 50 });
      return data;
    } finally {
      isActionLoading.value = false;
    }
  }

  async function restoreRevision(noteId, revisionId, expectedUpdatedAt = null) {
    if (!noteId || !revisionId) return null;

    isActionLoading.value = true;
    try {
      const response = await fetch(`${API_URL}/notes/${noteId}/revisions/${revisionId}/restore`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to restore revision');
      }

      await fetchRevisions(noteId, { reset: true, limit: 50 });
      if (selectedRevisionId.value && !revisions.value.some((item) => item.id === selectedRevisionId.value)) {
        selectedRevisionId.value = null;
      }

      return data;
    } finally {
      isActionLoading.value = false;
    }
  }

  return {
    revisions,
    selectedRevisionId,
    selectedRevision,
    selectedRevisionDetail,
    isListLoading,
    listError,
    isDetailLoading,
    detailError,
    isActionLoading,
    hasMore,
    resetState,
    fetchRevisions,
    loadMore,
    fetchRevisionDetail,
    saveManualRevision,
    restoreRevision,
  };
});
