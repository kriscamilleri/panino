/**
 * Upload cursor for local CR-SQLite changes.
 *
 * `/sync` needs two independent positions:
 *
 * - the **pull clock** is the server's `db_version` the client has seen. It is
 *   sent as `since` and lives in the server's version space.
 * - the **push cursor** is the highest *local* `db_version` whose own changes
 *   the server has acknowledged. It lives in this replica's version space.
 *
 * Using the pull clock for both strands writes: when one sync both uploads
 * local changes and finds the server ahead, the returned clock equals the
 * version this replica's next transaction will use, and a `db_version > clock`
 * filter never selects that transaction again.
 */

export const PUSH_CURSOR_KEY = 'crsqlite_push_cursor';

/** Soft cap on changes per `/sync` request; whole versions are never split. */
export const MAX_OUTGOING_CHANGES = 500;

export const LOCAL_DB_VERSION_SQL = 'SELECT crsql_db_version() AS version';

/**
 * Only this replica's own changes are uploaded: every change reaches the server
 * from the replica that made it, so echoing rows received from the server would
 * be redundant. The upper bound excludes rows of a transaction that is still
 * open on this connection, which already carry the next version.
 */
const OWN_CHANGES_WHERE =
  'db_version > ? AND db_version <= ? AND site_id = crsql_site_id()';

export const OUTGOING_VERSIONS_SQL = `SELECT db_version, COUNT(*) AS change_count
FROM crsql_changes
WHERE ${OWN_CHANGES_WHERE}
GROUP BY db_version
ORDER BY db_version ASC`;

export const OUTGOING_CHANGES_SQL = `SELECT "table", pk, cid, val, col_version, db_version, hex(site_id) AS site_id, seq, cl
FROM crsql_changes
WHERE ${OWN_CHANGES_WHERE}
ORDER BY db_version ASC, seq ASC`;

/**
 * Normalize a stored push cursor. A missing or unreadable cursor, or one ahead
 * of the local database (the database was recreated), restarts from zero so
 * every own change is offered to the server again. Re-sending is safe because
 * the server merge is idempotent.
 *
 * @param {string | number | null | undefined} stored
 * @param {number} localDbVersion
 * @returns {number}
 */
export function resolvePushCursor(stored, localDbVersion) {
  const cursor = Number(stored);
  if (stored === null || stored === undefined || stored === '') return 0;
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  if (cursor > localDbVersion) return 0;
  return Math.floor(cursor);
}

/**
 * Choose how far one request uploads. Versions are taken oldest first and kept
 * whole; the first pending version is always included so an oversized
 * transaction cannot stall the queue.
 *
 * @param {Array<{ db_version: number | bigint | string, change_count: number | bigint | string }>} versionCounts
 *   pending own versions in ascending order
 * @param {{ localDbVersion: number, maxChanges?: number }} options
 * @returns {{ upTo: number, hasMore: boolean }} `upTo` is the cursor to store once the request succeeds
 */
export function planOutgoingWindow(versionCounts, { localDbVersion, maxChanges = MAX_OUTGOING_CHANGES }) {
  let total = 0;
  let upTo = null;

  for (const group of versionCounts || []) {
    const count = Number(group.change_count) || 0;
    if (upTo !== null && total + count > maxChanges) {
      return { upTo, hasMore: true };
    }
    total += count;
    upTo = Number(group.db_version);
  }

  // Everything pending fits: advance to the snapshot so versions that hold only
  // remote rows are not re-examined on the next sync.
  return { upTo: localDbVersion, hasMore: false };
}

/**
 * Read the next batch of own changes to upload.
 *
 * @param {{ execO: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> }} database
 * @param {string | number | null | undefined} storedCursor
 * @param {{ maxChanges?: number }} [options]
 * @returns {Promise<{ changes: Array<Record<string, unknown>>, upTo: number, hasMore: boolean }>}
 */
export async function readOutgoingChanges(database, storedCursor, { maxChanges = MAX_OUTGOING_CHANGES } = {}) {
  const versionRows = await database.execO(LOCAL_DB_VERSION_SQL);
  const localDbVersion = Number(versionRows?.[0]?.version) || 0;
  const cursor = resolvePushCursor(storedCursor, localDbVersion);

  const versionCounts = await database.execO(OUTGOING_VERSIONS_SQL, [cursor, localDbVersion]);
  const { upTo, hasMore } = planOutgoingWindow(versionCounts, { localDbVersion, maxChanges });
  const changes = versionCounts?.length
    ? await database.execO(OUTGOING_CHANGES_SQL, [cursor, upTo])
    : [];

  return { changes, upTo, hasMore };
}
