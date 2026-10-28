/**
 * When Odoo Knowledge syncs run (docs/specs/active/odoo-integration.md §11, "When
 * it runs"): three minutes after the last change in a synced database, on "Sync
 * now", and once a day as a full reconcile. One run per sync at a time, in a job
 * map like `backupJobs`; calls to one Odoo target are capped at 60 a minute so a
 * first run of a big folder does not hammer the server.
 *
 * A run uses the connection of the person the sync runs as (`run_as`). The sync
 * pauses, and says why, when that key is rejected, when they disconnect, or when
 * they switch the add-on off; switching it back on resumes it.
 */

import { getDb, parseDbKey } from './db.js';
import { listSpacesForUser, resolveSpaceAccess } from './spaces.js';
import { isAddonActive } from './addons.js';
import { OdooError } from './odooClient.js';
import { rememberConnectionError, senderConnection } from './odooConnection.js';
import { listSyncs, readSync, runSync, saveSyncRun, setSyncStatus } from './odooSync.js';
import { readInternalImage, renderPdf } from './pdf.js';

export const SYNC_DEBOUNCE_MS = 3 * 60 * 1000;
export const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CALLS_PER_MINUTE_PER_TARGET = 60;
let settleMs = 2000;

const timers = new Map();
const jobs = new Map();
const targetWindows = new Map();
let debounceMs = SYNC_DEBOUNCE_MS;

const jobKey = (dbKey, syncId) => `${dbKey}|${syncId}`;

/** Test seam: shorten the wait after changes, or clear everything. */
export function __configureSyncSchedulerForTests({ debounce, settle } = {}) {
    if (typeof debounce === 'number') debounceMs = debounce;
    if (typeof settle === 'number') settleMs = settle;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    jobs.clear();
    targetWindows.clear();
}

/**
 * A client whose calls to one Odoo target are spread out to the per-target cap.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {string} target
 */
export function rateLimitedClient(client, target) {
    return {
        version: client.version,
        async call(...args) {
            await waitForSlot(target);
            return client.call(...args);
        },
    };
}

async function waitForSlot(target) {
    for (;;) {
        const now = Date.now();
        const stamps = (targetWindows.get(target) || []).filter((at) => now - at < 60000);
        if (stamps.length < CALLS_PER_MINUTE_PER_TARGET) {
            stamps.push(now);
            targetWindows.set(target, stamps);
            return;
        }
        targetWindows.set(target, stamps);
        await new Promise((resolve) => setTimeout(resolve, Math.max(50, 60000 - (now - stamps[0]))));
    }
}

/** The account's global variables, as the Preview sees them. */
function globalsOf(db) {
    const map = new Map();
    try {
        for (const row of db.prepare('SELECT key, value FROM globals').all()) {
            if (row.key) map.set(row.key, row.value ?? '');
        }
    } catch {
        // A space database without globals yet.
    }
    return map;
}

/**
 * Schedule a run of every active sync in a database, a while after the last
 * change. Further changes restart the wait, so a burst is one run.
 *
 * @param {string} dbKey
 */
export function scheduleSyncRunsAfterChanges(dbKey) {
    let syncs;
    try {
        syncs = listSyncs(getDb(dbKey));
    } catch (error) {
        console.error('[odoo-sync] Could not list syncs:', error);
        return;
    }
    for (const sync of syncs) {
        if (sync.status !== 'active') continue;
        const key = jobKey(dbKey, sync.id);
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            void runSyncNow(dbKey, sync.id, { trigger: 'changes' });
        }, debounceMs));
    }
}

/**
 * Daily: run every sync whose last full comparison is older than a day.
 *
 * @param {string} dbKey
 */
export function triggerDailyReconcile(dbKey) {
    let syncs;
    try {
        syncs = listSyncs(getDb(dbKey));
    } catch {
        return;
    }
    const now = Date.now();
    for (const sync of syncs) {
        if (sync.status !== 'active') continue;
        const last = sync.last_reconcile_at ? new Date(sync.last_reconcile_at).getTime() : 0;
        if (now - last < RECONCILE_INTERVAL_MS) continue;
        void runSyncNow(dbKey, sync.id, { trigger: 'daily', reconcile: true });
    }
}

/** @returns {{ running: boolean, trigger?: string, startedAt?: string }} */
export function syncJobStatus(dbKey, syncId) {
    const job = jobs.get(jobKey(dbKey, syncId));
    return job && !job.finishedAt ? { running: true, trigger: job.trigger, startedAt: job.startedAt } : { running: false };
}

/**
 * Run one sync now, unless it is already running.
 *
 * @param {string} dbKey
 * @param {string} syncId
 * @param {{ trigger?: string, reconcile?: boolean }} [options]
 * @returns {Promise<{ started: boolean, reason?: string, result?: object }>}
 */
