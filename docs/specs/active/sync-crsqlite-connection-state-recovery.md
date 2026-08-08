# CR-SQLite Connection-State Recovery After Failed Sync

> Status: active
> Created: 2026-07-11
> Last updated: 2026-08-08

## Summary

A failed CR-SQLite merge can leave `crsql_internal_sync_bit()` set to `1` on the cached backend database connection. While that bit remains set, CR-SQLite's base-table mutation triggers are suppressed.

The production failure chain was:

1. A note-delete sync failed with `SQLITE_CONSTRAINT_FOREIGNKEY` because `note_revisions` still referenced the note.
2. CR-SQLite left the connection's internal sync bit enabled after the transaction rolled back.
3. The next day's daily image-prune job reused the cached connection and deleted one image with a normal SQL `DELETE`.
4. The `images__crsql_dtrig` trigger was skipped because it requires `crsql_internal_sync_bit() = 0`.
5. The image base row disappeared without a `col_name = '-1'` deletion sentinel, leaving orphaned image clock rows.
6. The next client sync failed with `could not find row to merge with for tbl images`.

This spec defines connection invalidation and sync error handling so a failed CR-SQLite merge cannot poison subsequent ordinary database operations.

## Goals

- Ensure a failed CR-SQLite merge cannot leave a reusable poisoned database connection in `dbConnections`.
- Ensure ordinary application writes never run while `crsql_internal_sync_bit() != 0`.
- Preserve sync correctness: do not silently skip incoming changes and advance past them.
- Prevent a failed sync from causing unrelated jobs such as image pruning or backup cleanup to corrupt CR-SQLite state.
- Preserve the existing `ON DELETE CASCADE` fix for `note_revisions` as the primary prevention for the original FK failure.
- Add regression tests for the exact production sequence.
- Make the failure and recovery path observable in production.

## Non-Goals

- This spec does not redesign the frontend sync clock protocol.
- This spec does not attempt to infer or repair arbitrary CR-SQLite corruption automatically without a validated repair strategy.
- This spec does not make `crsql_internal_sync_bit()` a public application-level control or manually toggle it.
- This spec does not remove image pruning, backup cleanup, or user image deletion.

## Root-Cause Evidence

The pre-repair production copy showed:

- Seven ordinary image clock rows for key `216`.
- `db_version = 44198`, `col_version = 1`, `cl = 1`.
- No `col_name = '-1'` deletion sentinel.
- No corresponding image deletion change in `crsql_changes`.
- The normal `images__crsql_dtrig` trigger was present.

Production logs showed:

- `2026-06-29 07:16–07:55` — repeated sync failures with `constraint failed` from the note-revision FK issue.
- `2026-06-30 21:18:55` — daily image prune deleted one image.
- `2026-07-01 13:42:21` — first `could not find row to merge with for tbl images` error.

A reproduction using the production-compatible CR-SQLite extension confirmed:

```text
failed CR-SQLite merge
→ rollback
→ crsql_internal_sync_bit() remains 1
→ ordinary DELETE FROM images
→ image delete trigger is skipped
→ no -1 sentinel
→ orphan clock rows
```

## Proposed Design

### 1. Treat a CR-SQLite merge failure as a poisoned connection

Any exception raised while inserting into `crsql_changes` must mark the current user database connection unhealthy. This includes, at minimum:

- `could not find row to merge with`
- `SQLITE_CONSTRAINT*`
- errors from CR-SQLite merge/delete/insert processing
- any unexpected exception from the `crsql_changes` insert statement

Do not continue applying the remaining changes after such an error. Continuing is unsafe because:

- the internal sync bit may remain set;
- later ordinary writes may bypass CR-SQLite triggers;
- skipping changes can cause silent data loss if a later change advances the clock.

The transaction must roll back as usual, then the connection must be invalidated before the request finishes.

### 2. Add explicit user-connection invalidation

Add a database-layer function, for example:

```js
export function invalidateUserDb(userId, expectedDb = null, reason = 'unknown')
```

Required behavior:

1. Look up the cached connection for `userId`.
2. If `expectedDb` is supplied and is not the cached connection, do not close the replacement connection.
3. Remove the connection from `dbConnections`.
4. Close it safely, logging close failures.
5. Do not return the closed handle to callers.
6. The next `getUserDb(userId)` call creates a new connection, loads CR-SQLite, runs schema setup, and starts with a clean internal sync state.

The function should be idempotent. It must be safe if the connection was already removed or closed.

Do not call `clearConnectionCache()` globally for a single-user sync failure; unrelated users must not be disrupted.

