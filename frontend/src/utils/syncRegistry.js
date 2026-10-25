import { createDatabaseKey, parseDatabaseKey } from './databaseKey.js';
import { PUSH_CURSOR_KEY } from './syncCursor.js';

export const LEGACY_CLOCK_KEY = 'crsqlite_clock';

/** @param {string} dbKey */
export function clockStorageKey(dbKey) {
  parseDatabaseKey(dbKey);
  return `crsqlite_clock:${dbKey}`;
}

/**
 * Move the pre-registry personal clock once. Removing the source key makes the
 * operation idempotent without a second, independently corruptible marker.
 *
 * @param {Storage|{getItem:Function,setItem:Function,removeItem:Function}} storage
 * @param {string} personalDbKey
 * @returns {number}
 */
export function migrateLegacyPersonalClock(storage, personalDbKey) {
  const targetKey = clockStorageKey(personalDbKey);
  const target = storage.getItem(targetKey);
  const legacy = storage.getItem(LEGACY_CLOCK_KEY);
  if (target === null && legacy !== null) {
    storage.setItem(targetKey, String(Number(legacy) || 0));
  }
  if (legacy !== null) storage.removeItem(LEGACY_CLOCK_KEY);
  return Number(storage.getItem(targetKey) || 0);
}

/** @param {string} dbKey */
export function pushCursorStorageKey(dbKey) {
  parseDatabaseKey(dbKey);
  return `${PUSH_CURSOR_KEY}:${dbKey}`;
}

/**
 * Move the unkeyed personal push cursor (written by builds that predate the
 * database registry) to its per-database key. Same idempotence rule as the
 * clock: the source key is removed, so no separate marker can go stale.
 *
 * @param {Storage|{getItem:Function,setItem:Function,removeItem:Function}} storage
 * @param {string} personalDbKey
 */
export function migrateLegacyPersonalPushCursor(storage, personalDbKey) {
  const targetKey = pushCursorStorageKey(personalDbKey);
  const legacy = storage.getItem(PUSH_CURSOR_KEY);
  if (legacy === null) return;
  if (storage.getItem(targetKey) === null) storage.setItem(targetKey, legacy);
  storage.removeItem(PUSH_CURSOR_KEY);
}

/**
 * Delay before the next WebSocket reconnect attempt: 1s, 2s, 4s … capped at
 * 30s. A fixed one-second retry hammers the server for as long as it keeps
 * refusing the connection.
 *
 * @param {number} attempt number of consecutive failed attempts so far
 * @returns {number} milliseconds
 */
export function reconnectDelayMs(attempt) {
  const exponent = Math.min(Math.max(Number(attempt) || 0, 0), 5);
  return Math.min(1000 * 2 ** exponent, 30000);
}

/**
 * Run database work serially and retain one result per item. Rejections are
 * captured so a failed database cannot prevent a later one from running.
 *
 * @template T,R
 * @param {T[]} items
 * @param {(item:T, index:number) => Promise<R>} worker
 * @returns {Promise<Array<{ item:T, status:'fulfilled', value:R }|{ item:T, status:'rejected', reason:unknown }>>}
 */
export async function runSequentially(items, worker) {
  const results = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    try {
      results.push({ item, status: 'fulfilled', value: await worker(item, index) });
    } catch (reason) {
      results.push({ item, status: 'rejected', reason });
    }
  }
  return results;
}

/**
 * Return active keys plus revoked keys when a membership snapshot changes.
 *
 * @param {Iterable<string>} registeredKeys
 * @param {string} personalDbKey
 * @param {Array<{spaceId:string}>} spaces
 */
export function reconcileMembershipKeys(registeredKeys, personalDbKey, spaces) {
  parseDatabaseKey(personalDbKey);
  const desired = new Set([personalDbKey]);
  for (const space of spaces || []) {
    desired.add(createDatabaseKey('space', space.spaceId));
  }
  const revoked = [...registeredKeys].filter(
    (dbKey) => dbKey !== personalDbKey && !desired.has(dbKey),
  );
  return { desired, revoked };
}

const SPACE_OUTGOING_COLUMNS = new Map([
  ['folders', new Set(['id', 'name', 'parent_id', 'created_at'])],
  ['notes', new Set(['id', 'folder_id', 'title', 'content', 'pinned', 'created_at', 'updated_at'])],
  ['globals', new Set(['key', 'id', 'value', 'created_at', 'updated_at', 'display_key'])],
  ['templates', new Set(['id', 'name', 'content', 'title_pattern', 'default_folder_id', 'created_at', 'updated_at'])],
  ['style_presets', new Set(['id', 'kind', 'name', 'styles', 'created_at', 'updated_at'])],
  ['style_assignments', new Set(['id', 'target_type', 'target_id', 'kind', 'preset_id', 'updated_at'])],
]);

/**
 * Project shared-space deltas onto the public replicated schema. This mirrors
 * the server's fail-closed allowlist: server-authored profiles and images must
 * never echo back, while legacy personal-only user_id columns are discarded.
 * Tombstones retain their empty/-1 cid for each allowed table.
 *
 * @param {Array<{table?:string,cid?:string}>} changes
 */
export function projectSpaceOutgoingChanges(changes) {
  return (changes || []).filter((change) => {
    const columns = SPACE_OUTGOING_COLUMNS.get(change?.table);
    if (!columns) return false;
    return change.cid == null || change.cid === '' || String(change.cid) === '-1' ||
      columns.has(String(change.cid));
  });
}

/**
 * Merge database-tagged dashboard results, sort globally, then apply the
 * requested limit. No per-database limiting is performed here.
 *
 * @param {Array<{dbKey:string,name?:string,rows:Array<object>}>} groups
 * @param {{limit?:number, dateField?:string}} [options]
 */
export function mergeDashboardRows(groups, { limit = 50, dateField = 'updated_at' } = {}) {
  const merged = [];
  for (const group of groups || []) {
    parseDatabaseKey(group.dbKey);
    for (const row of group.rows || []) {
      merged.push({ ...row, dbKey: group.dbKey, spaceName: group.name || null });
    }
  }
  merged.sort((a, b) => {
    const byDate = new Date(b[dateField] || 0).getTime() - new Date(a[dateField] || 0).getTime();
    if (byDate !== 0) return byDate;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return merged.slice(0, Math.max(0, limit));
}

/** @param {unknown} error */
export function isStorageQuotaError(error) {
  return error instanceof DOMException
    ? error.name === 'QuotaExceededError'
    : error?.name === 'QuotaExceededError' || error?.code === 22;
}