export async function runSyncNow(dbKey, syncId, { trigger = 'manual', reconcile = false } = {}) {
    const key = jobKey(dbKey, syncId);
    if (jobs.has(key)) return { started: false, reason: 'already-running' };
    clearTimeout(timers.get(key));
    timers.delete(key);
    const job = { trigger, startedAt: new Date().toISOString() };
    jobs.set(key, job);
    try {
        const result = await runOne(dbKey, syncId, { reconcile });
        return { started: true, result };
    } finally {
        // Kept a moment longer so a second "Sync now" right behind this one is refused.
        job.finishedAt = new Date().toISOString();
        if (settleMs > 0) setTimeout(() => jobs.delete(key), settleMs).unref?.();
        else jobs.delete(key);
    }
}

async function runOne(dbKey, syncId, { reconcile }) {
    const db = getDb(dbKey);
    const sync = readSync(db, syncId);
    if (!sync || sync.status !== 'active') return null;

    if (!isAddonActive(sync.run_as, 'odoo')) {
        setSyncStatus(db, syncId, { status: 'paused', reason: 'addon_disabled' });
        return null;
    }
    const parsed = parseDbKey(dbKey);
    if (parsed.kind === 'space') {
        const access = resolveSpaceAccess(parsed.id, sync.run_as);
        if (!access || !['owner', 'editor'].includes(access.role)) {
            setSyncStatus(db, syncId, { status: 'paused', reason: 'left_space' });
            return null;
        }
    }
    let sender;
    try {
        sender = senderConnection(sync.run_as);
    } catch (error) {
        if (error instanceof OdooError && error.code === 'key_rejected') {
            setSyncStatus(db, syncId, { status: 'paused', reason: 'key_rejected' });
            return null;
        }
        throw error;
    }
    if (!sender) {
        setSyncStatus(db, syncId, { status: 'paused', reason: 'not_connected' });
        return null;
    }
    if (sender.target !== sync.odoo_target) {
        // Connected to another Odoo now: the sync's articles live elsewhere.
        setSyncStatus(db, syncId, { status: 'paused', reason: 'not_connected' });
        return null;
    }

    let result;
    try {
        result = await runSync({
            db,
            sync,
            client: rateLimitedClient(sender.client, sender.target),
            odooTarget: sender.target,
            userId: sync.run_as,
            readImage: (src) => readInternalImage(src, sync.run_as),
            globals: globalsOf(db),
            reconcile,
            renderPdf: sync.documents_folder_id
                ? (request) => renderPdf(request, { userId: sync.run_as, priority: 'low' })
                : null,
        });
    } catch (error) {
        console.error('[odoo-sync] Run failed:', error instanceof OdooError ? error.code : error);
        result = { created: 0, updated: 0, unchanged: 0, archived: 0, restored: 0, pdfs: 0, failures: [{ sourceId: null, name: 'Run', error: error instanceof OdooError ? error.code : 'odoo_error' }], paused: null };
        if (error instanceof OdooError) rememberConnectionError(sender.userDb, error);
    }
    saveSyncRun(db, syncId, { result, reconcile: reconcile && !result.paused });
    if (result.paused) {
        setSyncStatus(db, syncId, { status: 'paused', reason: result.paused });
        rememberConnectionError(sender.userDb, new OdooError(result.paused));
    }
    return result;
}

/** The databases a person's connection may run syncs in: their own and their spaces'. */
function databasesRunBy(userId) {
    const keys = [`user:${userId}`];
    try {
        for (const space of listSpacesForUser(userId).spaces || []) keys.push(`space:${space.spaceId}`);
    } catch {
        // Shared spaces off, or no space activity: just the personal database.
    }
    return keys;
}

/**
 * Pause every sync a person runs, in their own database and in their spaces, for a
 * reason; resume them when that reason goes away (the add-on switched back on, a
 * new key).
 */
export function pauseSyncsRunBy(userId, reason) {
    for (const dbKey of databasesRunBy(userId)) {
        const db = getDb(dbKey);
        for (const sync of listSyncs(db)) {
            if (sync.run_as === userId && sync.status === 'active') setSyncStatus(db, sync.id, { status: 'paused', reason });
        }
    }
}

export function resumeSyncsRunBy(userId, reason) {
    for (const dbKey of databasesRunBy(userId)) {
        const db = getDb(dbKey);
        for (const sync of listSyncs(db)) {
            if (sync.run_as === userId && sync.status === 'paused' && sync.paused_reason === reason) {
                setSyncStatus(db, sync.id, { status: 'active' });
                void runSyncNow(dbKey, sync.id, { trigger: 'resumed' });
            }
        }
    }
}
