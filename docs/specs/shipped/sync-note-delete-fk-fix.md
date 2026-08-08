# Sync 500 on Note Delete (FK Violation) – Fix Spec

> Status: shipped
> Created: 2026-06-29
> Last updated: 2026-08-08
> Shipped: 2026-07-11 (see `docs/agent-logs/2026/07/2026-07-11_12-00_review-latest-sync-fix.md`)
> Implementation: `backend/api-service/db.js`, `backend/api-service/sync.js`, `backend/api-service/tests/integration/sync.revision.test.js`

## Summary
Production `/api/sync` returns HTTP 500 with `SqliteError: constraint failed`
(`SQLITE_CONSTRAINT_FOREIGNKEY`) whenever a client pushes a **note deletion**
for a note that has rows in `note_revisions`. The whole sync transaction rolls
back, the client's clock never advances, and it retries the same delete forever
(silent, permanent sync failure).

Root cause: `note_revisions.note_id` has a non-deferred
`FOREIGN KEY ... REFERENCES notes(id)` with no `ON DELETE` clause, and
`PRAGMA foreign_keys = ON`. In `sync.js`'s `applyChanges` transaction, the note
row is deleted by crsqlite's `merge_delete` **during** the `crsql_changes`
inserts (Loop 1), while the child `note_revisions` rows are only cleaned up
**afterwards** (Loop 2, `deleteNoteRevisionsForDeletedNote`). The child rows
still exist at delete time → FK violation → rollback.

Verified on prod by capturing a live `/sync` request and replaying its 3376
changes against a copy of the user DB: the failure occurs exactly at the
note-delete change for note `597257ca-…` which had 1 `note_revisions` row.

## Goals
- Make note deletion during sync never fail due to `note_revisions` FK
  enforcement, regardless of code-path ordering.
- Enforce the "revisions are owned by the note" invariant **in the schema**
  rather than relying on application-code cleanup ordering.
- Prevent this class of bug (local child table with a non-cascade FK to a CRR
  parent) from recurring for any future table.
- Add a regression test that deletes a note-with-revisions via the sync path.

## Non-Goals
- No changes to the CR-SQLite sync protocol or thefrontend sync flow in this
  spec (the frontend clock issue that amplifies the failure is tracked
  separately under "Related / Out of Scope").
- No change to revision snapshot retention policy or pruning logic.
- `note_revision_meta` remains a separate table (no FK to `notes`); its cleanup
  stays application-managed.

## Proposed Change

### 1. Make `note_revisions.note_id` cascade on delete (primary fix)
Change the FK to `FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE`.
Then whenever crsqlite's `merge_delete` runs `DELETE FROM notes WHERE id = ?`
during a sync, SQLite automatically removes the child `note_revisions` rows
*before* the FK check — so no ordering assumption is needed.

Because `note_revisions` is **backend-only** (not a CRR, not synced, not present
in the frontend `DB_SCHEMA`), the cascade deletes generate no `crsql_changes`
and have no sync side effects — they merely clean up local backend snapshots,
which is exactly the existing intent of `deleteNoteRevisionsForDeletedNote`.

### 2. Defense-in-depth: defer FKs within the sync apply transaction (recommended)
Inside `applyChanges`, wrap the work with `PRAGMA defer_foreign_keys = ON` for
the transaction. This defers all FK checks to `COMMIT`, so any future local
child table whose cleanup is ordered after a parent delete will not hard-fail
mid-transaction (it will either be cleaned up before commit, or surface at
commit rather than aborting a partial batch). This is a safety net — the
cascade in (1) is the structural fix.

### 3. Keep `deleteNoteRevisionsForDeletedNote` for `note_revision_meta`
With cascade, the `DELETE FROM note_revisions WHERE note_id = ?` line inside
`deleteNoteRevisionsForDeletedNote` becomes redundant (harmless/idempotent) but
the `DELETE FROM note_revision_meta WHERE note_id = ?` line is still required
(that table has no FK). Leave the function in place; optionally simplify it to
only touch `note_revision_meta` in a follow-up.

## Implementation Steps

### `backend/api-service/db.js`
1. In `BASE_SCHEMA`, update the `note_revisions` FK:
   ```sql
   FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
   ```
   (Indexes `idx_note_revisions_note_created` and
   `idx_note_revisions_note_type_created` stay as-is.)