### 3. Invalidate from the sync route

Wrap the sync transaction in a structure that distinguishes:

- successful commit;
- expected application validation errors before CR-SQLite mutation;
- CR-SQLite merge errors that poison the connection.

For a CR-SQLite merge error:

1. Allow the transaction wrapper to roll back.
2. Call `invalidateUserDb(userId, db, 'crsqlite-merge-failure')`.
3. Return a non-success response such as HTTP 503 with a stable error code, for example:

```json
{
  "error": "Sync temporarily unavailable",
  "code": "SYNC_CONNECTION_RESET"
}
```

Do not return HTTP 200 with a `skipped` count for a failed CR-SQLite merge. A skipped change is not synchronized and may be lost when a later change advances the server clock.

The response must not expose raw SQLite errors or stack traces.

### 4. Ensure background jobs cannot use a poisoned connection

The connection invalidation must happen before any later request or scheduled job can reuse the handle. Since database operations through better-sqlite3 are synchronous, the invalidation can occur immediately after the failed transaction is caught.

As an additional defense, add a lightweight health check before non-sync background mutations that can modify CRR tables:

```sql
SELECT crsql_internal_sync_bit() AS sync_bit;
```

If the result is not `0`:

1. Log the user ID in masked form and the operation name.
2. Invalidate the connection.
3. Reopen the database before performing the mutation.

At minimum, apply this guard to:

- `runDailyImageOrphanPrune()` / `pruneOrphanImagesForUser()`;
- backup cleanup in `loadBackupSnapshot()`;
- any future maintenance job that directly writes a CRR table.

Do not silently reset the bit by calling an undocumented extension function.

### 5. Keep the schema-level note FK fix

The `note_revisions.note_id` FK must remain:

```sql
FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
```

The cascade prevents the known note-delete FK failure that initially poisoned the connection. The connection invalidation remains necessary defense-in-depth for any future CR-SQLite error.

`PRAGMA defer_foreign_keys = ON` may remain inside the sync transaction, but it is not a substitute for invalidating a connection after a failed merge.

### 6. Existing orphan repair remains an operational step

The existing repair utility should remain available:

- `backend/api-service/db-repair.js`
- `backend/api-service/scripts/repair-orphan-image-clocks.mjs`

Before applying it in production:

1. Back up the affected database and matching WAL/SHM files.
2. Run a dry-run.
3. Confirm the affected orphan keys.
4. Apply the repair while the API is stopped or the affected database is otherwise quiescent.
5. Verify no orphan non-sentinel image clock rows remain.
6. Confirm deletion sentinels and healthy clock rows were preserved.

The repair utility must not be used as a substitute for connection invalidation.

## Implementation Steps

### `backend/api-service/db.js`

1. Export `invalidateUserDb(userId, expectedDb, reason)`.
2. Make close/remove behavior idempotent and safe under repeated calls.
3. Ensure `getUserDb()` always loads a fresh CR-SQLite connection after invalidation.
4. Consider making required schema migrations fail initialization instead of logging and continuing with an unsafe schema.
5. Add a helper for the connection health check if it is shared by sync and maintenance jobs.

### `backend/api-service/sync.js`

1. Remove the behavior that catches `could not find row to merge with` and continues applying the batch.
2. Catch CR-SQLite merge failures around the transaction call.
3. Invalidate the exact database connection that failed.
4. Return a stable retryable response without exposing SQLite details.
5. Keep successful sync response shape unchanged (`changes` and `clock`).
6. Remove `skipped` from the success response unless it is retained for backward compatibility with a value that is always zero. Do not use it to indicate dropped changes.
7. Ensure a failed transaction does not trigger the normal post-sync backup work.

### `backend/api-service/image.js`

1. Add the connection health guard before direct image deletes performed by:
   - user deletion;
   - bulk deletion;
   - daily orphan pruning.
2. Log the image ID and operation only in a controlled, privacy-conscious diagnostic form.
3. Update the daily prune log to include the affected user and image IDs in masked form, or a request/job correlation ID, so a future deletion can be correlated with clock state.
4. Keep normal deletes unchanged when `sync_bit = 0`.

### `backend/api-service/backup.js`

1. Add the same health guard before deleting missing/unused image metadata.
2. Record the user/image operation in structured logs.
3. If connection recovery fails, skip that cleanup operation and report the backup warning rather than risking a CRR mutation on an unhealthy connection.

### Tests

Add tests under `backend/api-service/tests/`.

#### Connection-state regression

Using the production-compatible CR-SQLite extension:

