# Investigate sync 500 error on production

**Agent:** GLM-5.2 (Zed agent)
**Started:** 2026-06-29 07:35 (server time)
**Status:** completed

## Objective
Identify why production sync (`POST /api/sync`) returns HTTP 500 (silent sync failure for the user). Investigate only — no code/data changes.

## Progress
- [x] SSH into prod server (`<PROD_IP>`) and inspect the `panino-api-service-1` container logs.
- [x] Identify the error: `SqliteError: constraint failed` at `sync.js:236` (`insertStmt.run(...)`), inside the `applyChanges` transaction.
- [x] Read-only DB inspection of the affected user DB (`user-A.db`): `PRAGMA integrity_check = ok`, schema correct, CRR tables present, extension loads and `crsql_changes` readable (3381 changes). DB is healthy.
- [x] Read crsqlite C/Rust source (`changes-vtab.c`, `changes_vtab.rs`, `changes_vtab_write.rs`, `tableinfo.rs`) to understand the `crsql_changes` INSERT path and what constraints fire.
- [x] Confirm the running server's deployed `/app/sync.js` matches the local `backend/api-service/sync.js` (line 236 = `insertStmt.run`, line 264 = `applyChanges(...)`).
- [x] Note: `CRSQLITE_EXT_PATH` env var points to a non-existent file (`.../build/Release/crsqlite.node`), but `resolveCrsqlitePath()` correctly falls back to `/app/node_modules/@vlcn.io/crsqlite/dist/crsqlite.so`. Not the cause, but a stale env var worth fixing later.
- [x] Capture a live `/sync` request via non-invasive `tcpdump` on port 8000 (nginx terminates TLS; backend port 8000 is plaintext). User triggered a manual sync.
- [x] Parse the captured request, replay the 3376 changes **against a throwaway copy** of the user DB, and identify the exact failing change.
- [x] Verify the root cause against the code.
- [x] Clean up all diagnostic artifacts (server /tmp, container /app & /tmp, local .tmp_* files). No production data was modified.

## Root cause (verified)

The failing change is a **note deletion change** (`notes` table, `cid = "-1"` delete sentinel, `cl = 2`). Specifically, the client sends a delete-tombstone for note `note-A` ("Daily 2026-06-29"), which has **1 row in `note_revisions`** referencing it.

The error is **`SQLITE_CONSTRAINT_FOREIGNKEY`** ("constraint failed") — a foreign-key violation, not a NOT NULL issue.

Why it fires, traced through the code:

1. `backend/api-service/sync.js` `applyChanges` transaction has **two loops**:
   - **Loop 1 (lines 207-237):** inserts every incoming change into `crsql_changes`. When crsqlite processes the `notes` delete-tombstone, its `merge_delete` runs `DELETE FROM notes WHERE id = ?` against the base table.
   - **Loop 2 (lines 239-263):** only **after** all inserts, calls `deleteNoteRevisionsForDeletedNote(db, mutation.noteId)` to remove child `note_revisions` rows.
2. The `note_revisions` table declares `FOREIGN KEY (note_id) REFERENCES notes(id)` (`backend/api-service/db.js` line 94), and `PRAGMA foreign_keys = ON` is set in `BASE_SCHEMA` (line 18).
3. So at the moment crsqlite deletes the note row (Loop 1), the child `note_revisions` row still exists → the FK constraint fires → `SQLITE_CONSTRAINT_FOREIGNKEY` → the entire transaction rolls back → HTTP 500.
4. The cleanup in Loop 2 never executes (it's after the failing inserts).

Because the whole transaction rolls back, the client's clock never advances, so it retries the same delete change on every sync → silent, permanent sync failure for that user. (Also seen with the full 3376-change re-send because the client's stored `since` clock is `0`.)

### Key evidence
- Replay of captured request `/tmp/sync_req_12.json` (3376 changes) against a DB copy:
  - `applyCount=3373, failedAt=3373`
  - failing change: `{ table:"notes", cid:"-1", cl:2, db_version:44572, site_id:"<SITE_ID>", pk → note-A }`
  - error code: `SQLITE_CONSTRAINT_FOREIGNKEY`
- That note's `note_revisions` count on the DB copy: `1` (auto revision from 2026-06-29T07:13:07).
- `PRAGMA foreign_keys = { foreign_keys: 1 }`.

### Why it started now
The revision-history feature creates `note_revisions` snapshots. Deleting a note that has revisions (and with FK enforcement on) triggers the violation. This is the first time the user deleted a note that had a revision snapshot, so the latent ordering bug became visible.

## Files of interest (no changes made)
- `backend/api-service/sync.js` — `applyChanges` transaction (Loop 1 inserts incl. deletes; Loop 2 cleans up revisions). The ordering is the bug.
- `backend/api-service/revision.js` — `deleteNoteRevisionsForDeletedNote(db, noteId)` (line 153) deletes child rows but is called too late. Also `cleanupOrphanRevisionRows` (line 159) exists as a separate safety net (`DELETE FROM note_revisions WHERE note_id NOT IN (SELECT id FROM notes)`).
- `backend/api-service/db.js` — `note_revisions` FK definition (line 94) and `PRAGMA foreign_keys = ON` (line 18).

## Secondary issue noted (not the cause, but amplifies it)
- Frontend `frontend/src/store/syncStore.js` `sync()`: the client's stored clock (`localStorage.crsqlite_clock`) was `0`, so it re-sends its entire change set every sync. The clock is set from the server's `max(db_version)` and reused as the `since` param *and* to filter local `db_version > myClock` — these are different clock spaces, which is fragile and contributed to the 3376-change re-send.
- `CRSQLITE_EXT_PATH` env var in the container points to a non-existent path (`.../build/Release/crsqlite.node`); `resolveCrsqlitePath()` falls back to `dist/crsqlite.so` so the server works, but the var is stale.

## Tests / validation performed
- Read-only DB inspection (no writes to the production DB).
- Packet capture of a live `/sync` request (`tcpdump` on port 8000, plaintext behind nginx).
- Replay of the captured 3376-change request against a **copy** of the user DB (`/tmp/replay.db`) — reproduced the exact `SQLITE_CONSTRAINT_FOREIGNKEY` at change #3373.
- Decoded the failing change's pk and confirmed the target note has `note_revisions` rows and `foreign_keys = ON`.

## Open items / proposed fix direction (NOT applied per instructions)
The fix should ensure child `note_revisions` (and `note_revision_meta`) rows for a note are deleted **before** the `crsql_changes` insert that triggers the note row deletion. Options to evaluate:
1. In `applyChanges`, pre-compute note deletes from the incoming changes and call `deleteNoteRevisionsForDeletedNote` for each **before Loop 1** (inside the same transaction).
2. Add `ON DELETE CASCADE` to the `note_revisions.note_id` FK (requires migration; simplest long-term).
3. Use `PRAGMA defer_foreign_keys = ON` within the transaction so FK checks are deferred to commit (deferred in-txn, allows the current ordering to work).
4. Make the FK `DEFERRABLE INITIALLY DEFERRED` (schema change).

Any fix should be validated with a test that deletes a note which has `note_revisions` and confirms sync succeeds.

## Cleanup
All temporary diagnostic files removed from: the container (`/app/inspect_sync.js`, `/app/replay_sync.js`, `/tmp/sync_req_*.json`, `/tmp/replay.db*`, `/tmp/parse_sync.py`, etc.), the host `/tmp`, and the local repo `docs/agent-logs/.tmp_*`. The production DB was never written to.
