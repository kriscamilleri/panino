/**
 * Upload cursor for local CR-SQLite changes.
 *
 * `/sync` needs two independent positions:
 *
 * - the **pull clock** is the server's `db_version` the client has seen. It is
 *   sent as `since` and lives in the server's version space.
 * - the **push cursor** is how far this replica's own changes have been
 *   acknowledged by the server. It lives in this replica's version space.
 *
 * Using the pull clock for both strands writes: when one sync both uploads
 * local changes and finds the server ahead, the returned clock equals the
 * version this replica's next transaction will use, and a `db_version > clock`
 * filter never selects that transaction again.
 *
 * The cursor is stored as `"<version>"` (every own change up to and including
 * that local version is uploaded) or `"<version>.<seq>"` (that version is being
 * uploaded in slices and is done up to that sequence number). Slicing matters
 * because one transaction is one version: a bulk import of thousands of
 * documents would otherwise be a single request of tens of megabytes that the
 * server parses and merges in one uninterrupted, synchronous step.
 */

export const PUSH_CURSOR_KEY = 'crsqlite_push_cursor';

/** Soft cap on changes per `/sync` request. */
export const MAX_OUTGOING_CHANGES = 500;

export const LOCAL_DB_VERSION_SQL = 'SELECT crsql_db_version() AS version';

const CHANGE_COLUMNS =
  '"table", pk, cid, val, col_version, db_version, hex(site_id) AS site_id, seq, cl';

/**
 * Only this replica's own changes are uploaded: every change reaches the server
 * from the replica that made it, so echoing rows received from the server would
 * be redundant.
 */
const OWN = 'site_id = crsql_site_id()';

/**
 * Pending own versions with their sizes. The upper bound excludes rows of a
 * transaction that is still open on this connection, which already carry the
 * next version. `distinct_seq` confirms a version can be sliced safely.
 */
export const OUTGOING_VERSIONS_SQL = `SELECT db_version, COUNT(*) AS change_count, COUNT(DISTINCT seq) AS distinct_seq
FROM crsql_changes
WHERE db_version > ? AND db_version <= ? AND ${OWN}
GROUP BY db_version
ORDER BY db_version ASC`;

export const OUTGOING_CHANGES_SQL = `SELECT ${CHANGE_COLUMNS}
FROM crsql_changes
WHERE db_version > ? AND db_version <= ? AND ${OWN}
ORDER BY db_version ASC, seq ASC`;

/** The sequence number that ends a slice: reads `seq` only, never the values. */
export const VERSION_SLICE_END_SQL = `SELECT seq
FROM crsql_changes
WHERE db_version = ? AND seq > ? AND ${OWN}
ORDER BY seq ASC
LIMIT 1 OFFSET ?`;

export const VERSION_SLICE_SQL = `SELECT ${CHANGE_COLUMNS}
FROM crsql_changes
WHERE db_version = ? AND seq > ? AND seq <= ? AND ${OWN}
ORDER BY seq ASC`;

export const VERSION_REST_SQL = `SELECT ${CHANGE_COLUMNS}
FROM crsql_changes
WHERE db_version = ? AND seq > ? AND ${OWN}
ORDER BY seq ASC`;

/**
 * Parse a stored push cursor. A missing or unreadable cursor, or one ahead of
 * the local database (the database was recreated), restarts from zero so every
 * own change is offered to the server again. Re-sending is safe because the
 * server merge is idempotent.
 *
 * @param {string | number | null | undefined} stored
 * @param {number} localDbVersion
 * @returns {{ version: number, seq: number | null }} `seq` is null when the version is complete
 */
export function parsePushCursor(stored, localDbVersion) {
  const start = { version: 0, seq: null };
  if (stored === null || stored === undefined || stored === '') return start;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(stored).trim());
  if (!match) return start;

  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version > localDbVersion) return start;
  if (match[2] === undefined) return { version, seq: null };

  const seq = Number(match[2]);
  return Number.isSafeInteger(seq) ? { version, seq } : start;
}

/**
 * @param {{ version: number, seq?: number | null }} cursor
 * @returns {string}
 */
