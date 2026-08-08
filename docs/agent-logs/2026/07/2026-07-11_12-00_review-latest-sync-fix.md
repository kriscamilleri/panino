# Review latest sync fix

**Agent:** GPT-5.6 Luna
**Started:** 2026-07-11 12:00
**Status:** completed

## Objective
Review the most recent changes from the other agent and determine whether they address the root issue.

## Progress
- [x] Inspect repository status, recent history, and project rules
- [x] Inspect the latest implementation and related investigation logs
- [x] Run focused tests and assess root-cause coverage
- [x] Record findings and final review

## Changes Made
- Review only; no production code changed.
- `backend/api-service/db.js` — reviewed the `ON DELETE CASCADE` schema change and legacy-table migration.
- `backend/api-service/sync.js` — reviewed the FK deferral, per-change merge-error skip, and clock response behavior.

## Tests
- Ran `npm --prefix backend/api-service test`; execution was blocked by the installed `better-sqlite3` binary being built for Node ABI 115 while the runtime is Node ABI 137. Non-database unit tests passed; database-backed tests could not run.
- The first attempted command included unsupported Vitest option `--runInBand` and was rerun without it.

## Open Items / Notes
- The note-delete FK incident is addressed structurally with `ON DELETE CASCADE`, although migration errors are swallowed.
- The orphan image-clock incident is only mitigated: bad changes are skipped and a manual repair script exists, but the corruption source is not fixed and skipped changes can be lost when later changes advance the server clock.
- The working tree contains uncommitted backend sync/database changes plus investigation artifacts.

## Follow-up: pre-repair backup copied

The production backup directory was verified to contain the affected user database and matching WAL/SHM files. All three were copied read-only via SCP to:

`/tmp/panino-sync-clock-repair-20260708T064506Z/`

The local SHA-256 hashes match the remote files. The copy is mode `600` because it contains user data.

Read-only inspection of the local copy confirmed:
- `PRAGMA integrity_check` is `ok`.
- 170 live image rows, 1111 image clock rows, and 7 non-sentinel orphan clock rows remain in the pre-repair copy.
- All 7 orphan rows belong to CR-SQLite key `216`, image `image-A`, with `db_version=44198` and `site_id=0`.
- The images CRR delete/insert/update triggers are present.
- The SQLite CLI copy does not expose the `crsql_changes` virtual table without loading the CR-SQLite extension; further history analysis needs the matching extension/runtime.

## Follow-up: root-cause diagnosis from preserved copy

Loaded the matching local `crsqlite.so` into the system SQLite CLI and inspected the virtual changes table. Findings:
- The orphan key has seven ordinary column clock entries at `db_version=44198`, `col_version=1`, `cl=1`; there is no `cid='-1'` delete record for that key.
- `crsql_changes` exposes the same seven initial image-column changes for the key, but no deletion change. The values are now NULL because the base row is absent.
- The backup still has the normal `images__crsql_dtrig` (`AFTER DELETE ... WHEN crsql_internal_sync_bit() = 0`) trigger.
- A clean reproduction with the same CR-SQLite extension shows a normal direct `DELETE FROM images` creates a `col_name='-1'`, `cl=2` tombstone. Therefore the observed state cannot be produced by a normal current direct delete with the trigger enabled and the sync bit clear.

Assessment: the root cause is narrowed with high confidence to a historical deletion that bypassed or suppressed the CR-SQLite delete trigger—most likely a table lifecycle/migration/version issue, an administrative/direct mutation while `crsql_internal_sync_bit()` was set, or an older CR-SQLite defect. The exact caller/time cannot be proven from the database because CR-SQLite db_versions do not contain wall-clock timestamps and the delete record is absent.

## Follow-up: implementation spec

Created `docs/specs/sync-crsqlite-connection-state-recovery.md`, covering the confirmed root cause, connection invalidation, fail-closed sync behavior, background-job health checks, tests, observability, rollout, and acceptance criteria.

## Follow-up: production logs and reproduction identified the cause

Production Docker logs were inspected read-only with timestamps. The relevant sequence is:
- 2026-06-29 07:16–07:55: repeated `/sync` requests fail with `constraint failed`; prior investigation identified this as a note-delete FK failure while `note_revisions` children still existed.
- 2026-06-30 21:18:55: the daily image orphan prune logs `Deleted 1 images` (the only nonzero prune in the interval).
- 2026-07-01 13:42:21: the first `could not find row to merge with for tbl images` appears, followed by repeated failures.

Using the matching CR-SQLite extension, I reproduced the exact state transition: after a failed CR-SQLite merge caused by the note-revision FK, `crsql_internal_sync_bit()` remains `1` after rollback. A subsequent ordinary `DELETE FROM images` on the same connection deletes the base row but the image `AFTER DELETE` trigger is skipped because it has `WHEN crsql_internal_sync_bit() = 0`; no `-1` sentinel is written. The reproduction then leaves ordinary image clock rows with no base row and produces the same later merge failure.

Conclusion: the root cause is identified. The failed note-delete sync left CR-SQLite's internal sync bit set on the cached per-user database connection. The next day's orphan-image prune used that same cached connection and deleted one image while the delete trigger was suppressed, creating the orphan image clock. The later client sync encountered that orphan and raised `could not find row to merge with`. This is a CR-SQLite cleanup/state-leak bug exposed by the backend's FK ordering failure, not an independent image-delete or table-migration problem.
