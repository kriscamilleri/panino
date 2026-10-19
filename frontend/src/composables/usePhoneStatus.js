import { computed } from 'vue';
import { useSyncStore } from '@/store/syncStore';
import { useAuthStore } from '@/store/authStore';
import { useCollabSessionStore } from '@/store/collabSessionStore';
import { deriveSyncStatus } from '@/utils/syncStatus';

/**
 * Sync and live-session state as the phone screens show it.
 */
export function usePhoneStatus() {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();
    const collabStore = useCollabSessionStore();

    const sync = computed(() => deriveSyncStatus({
        isOnline: syncStore.isOnline,
        syncEnabled: syncStore.syncEnabled,
        isSyncing: syncStore.isSyncing,
        databases: syncStore.databases.values(),
    }));

    /** Everyone in the live session for `noteId`, or nobody. */
    function liveParticipants(noteId) {
        if (!noteId || !collabStore.isActive || collabStore.noteId !== noteId) return [];
        return collabStore.participants || [];
    }

    /** The other people in that session; the avatar stack never shows yourself. */
    function otherParticipants(noteId) {
        const self = authStore.user?.id;
        return liveParticipants(noteId).filter((participant) => participant.id !== self);
    }

    /** Retry every database. Safe to call repeatedly; syncStore queues overlaps. */
    function syncNow() {
        return syncStore.sync();
    }

    return { sync, liveParticipants, otherParticipants, syncNow };
}