1. Create CRR `notes` and `images` tables.
2. Add a `note_revisions` row with a restrictive FK in a fixture that intentionally reproduces the old failure.
3. Attempt a note-delete merge and assert it fails.
4. Assert `crsql_internal_sync_bit() = 1` before invalidation.
5. Invalidate and reopen the user database.
6. Assert `crsql_internal_sync_bit() = 0`.
7. Delete an image normally.
8. Assert the image deletion creates `col_name = '-1'` and no orphan non-sentinel clock rows.

#### Sync route recovery

1. Induce a CR-SQLite merge error through `/sync`.
2. Assert the response is retryable and not HTTP 200.
3. Assert the failed connection is removed from the cache.
4. Assert a subsequent `getUserDb(userId)` returns a different, healthy connection.
5. Assert a subsequent ordinary image delete creates a normal tombstone.

#### No silent data loss

1. Send a batch containing a failing change followed by a valid change.
2. Assert the transaction rolls back and neither change is reported as successfully applied.
3. Assert the server does not advance its response clock because of the failed batch.

#### Background-job guard

1. Poison a cached connection by reproducing a failed merge.
2. Run the image prune or backup cleanup path.
3. Assert the connection is reopened before the delete.
4. Assert the delete produces a normal CR-SQLite sentinel.

#### Existing behavior

- Successful sync still returns HTTP 200.
- Successful image deletion still removes the database row and file.
- The daily prune still deletes eligible unused images.
- The note-delete regression with revisions succeeds due to `ON DELETE CASCADE`.
- Existing orphan repair tests continue to preserve healthy rows and sentinels.

## Observability

Add structured events for:

- `sync_crsqlite_merge_failure`
  - masked user ID;
  - table, sanitized primary-key descriptor, and error category;
  - request correlation ID;
  - whether the connection was invalidated successfully.
- `sync_db_connection_invalidated`
  - masked user ID;
  - reason;
  - whether the handle was cached and closed.
- `crsqlite_connection_health_reset`
  - masked user ID;
  - background operation name;
  - observed sync-bit value.
- `image_prune_delete`
  - masked user ID and image ID;
  - reason (`missing-file`, `unused`, etc.);
  - current sync-bit health result.

Do not log raw JWTs, image contents, file contents, or full user secrets.

## Migration and Rollout

1. Deploy the `ON DELETE CASCADE` schema fix first or together with connection invalidation.
2. Before deployment, retain the existing pre-repair backup of the affected database and WAL/SHM files.
3. Apply the orphan-clock repair using the documented backup/dry-run/apply process.
4. Restart the API service so all existing cached connections are discarded.
5. Verify the affected user can sync successfully.
6. Verify production logs show:
   - no repeated `could not find row to merge with` errors;
   - no `skipped` changes;
   - no image orphan detections after normal deletes/pruning.
7. Monitor for at least one full daily prune cycle.

The initial release should fail closed on a CR-SQLite merge error rather than attempting an automatic destructive repair. Automatic orphan repair can be considered separately after metrics and tests demonstrate that its recovery semantics are safe for all CRR tables.

## Acceptance Criteria

- [ ] A failed CR-SQLite merge never leaves its connection in `dbConnections`.
- [ ] A fresh connection reports `crsql_internal_sync_bit() = 0`.
- [ ] An image delete after a failed merge creates a normal `-1` tombstone.
- [ ] No code path returns HTTP 200 for a batch containing a skipped/failed CR-SQLite change.
- [ ] A failed batch does not advance the server clock or silently lose changes.
- [ ] The note-delete FK regression remains fixed with `ON DELETE CASCADE`.
- [ ] Background image prune and backup cleanup validate connection health before CRR writes.
- [ ] Existing orphan repair remains backup-gated, dry-run capable, and tested.
- [ ] Production logs identify merge failures, connection invalidation, and maintenance deletes without exposing sensitive data.
- [ ] Backend tests pass in the production-compatible Node/SQLite environment.

## Related Files

- `backend/api-service/db.js`
- `backend/api-service/sync.js`
- `backend/api-service/image.js`
- `backend/api-service/backup.js`
- `backend/api-service/db-repair.js`
- `backend/api-service/scripts/repair-orphan-image-clocks.mjs`
- `backend/api-service/tests/integration/sync.test.js`
- `backend/api-service/tests/integration/sync.revision.test.js`
- `backend/api-service/tests/unit/db-repair.test.js`
- `docs/specs/shipped/sync-note-delete-fk-fix.md`
- `docs/agent-logs/2026/07/2026-07-11_12-00_review-latest-sync-fix.md`
