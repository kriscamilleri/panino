import { computed, effectScope, ref, watch } from 'vue';
import { useSyncStore } from '@/store/syncStore';
import { useAuthStore } from '@/store/authStore';
import { useCollabSessionStore } from '@/store/collabSessionStore';
import { deriveSyncStatus } from '@/utils/syncStatus';

// Sync changes are announced politely; syncing itself is too frequent to say.
const ANNOUNCEMENTS = {
    offline: "You're offline. Changes are saved on this phone and sync when you're back online.",
    error: 'Not synced. Local changes are safe.',
    synced: 'Synced.',
    off: 'Sync is off. Changes are saved on this phone.',
};

// App-wide, so a change made while one screen is open is still announced
// after moving to the next (each phone route has its own shell).
const announcement = ref('');
let announcerScope = null;

function syncStatusOf(syncStore) {
    return computed(() => deriveSyncStatus({
        isOnline: syncStore.isOnline,
        syncEnabled: syncStore.syncEnabled,
        isSyncing: syncStore.isSyncing,
        databases: syncStore.databases.values(),
    }));
}

function startAnnouncer(syncStore) {
    if (announcerScope) return;
    // Detached: it must outlive the screen that first started it.
    announcerScope = effectScope(true);
    announcerScope.run(() => {
        const sync = syncStatusOf(syncStore);
        watch(() => sync.value.state, (state, previous) => {
            if (!previous || state === 'syncing') return;
            // "Synced" after an ordinary save is noise; say it only on recovery.
            if (state === 'synced' && previous === 'syncing') return;
            announcement.value = ANNOUNCEMENTS[state] || '';
        });
    });
}

/**
 * Sync and live-session state as the phone screens show it.
 */
export function usePhoneStatus() {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();
    const collabStore = useCollabSessionStore();

    const sync = syncStatusOf(syncStore);
    startAnnouncer(syncStore);

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

    return { sync, announcement, liveParticipants, otherParticipants, syncNow };
}
