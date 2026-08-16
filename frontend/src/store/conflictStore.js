import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';

/**
 * Read-only view over the client-local `note_conflicts` table (COLLAB-02).
 * Lets the document tree and dashboards render a persistent "unresolved
 * conflict" marker so displaced local bodies are not lost when a toast expires.
 */
export const useConflictStore = defineStore('conflictStore', () => {
    const syncStore = useSyncStore();
    const conflictedNoteIds = ref(new Set());

    const count = computed(() => conflictedNoteIds.value.size);

    async function loadConflicts() {
        if (!syncStore.isInitialized) {
            conflictedNoteIds.value = new Set();
            return;
        }
        const rows = await syncStore.execute('SELECT note_id FROM note_conflicts');
        conflictedNoteIds.value = new Set((rows || []).map((row) => row.note_id));
    }

    function hasConflict(noteId) {
        return conflictedNoteIds.value.has(noteId);
    }

    function clearAll() {
        conflictedNoteIds.value = new Set();
    }

    watch(
        () => syncStore.isInitialized,
        async (ready) => {
            if (ready) await loadConflicts();
        },
    );

    return { conflictedNoteIds, count, loadConflicts, hasConflict, clearAll };
});
