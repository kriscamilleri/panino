// /frontend/src/store/documentIndexStore.js
/**
 * The per-database, in-memory Document metadata index shared by the tag system
 * and search (docs/specs/active/tag-system.md §7, advanced-search.md §6.3).
 *
 * Per Document it holds the canonical tags with their display casing and the
 * front matter properties, read from the first 16 KB of the body. It is:
 *
 * - built lazily, the first time `ensure(dbKey)` is called, by streaming rows
 *   in pages (never at start-up; the first page waits for the browser to be
 *   idle);
 * - kept current for changed Documents only: every write to `notes` on this
 *   device reaches it through the database's update hook (the rows are re-read
 *   shortly after, inside the database's exclusive queue), and every committed
 *   remote change set through `remoteChangesApplied`, which the sync store
 *   calls after applying one;
 * - dropped when the database is removed or its handle is reopened;
 * - never written to the database and never synced.
 *
 * Contract (search builds on these names):
 *   ensure(dbKey) → Promise<void>
 *   isReady(dbKey) → boolean
 *   entry(dbKey, id) → { tags, tagLabels, properties } | null
 *   idsWithTags(dbKey, names) → Set<string>          (AND)
 *   metadataEntries(dbKey) → Iterable<[id, entry]>     (Documents with tags or properties)
 *   tagCounts(dbKey) → Map<string, number>
 *   tagLabel(dbKey, name) → string | null
 *   propertyKeys(dbKey) → { key, count }[]            (most used first)
 *   propertyValues(dbKey, key) → { value, count }[]   (most used first)
 *   noteChanged(dbKey, id, content), noteRemoved(dbKey, id),
 *   remoteChangesApplied(dbKey, changes), drop(dbKey)
 *   version (ref), versionOf(dbKey) → number          (bump on every change)
 */
import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import { parsePkId } from '@/utils/crsqlitePk';
import { runExclusive } from '@/utils/scopedRepository';
import { DocumentMetadataIndex, FRONT_MATTER_SCAN_CHARS } from '@/utils/documentMetadataIndex';
import { FRONT_MATTER_PREFILTER_SQL } from '@panino/content-merge/property-filter';
import { useSyncStore } from './syncStore';

/** Rows read per page while building. */
export const INDEX_BUILD_PAGE_SIZE = 250;
/** How long after a write the changed rows are re-read. */
export const INDEX_FLUSH_DELAY_MS = 100;

// Only a body that opens with `---` (after blank lines) can have front matter,
// so only those send their first 16 KB into JS; every other row sends its id.
// The API's property scan uses the same prefilter (shared), which skips the
// white space `String.trim` does (BOM, NBSP, form feed included), as the
// front matter parser does.
const HEAD_SQL = `CASE WHEN ${FRONT_MATTER_PREFILTER_SQL}
  THEN substr(content, 1, ${FRONT_MATTER_SCAN_CHARS}) ELSE NULL END`;
/** The build's page query (exported for a test on real SQLite). */
export const PAGE_SQL = `SELECT rowid AS rid, id, ${HEAD_SQL} AS head FROM notes WHERE rowid > ? ORDER BY rowid LIMIT ?`;
const CHANGED_SQL = `SELECT rowid AS rid, id, ${HEAD_SQL} AS head FROM notes
  WHERE rowid IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))`;

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function whenIdle() {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        return new Promise((resolve) => window.requestIdleCallback(() => resolve(), { timeout: 1000 }));
    }
    return nextTask();
}

