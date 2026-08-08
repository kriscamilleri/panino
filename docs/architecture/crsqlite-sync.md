# CR-SQLite Sync — How It Works

## Mental model

Panino is local-first. Each client owns a complete SQLite database in the browser and the
backend keeps one CR-SQLite database per user as a merge point, not as an application-level
source of truth. Changes flow as rows through the `crsql_changes` virtual table. The
frontend sends local changes and a clock position; the backend merges incoming rows and
returns rows newer than that position.

The frontend implementation is in `frontend/src/store/syncStore.js`; the backend endpoint is
`backend/api-service/sync.js`.

## Vocabulary

- **`site_id`** — the 16-byte identity of one CR-SQLite database replica. The frontend keeps
  its hexadecimal form in `localStorage` as `crsqlite_site_id`.
- **`db_version`** — the database-wide causal clock. The `/sync` request's `since` value is
  the last clock the client has observed.
- **`col_version`** — the version of one column value for one primary key.
- **`cl`** — causal length. A positive value on a `cid = '-1'` row represents a delete
  tombstone; ordinary column updates use a column name and normally have `cl = 0`.
- **`cid`** — the changed column name. `'-1'` is the deletion sentinel.
- **`seq`** — the sequence number associated with a change batch.

The wire representation is deliberately tolerant because clients may send packed primary-key
objects, JSON primary-key arrays, buffers, hex, or UUID strings. `sync.js` normalizes these
values before binding them to SQLite.

## Table anatomy

For a CRR table such as `images`, CR-SQLite maintains:

1. The application base table (`images`).
2. A primary-key map (`images__crsql_pks`).
3. A clock table (`images__crsql_clock`) with one row per key/column version.
4. Generated insert, update, and delete triggers.

The delete trigger observed in the production database is guarded by:

```sql
WHEN crsql_internal_sync_bit() = 0
```

That guard prevents a merge from recording a second local change while CR-SQLite is applying
remote data. The guard is correct; the connection lifetime around it is the important part.

## Deletes and tombstones

A healthy delete removes the base row and leaves a clock row with `col_name = '-1'` (the
delete sentinel). A clock row with ordinary column entries, no base row, and no sentinel is
the corruption shape that causes the later merge failure.

CR-SQLite's local-clock lookup treats any remaining clock row as evidence that the row exists
when no sentinel is present. The merge then enters `did_cid_win`, looks for a base row, and
raises `could not find row to merge with`. The repair helper detects exactly this shape without
touching healthy rows or normal tombstones.

## The sync bit

`crsql_internal_sync_bit()` suppresses base-table triggers while a merge is applying. It is
not reset by SQLite transaction rollback in the failure mode reproduced in the 2026 incident.
The backend caches per-user connections in `db.js`, so a failed merge can leave a poisoned
handle available to the next request.

Current safeguards are:

- `sync.js` invalidates the cached connection when a merge fails.
- `getHealthyUserDb()` checks the sync bit and reopens an unhealthy handle before maintenance
  work.
- The note-revision foreign key uses `ON DELETE CASCADE`, with deferred foreign keys as a
  safety net during a merge.
- The orphan-image repair is explicit, backup-gated, and dry-run capable.

Background jobs must not perform CRR writes through a handle that has not passed a health
check. A fresh connection must report a zero sync bit before ordinary deletes or pruning.

## Failure modes seen in production

| Symptom | Root cause | Current mitigation | Evidence |
|---|---|---|---|
| `constraint failed` on note delete | `note_revisions` children outlived a deleted CRR parent because the FK lacked cascade behavior | Cascade FK migration plus deferred FK checks | 2026-06-29 incident log |
| `could not find row to merge with for tbl images` | A failed merge left the cached connection's sync bit set; the next image prune suppressed its delete trigger and created an orphan clock | Connection invalidation, health checks, fail-closed merge handling, and orphan repair | 2026-07-06 and 2026-07-11 logs |

## Rules when changing sync or schema

- Any local table with an FK to a CRR parent must use `ON DELETE CASCADE`.
- Schema changes belong in both `syncStore.js` (`DB_SCHEMA`) and `db.js` (`BASE_SCHEMA`).
- New CRR tables must also be added to `CRR_TABLES` in `db.js`.
- NOT NULL CRR columns need defaults for CR-SQLite compatibility.
- Never mutate a CRR base table from a connection that may have a poisoned sync bit.
- Background jobs must validate connection health before CRR writes.
- Do not return success for a batch whose merge was not durably applied; preserve the request's
  failure semantics and invalidate the connection.

## Diagnosing a live incident

Follow [the sync incident runbook](../runbooks/sync-incident-response.md). It covers backup,
dry-run inspection, repair, and post-repair sentinel checks.

## Provenance

- `docs/agent-logs/2026/06/2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md`
- `docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md`
- `docs/agent-logs/2026/07/2026-07-11_12-00_review-latest-sync-fix.md`
- `docs/agent-logs/2026/07/2026-07-11_00-00_sync-connection-recovery.md`