2. Add a migration function `ensureNoteRevisionsSchema(db)` following the
   existing `ensureTemplatesSchema` pattern (rename → recreate with cascade →
   copy → recreate indexes → drop old):
   ```js
   function ensureNoteRevisionsSchema(db) {
     try {
       const cols = db.prepare("PRAGMA table_info('note_revisions')").all();
       if (!cols || cols.length === 0) return; // BASE_SCHEMA creates it correctly
       // Detect old FK (no ON DELETE CASCADE). SQLite doesn't expose FK actions
       // via PRAGMA table_info; use PRAGMA foreign_key_list.
       const fks = db.prepare("PRAGMA foreign_key_list('note_revisions')").all();
       const needsMigration = fks.some(
         (f) => f.table === 'notes' && (f.on_delete || 'NO ACTION') === 'NO ACTION'
       );
       if (!needsMigration) return;
       db.exec(`
         PRAGMA foreign_keys = OFF;
         ALTER TABLE note_revisions RENAME TO note_revisions_old;
         CREATE TABLE note_revisions (
           id TEXT PRIMARY KEY NOT NULL,
           note_id TEXT NOT NULL,
           title TEXT,
           content_gzip BLOB NOT NULL,
           type TEXT NOT NULL DEFAULT 'auto',
           content_sha256 TEXT NOT NULL,
           uncompressed_bytes INTEGER NOT NULL,
           compressed_bytes INTEGER NOT NULL,
           created_at TEXT NOT NULL,
           FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
         );
         INSERT INTO note_revisions SELECT * FROM note_revisions_old;
         CREATE INDEX IF NOT EXISTS idx_note_revisions_note_created
           ON note_revisions(note_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_note_revisions_note_type_created
           ON note_revisions(note_id, type, created_at DESC);
         DROP TABLE note_revisions_old;
         PRAGMA foreign_keys = ON;
       `);
     } catch (err) {
       console.error("[db] Failed to ensure note_revisions schema:", err);
     }
   }
   ```
3. Call `ensureNoteRevisionsSchema(db)` in `getUserDb` (and `getTestDb`)
   **before** `ensureCrr(db)`, alongside the other `ensure*Schema` calls.
4. Document the schema rule in `AGENTS.md` (see "Prevention" below).

> Note: toggling `PRAGMA foreign_keys` off/on inside the migration is the
> standard SQLite pattern for FK schema changes; better-sqlite3 executes it
> synchronously within the `db.exec` block.

### `backend/api-service/sync.js`
5. In `applyChanges`, enable deferred FKs for the transaction. Concretely,
   right after entering the transaction (before Loop 1) run:
   ```js
   db.prepare("PRAGMA defer_foreign_keys = ON").run();
   ```
   Leave the existing two-loop structure and the
   `deleteNoteRevisionsForDeletedNote` call as-is (they remain correct and
   still clean up `note_revision_meta`).

### Tests — `backend/api-service/tests/`
6. Add a test (unit/integration) using `tests/testHelpers.js` that:
   - Creates a user DB, inserts a note, and inserts ≥1 `note_revisions` row
     for it (via `createRevisionSnapshot` or a direct insert).
   - Builds a synthetic sync payload containing a **delete-tombstone** change
     for that note (`table: 'notes'`, `cid: '-1'`, `cl: 2`,
     `val: null`, packed pk, a valid `site_id`).
   - POSTs it to `/sync` (or calls the route handler directly).
   - Asserts: HTTP 200 (no 500), `notes` row is gone, `note_revisions` rows
     for that note are gone, `note_revision_meta` row is gone.
7. Add a second test asserting a **non-delete** notes sync (update only)
     still succeeds and creates no stray revision cleanup.
8. Run the full suite (`npm test` in `backend/api-service`) and confirm green.

## Migration / Rollout
- The fix is backward-compatible: `ensureNoteRevisionsSchema` runs on the next
  `getUserDb` for each user DB and is idempotent (no-op once the cascade FK
  is present).
- No data loss: existing `note_revisions` rows are copied verbatim.
- Deploy as usual (`deploy.sh` rebuilds the `api-service` container). On
  startup each user DB is migrated lazily on first `getUserDb` call. The
  currently-stuck user (`cc5595bc-…`) will succeed on their next sync once
  their DB is migrated.
- No frontend change or rebuild required (backend-only fix).

## Prevention (schema rule)
Add to `backend/api-service/AGENTS.md` and `AGENTS.md` §5 (Database & Sync):

> **Rule:** Any *local* (non-CRR) table that declares a `FOREIGN KEY` to a
> CRR parent table **must** specify `ON DELETE CASCADE` (or `ON DELETE SET
> NULL` for nullable refs). Never rely on application-code cleanup ordering,
> because crsqlite's `merge_delete`/`merge_insert` can delete or rewrite parent
> rows at arbitrary points during `crsql_changes` inserts inside a single sync
> transaction. Application cleanup of orphaned local rows (e.g.
> `note_revision_meta`) is still fine and should remain, but must not be a
> prerequisite for FK validity at parent-delete time.

## Validation Checklist
- [ ] `note_revisions` FK has `ON DELETE CASCADE` in `BASE_SCHEMA`.
- [ ] `ensureNoteRevisionsSchema` migrates an old DB (no-op when already
      migrated).
- [ ] `PRAGMA defer_foreign_keys = ON` runs inside `applyChanges`.
- [ ] New test: sync-deletes a note with revisions → 200, child rows cleaned.
- [ ] `npm test` in `backend/api-service` passes.
- [ ] After deploy, prod logs show no further `constraint failed` for
      `cc5595bc-…` and the client's clock advances past 44571.

## Related / Out of Scope (track separately)
- **Frontend sync clock bug** (`frontend/src/store/syncStore.js` `sync()`):
  the client stores the server's `max(db_version)` as its clock and reuses it
  both as the `since` param **and** to filter its own local changes
  (`db_version > myClock`). When the stored clock resets to `0` (as observed:
  `since=0`), the client re-sends its entire change set (3376 changes) on every
  sync, turning a single bad change into a large re-send storm and a permanent
  stall on any failure. This amplified the FK bug but is not its cause; it
  should be fixed in a follow-up (track per-peer clocks separately, and on a
  500 do not retry the same batch unbounded).
- **Stale `CRSQLITE_EXT_PATH`** env var in the container points to
  `…/build/Release/crsqlite.node` which does not exist; `resolveCrsqlitePath()`
  silently falls back to `dist/crsqlite.so`. Update the env/var so the fallback
  isn't relied upon.
