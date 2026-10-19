/**
 * One passive sync status for the phone UI: the avatar dot, the editor status
 * line, the Drawer footer and the Document menu all read from here.
 */

export const SYNC_SYNCED = 'synced';
export const SYNC_SYNCING = 'syncing';
export const SYNC_OFFLINE = 'offline';
export const SYNC_ERROR = 'error';
export const SYNC_OFF = 'off';

const ERROR_STATES = new Set(['sync-error', 'quota-error']);

/**
 * @param {object} input
 * @param {boolean} input.isOnline
 * @param {boolean} input.syncEnabled
 * @param {boolean} input.isSyncing
 * @param {Iterable<{status?: string, error?: string}>} [input.databases]
 * @returns {{ state: string, label: string, detail: string, error: string }}
 */
export function deriveSyncStatus({ isOnline, syncEnabled, isSyncing, databases = [] } = {}) {
    if (!isOnline) {
        return {
            state: SYNC_OFFLINE,
            label: 'Offline',
            detail: 'Saved on this phone',
            error: '',
        };
    }
    if (!syncEnabled) {
        return { state: SYNC_OFF, label: 'Sync off', detail: 'Saved on this phone', error: '' };
    }
    const failed = [...databases].find((entry) => ERROR_STATES.has(entry?.status));
    if (failed) {
        return {
            state: SYNC_ERROR,
            label: 'Not synced',
            detail: 'Not synced — tap to retry',
            error: failed.error || 'Sync failed. Local changes are safe and will retry.',
        };
    }
    if (isSyncing) {
        return { state: SYNC_SYNCING, label: 'Syncing', detail: 'Saving…', error: '' };
    }
    return { state: SYNC_SYNCED, label: 'Synced', detail: 'Synced · all changes saved', error: '' };
}

/**
 * The editor status line under the title.
 *
 * @param {object} input
 * @param {{state: string, detail: string}} input.sync result of deriveSyncStatus
 * @param {string} [input.folderName]
 * @param {boolean} [input.isSaving]
 * @param {boolean} [input.isDirty]
 * @param {number} [input.liveCount] people in the live session, 0 when solo
 * @returns {string}
 */
export function editorStatusLine({ sync, folderName = '', isSaving = false, isDirty = false, liveCount = 0 }) {
    if (liveCount > 0) return `Live · ${liveCount} editing`;
    if (sync.state === SYNC_ERROR) return sync.detail;
    if (sync.state === SYNC_OFFLINE || sync.state === SYNC_OFF) return sync.detail;
    if (isSaving || isDirty || sync.state === SYNC_SYNCING) return 'Saving…';
    return folderName ? `${folderName} · saved` : 'Saved';
}