export const useDocumentIndexStore = defineStore('documentIndexStore', () => {
    const syncStore = useSyncStore();

    /** Bumps whenever any database's metadata changes. */
    const version = ref(0);
    /** Per-database counters, so a view can depend on one database only. */
    const versions = reactive({});
    /** @type {Map<string, object>} dbKey → state; never reactive */
    const states = new Map();

    function bump(dbKey) {
        versions[dbKey] = (versions[dbKey] || 0) + 1;
        version.value += 1;
    }

    /**
     * The state for a database, created (and its update hook attached) on first
     * use. A reopened handle gets a fresh state.
     */
    function stateFor(dbKey) {
        const db = syncStore.databases.get(dbKey)?.db;
        if (!db) return null;
        const existing = states.get(dbKey);
        if (existing && existing.db === db) return existing;
        if (existing) drop(dbKey);
        const state = {
            dbKey,
            db,
            index: new DocumentMetadataIndex(),
            /** @type {Map<number, string>} */
            rowids: new Map(),
            /** @type {Map<string, number>} */
            idRowids: new Map(),
            status: 'idle',
            build: null,
            dirtyRowids: new Set(),
            dirtyIds: new Set(),
            timer: null,
            flushing: null,
            unhook: null,
        };
        if (typeof db.onUpdate === 'function') {
            state.unhook = db.onUpdate((_type, _dbName, table, rowid) => {
                if (table !== 'notes') return;
                state.dirtyRowids.add(Number(rowid));
                scheduleFlush(state);
            });
        }
        states.set(dbKey, state);
        return state;
    }

    function isCurrent(state) {
        return states.get(state.dbKey) === state;
    }

    function remember(state, rid, id) {
        const previousRowid = state.idRowids.get(id);
        if (previousRowid !== undefined && previousRowid !== rid) state.rowids.delete(previousRowid);
        const previousId = state.rowids.get(rid);
        let changed = false;
        if (previousId !== undefined && previousId !== id) {
            // The rowid was reused by another Document.
            state.idRowids.delete(previousId);
            changed = state.index.remove(previousId) || changed;
        }
        state.rowids.set(rid, id);
        state.idRowids.set(id, rid);
        return changed;
    }

    function forget(state, id) {
        const rid = state.idRowids.get(id);
        if (rid !== undefined) state.rowids.delete(rid);
        state.idRowids.delete(id);
        return state.index.remove(id);
    }

    async function build(state) {
        await whenIdle();
        const repository = syncStore.repository(state.dbKey);
        let after = -1;
        for (;;) {
            if (!isCurrent(state)) return;
            const rows = await repository.execute(PAGE_SQL, [after, INDEX_BUILD_PAGE_SIZE]);
            if (!isCurrent(state)) return;
            for (const row of rows || []) {
                const rid = Number(row.rid);
                remember(state, rid, row.id);
                state.index.set(row.id, row.head || '');
                after = rid;
            }
            if (!rows || rows.length < INDEX_BUILD_PAGE_SIZE) break;
            await nextTask();
        }
        state.status = 'ready';
        bump(state.dbKey);
        // Writes during the build were read by it or are re-read now.
        if (state.dirtyRowids.size || state.dirtyIds.size) scheduleFlush(state);
    }

    /**
     * Build a database's index if it has not been built. Concurrent callers
     * share one build; a failed build can be retried.
     * @param {string} dbKey canonical `user:<uuid>` / `space:<uuid>`
     * @returns {Promise<void>}
     */
    function ensure(dbKey) {
        const state = stateFor(dbKey);
        if (!state) return Promise.reject(new Error(`Database scope ${dbKey} is not initialized.`));
        if (state.status === 'ready') return Promise.resolve();
        if (!state.build) {
            state.status = 'building';
            state.build = build(state).catch((error) => {
                if (isCurrent(state)) {
                    state.status = 'idle';
                    state.build = null;
                }
                throw error;
            });
        }
        return state.build;
    }

    function scheduleFlush(state) {
        if (state.timer || state.status !== 'ready') return;
        state.timer = setTimeout(() => {
            state.timer = null;
            state.flushing = flush(state).catch((error) => {
                console.warn('[documentIndexStore] Could not refresh changed Documents', error?.name || error);
            }).finally(() => {
                state.flushing = null;
            });
        }, INDEX_FLUSH_DELAY_MS);
    }

    async function flush(state) {
        if (!isCurrent(state) || state.status !== 'ready') return;
        const rowids = [...state.dirtyRowids];
        const ids = [...state.dirtyIds];
        state.dirtyRowids.clear();
        state.dirtyIds.clear();
        if (!rowids.length && !ids.length) return;
        const repository = syncStore.repository(state.dbKey);
        // In the exclusive queue, so a transaction that is still open (a save, a
        // remote apply) has committed or rolled back before the rows are read.
        const rows = await runExclusive(state.dbKey, () => repository.execute(
            CHANGED_SQL,
            [JSON.stringify(rowids), JSON.stringify(ids)],
        ));
        if (!isCurrent(state)) return;
        let changed = false;
        const seenRowids = new Set();
        const seenIds = new Set();
        for (const row of rows || []) {
            const rid = Number(row.rid);
            seenRowids.add(rid);
            seenIds.add(row.id);
            changed = remember(state, rid, row.id) || changed;
            changed = state.index.set(row.id, row.head || '') || changed;
        }
        for (const rid of rowids) {
            if (seenRowids.has(rid)) continue;
            const id = state.rowids.get(rid);
            if (id !== undefined && !seenIds.has(id)) changed = forget(state, id) || changed;
        }
        for (const id of ids) {
            if (!seenIds.has(id)) changed = forget(state, id) || changed;
        }
        if (changed) bump(state.dbKey);
        if (state.dirtyRowids.size || state.dirtyIds.size) scheduleFlush(state);
    }

    function readyState(dbKey) {
        const state = states.get(dbKey);
        return state && state.status === 'ready' && syncStore.databases.get(dbKey)?.db === state.db ? state : null;
    }

    /** @param {string} dbKey @returns {boolean} whether the index is built */
    function isReady(dbKey) {
        return Boolean(readyState(dbKey));
    }

    /**
     * A Document's metadata: canonical `tags` in order, `tagLabels` (canonical
     * name → spelling in this Document) and `properties` (front matter
     * `key: value` pairs, unquoted). Null before the index is built or for a
     * Document it does not hold.
     * @param {string} dbKey
     * @param {string} id
     * @returns {{ tags: string[], tagLabels: Record<string,string>, properties: Record<string,string> } | null}
     */
    function entry(dbKey, id) {
        return readyState(dbKey)?.index.entry(id) ?? null;
    }

    /**
     * Every Document of a database with tags or front matter properties, with its metadata
     * (the others have neither). Empty before the index is built. Search's `prop:` parts read
     * it instead of the bodies (advanced-search.md §6.3).
     * @param {string} dbKey
     * @returns {Iterable<[string, { tags: string[], tagLabels: Record<string,string>, properties: Record<string,string> }]>}
     */
    function metadataEntries(dbKey) {
        return readyState(dbKey)?.index.documents() ?? [];
    }

    /**
     * The Documents in a database carrying every one of the tags (AND). Names
     * are canonicalised. Empty before the index is built.
     * @param {string} dbKey
     * @param {string[]} names
     * @returns {Set<string>}
     */
    function idsWithTags(dbKey, names) {
        return readyState(dbKey)?.index.idsWithTags(names) ?? new Set();
    }

    /**
     * @param {string} dbKey
     * @returns {Map<string, number>} canonical tag name → number of Documents
     */
    function tagCounts(dbKey) {
        return readyState(dbKey)?.index.tagCounts() ?? new Map();
    }

    /**
     * The most used spelling of a tag in a database's Documents.
     * @param {string} dbKey
     * @param {string} name canonical name
     * @returns {string|null}
     */
    function tagLabel(dbKey, name) {
        return readyState(dbKey)?.index.tagLabel(name) ?? null;
    }

    /**
     * Front matter keys in a database, grouped case-insensitively (shown in
     * their most used spelling), most used first.
     * @param {string} dbKey
     * @returns {{ key: string, count: number }[]}
     */
    function propertyKeys(dbKey) {
        return readyState(dbKey)?.index.propertyKeys() ?? [];
    }

    /**
     * The values seen for a key (compared case-insensitively), most used first.
     * @param {string} dbKey
     * @param {string} key
     * @returns {{ value: string, count: number }[]}
     */
    function propertyValues(dbKey, key) {
        return readyState(dbKey)?.index.propertyValues(key) ?? [];
    }

    /**
     * Update one Document from its text at once (its row is re-read anyway
     * through the update hook). Ignored until the index is built: the build
     * reads it.
     * @param {string} dbKey
     * @param {string} id
     * @param {string} content
     */
    function noteChanged(dbKey, id, content) {
        const state = readyState(dbKey);
        if (!state || !id) return;
        if (state.index.set(id, content || '')) bump(dbKey);
    }

    /**
     * Forget one Document.
     * @param {string} dbKey
     * @param {string} id
     */
    function noteRemoved(dbKey, id) {
        const state = readyState(dbKey);
        if (!state || !id) return;
        if (forget(state, id)) bump(dbKey);
    }

    /**
     * The after-sync hook: re-read the Documents a committed remote change set
     * touched. The sync store calls it for every database it applied changes
     * to; a database whose index is not built is left alone.
     * @param {string} dbKey
     * @param {object[]} changes `/sync` change rows
     */
    function remoteChangesApplied(dbKey, changes) {
        const state = states.get(dbKey);
        if (!state || state.status === 'idle') return;
        for (const change of changes || []) {
            if (change?.table !== 'notes') continue;
            const id = parsePkId(change.pk);
            if (id) state.dirtyIds.add(id);
        }
        if (state.status === 'ready' && state.dirtyIds.size) scheduleFlush(state);
    }

    /**
     * Forget a database's index (its database was removed or reopened).
     * @param {string} dbKey
     */
    function drop(dbKey) {
        const state = states.get(dbKey);
        if (!state) return;
        clearTimeout(state.timer);
        state.unhook?.();
        states.delete(dbKey);
        delete versions[dbKey];
        version.value += 1;
    }

    /**
     * @param {string} dbKey
     * @returns {number} a counter that changes whenever that database's metadata does
     */
    function versionOf(dbKey) {
        return versions[dbKey] || 0;
    }

    /** For tests: wait for pending re-reads. */
    async function settled() {
        for (const state of states.values()) {
            if (state.build) await state.build.catch(() => {});
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
                await flush(state);
            }
            if (state.flushing) await state.flushing;
        }
    }

    syncStore.onRemoteChangesApplied?.(remoteChangesApplied);

    // A database that left the registry (a space left, removed, deleted or
    // "Remove locally"; sign-out) takes its index with it, and so does a
    // database whose handle was reopened.
    watch(
        () => [...syncStore.databases.entries()].map(([dbKey, entry]) => [dbKey, entry.db]),
        (current) => {
            const live = new Map(current);
            for (const [dbKey, state] of [...states]) {
                if (live.get(dbKey) !== state.db) drop(dbKey);
            }
        },
    );

    return {
        version,
        versionOf,
        ensure,
        isReady,
        entry,
        idsWithTags,
        metadataEntries,
        tagCounts,
        tagLabel,
        propertyKeys,
        propertyValues,
        noteChanged,
        noteRemoved,
        remoteChangesApplied,
        drop,
        settled,
    };
});