export function formatPushCursor({ version, seq = null }) {
  return seq === null ? String(version) : `${version}.${seq}`;
}

/**
 * Choose how many whole versions one request uploads, oldest first.
 *
 * @param {Array<{ db_version: number | bigint | string, change_count: number | bigint | string }>} versionCounts
 *   pending own versions in ascending order
 * @param {{ localDbVersion: number, maxChanges?: number }} options
 * @returns {{ upTo: number, hasMore: boolean }} `upTo` is the last version included
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
 * Read the next slice of one oversized version.
 *
 * @param {{ execO: Function }} database
 * @param {number} version
 * @param {number} afterSeq last sequence number already uploaded (-1 for none)
 * @param {number} maxChanges
 */
async function readVersionSlice(database, version, afterSeq, maxChanges) {
  const cursor = { version, seq: afterSeq < 0 ? null : afterSeq };
  const end = await database.execO(VERSION_SLICE_END_SQL, [version, afterSeq, maxChanges - 1]);

  if (!end?.length) {
    // Fewer than a full slice remains: this request completes the version.
    const changes = await database.execO(VERSION_REST_SQL, [version, afterSeq]);
    return {
      changes,
      cursor,
      nextCursor: formatPushCursor({ version }),
      startVersion: version - 1,
      uploadedVersion: version,
      // Later versions may be waiting; the next turn checks cheaply.
      hasMore: true,
    };
  }

  const endSeq = Number(end[0].seq);
  const changes = await database.execO(VERSION_SLICE_SQL, [version, afterSeq, endSeq]);
  return {
    changes,
    cursor,
    nextCursor: formatPushCursor({ version, seq: endSeq }),
    startVersion: version - 1,
    uploadedVersion: version - 1,
    hasMore: true,
  };
}

/**
 * Read the next batch of own changes to upload.
 *
 * @param {{ execO: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> }} database
 * @param {string | number | null | undefined} storedCursor
 * @param {{ maxChanges?: number }} [options]
 * @returns {Promise<{
 *   changes: Array<Record<string, unknown>>,
 *   cursor: { version: number, seq: number | null },
 *   nextCursor: string,
 *   startVersion: number,
 *   uploadedVersion: number,
 *   hasMore: boolean,
 * }>}
 *   `nextCursor` is the value to store once the server acknowledges the batch.
 *   `startVersion` is the highest local version that was fully uploaded before
 *   this batch; `uploadedVersion` the highest that is after it.
 */
export async function readOutgoingChanges(database, storedCursor, { maxChanges = MAX_OUTGOING_CHANGES } = {}) {
  const versionRows = await database.execO(LOCAL_DB_VERSION_SQL);
  const localDbVersion = Number(versionRows?.[0]?.version) || 0;
  const cursor = parsePushCursor(storedCursor, localDbVersion);

  if (cursor.seq !== null) {
    return readVersionSlice(database, cursor.version, cursor.seq, maxChanges);
  }

  const versionCounts = await database.execO(OUTGOING_VERSIONS_SQL, [cursor.version, localDbVersion]);
  if (!versionCounts?.length) {
    return {
      changes: [],
      cursor,
      nextCursor: formatPushCursor({ version: localDbVersion }),
      startVersion: cursor.version,
      uploadedVersion: localDbVersion,
      hasMore: false,
    };
  }

  // One transaction larger than a request: upload it in slices by sequence
  // number, provided the sequence numbers identify its rows uniquely.
  const first = versionCounts[0];
  const firstCount = Number(first.change_count) || 0;
  if (firstCount > maxChanges && Number(first.distinct_seq) === firstCount) {
    return readVersionSlice(database, Number(first.db_version), -1, maxChanges);
  }

  const { upTo, hasMore } = planOutgoingWindow(versionCounts, { localDbVersion, maxChanges });
  const changes = await database.execO(OUTGOING_CHANGES_SQL, [cursor.version, upTo]);
  return {
    changes,
    cursor,
    nextCursor: formatPushCursor({ version: upTo }),
    startVersion: cursor.version,
    uploadedVersion: upTo,
    hasMore,
  };
}
