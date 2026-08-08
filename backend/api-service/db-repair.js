// backend/api-service/db-repair.js
//
// Repair strategies for CR-SQLite per-user databases that have drifted into
// a state where `crsql_merge` raises
//   "could not find row to merge with for tbl <name>"
// because clock-table entries exist for a primary key whose base row is
// already gone but the deletion sentinel (`col_name='-1'`) was never
// written. See `docs/agent-logs/2026-07-06_17-00_fix-sync-could-not-find-row.md`
// for the long-form diagnosis of the production incident that motivated this.
//
// The functions here operate directly on the user-SQLite Database handle
// (already loaded with the crsqlite extension, schema, and CRR). They do
// NOT mutate the base `images` table — only the `images__crsql_clock`
// internal clock table — so they are safe to run while sync is offline.

/**
 * Detect non-sentinel `images__crsql_clock` rows whose mapped base `images`
 * row is missing (and where no deletion sentinel exists for that key).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{key:number, pk_id:string|null, col_name:string, col_version:number, db_version:number, site_id_hex:string}>}
 *   Orphan clock rows. Empty array if the schema is missing or no orphans.
 */
export function findOrphanImagesClockRows(db) {
  const hasClock = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='images__crsql_clock'",
    )
    .get();
  const hasPks = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='images__crsql_pks'",
    )
    .get();
  if (!hasClock || !hasPks) return [];

  // A non-sentinel clock row whose base row is missing AND whose key has
  // no deletion sentinel is precisely the corruption that routes the next
  // merge into `did_cid_win` and emits "could not find row to merge with".
  return db
    .prepare(
      `SELECT k.key,
              p.id AS pk_id,
              k.col_name,
              k.col_version,
              k.db_version,
              hex(k.site_id) AS site_id_hex
         FROM images__crsql_clock k
         LEFT JOIN images__crsql_pks p ON p.__crsql_key = k.key
        WHERE k.col_name IS NOT '-1'
          AND (p.id IS NULL OR NOT EXISTS (SELECT 1 FROM images b WHERE b.id = p.id))
          AND NOT EXISTS (
            SELECT 1 FROM images__crsql_clock s
             WHERE s.key = k.key AND s.col_name = '-1'
          )`,
    )
    .all();
}

/**
 * Remove the orphan non-sentinel images clock rows detected by
 * {@link findOrphanImagesClockRows}. Sentinels (col_name='-1') are left in
 * place because they are normal CR-SQLite deletion tombstones.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} [opts]
 * @param {boolean} [opts.apply=true] When false, performs only a dry-run
 *   (no DELETE) and returns the same report that the apply run would.
 * @returns {{removed:number, orphans:Array, applied:boolean}}
 */
export function repairOrphanImagesClocks(db, opts = {}) {
  const { apply = true } = opts;
  const orphans = findOrphanImagesClockRows(db);
  if (!orphans.length) {
    return { removed: 0, orphans, applied: false };
  }

  if (!apply) {
    return { removed: 0, orphans, applied: false };
  }

  // Delete the orphan non-sentinel rows inside a single transaction. We
  // delete by re-querying the corruption condition so a concurrent sync
  // batch that may have inserted a row mid-repair does not accidentally
  // remove the new non-sentinel clock rows that legitimately belong to
  // that freshly inserted row.
  const stmt = db.prepare(
    `DELETE FROM images__crsql_clock
      WHERE col_name IS NOT '-1'
        AND key IN (
          SELECT k.key
            FROM images__crsql_clock k
            LEFT JOIN images__crsql_pks p ON p.__crsql_key = k.key
           WHERE NOT EXISTS (SELECT 1 FROM images b WHERE b.id = p.id)
             AND NOT EXISTS (
               SELECT 1 FROM images__crsql_clock s
                WHERE s.key = k.key AND s.col_name = '-1'
             )
             AND k.col_name IS NOT '-1'
        )`,
  );
  const tx = db.transaction(() => stmt.run());
  const info = tx();
  const removed = Number(info?.changes || 0);
  return { removed, orphans, applied: true };
}
