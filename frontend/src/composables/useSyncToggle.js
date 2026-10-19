import { useAuthStore } from '@/store/authStore';
import { useSyncStore } from '@/store/syncStore';
import { useUiStore } from '@/store/uiStore';

/**
 * Turning sync on or off, with the checks and messages the Navbar and phone
 * Settings share. Turning it on first refreshes the session, because sync is
 * most often off after an expired one.
 */
export function useSyncToggle() {
    const authStore = useAuthStore();
    const syncStore = useSyncStore();
    const uiStore = useUiStore();

    async function toggleSync() {
        if (!syncStore.isOnline) {
            uiStore.addToast('Cannot sync while offline. Changes will sync when you reconnect.', 'warning');
            return;
        }
        if (!authStore.isAuthenticated) {
            uiStore.addToast('Please log in again to enable sync.', 'warning');
            return;
        }
        if (!syncStore.syncEnabled) {
            const refreshed = await authStore.refreshToken();
            if (!refreshed) {
                uiStore.addToast('Session expired. Please log in again to enable sync.', 'warning');
                return;
            }
            syncStore.setSyncEnabled(true);
            uiStore.addToast('Sync enabled. Your documents will sync automatically.', 'success', 3000);
        } else {
            syncStore.setSyncEnabled(false);
            uiStore.addToast('Sync disabled. Changes will be stored locally only.', 'info', 3000);
        }
    }

    return { toggleSync };
}
