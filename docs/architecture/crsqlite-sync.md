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
- **`db_version`** — the database-wide causal clock. Every replica has its own; the numbers
  are only comparable within one database. The `/sync` request's `since` value is the last
  *server* clock the client has observed.
- **`col_version`** — the version of one column value for one primary key.
- **`cl`** — causal length. A positive value on a `cid = '-1'` row represents a delete
  tombstone; ordinary column updates use a column name and normally have `cl = 0`.
- **`cid`** — the changed column name. `'-1'` is the deletion sentinel.
- **`seq`** — the sequence number associated with a change batch.

The wire representation is deliberately tolerant because clients may send packed primary-key
objects, JSON primary-key arrays, buffers, hex, or UUID strings. `sync.js` normalizes these
values before binding them to SQLite.

## Two positions per client

A client tracks two independent positions, in two different version spaces:

| Position | Version space | Storage | Used for |
|---|---|---|---|
| Pull clock | Server `db_version` | `localStorage` `crsqlite_clock:<dbKey>` | `since` in the request; set from `clock` in the response |
| Push cursor | This replica's `db_version` | `localStorage` `crsqlite_push_cursor:<dbKey>` | Selecting own changes to upload; set once the server acknowledges them |

Both are kept per database (`user:<uuid>` or `space:<uuid>`). The unkeyed names used before
the database registry are migrated once at start-up.

They must never be the same number. Merging remote rows moves a replica's `db_version` up to
the highest version it received, not to the server's current version, so after a sync that
both uploads and finds the server ahead the server's clock is one above the replica's. The
replica's next transaction then takes exactly that version, and a `db_version > clock` filter
never selects it. Until 2026-10 the client used the pull clock for both, which stranded such
writes: a document created on a newly signed-in device never uploaded, and after later edits
the server held only its `content` and `updated_at`.

The upload rules live in `frontend/src/utils/syncCursor.js`:

- Upload only rows whose `site_id` is this replica's. Every change reaches the server from the
  replica that made it; echoing received rows is redundant and wakes other clients for nothing.
- Bound the upload at the committed `crsql_db_version()`. Rows of a transaction still open on
  the connection already carry the next version; sending part of it and advancing the cursor
  would strand the rest.
- Advance the cursor only after a successful response. Re-sending is harmless because the
  server merge is idempotent.
- A missing cursor, or one ahead of the local database, restarts from zero. The first sync
  after the cursor was introduced therefore re-offers every own change, in batches of at most
  500 changes cut on version boundaries. This is what recovers writes stranded earlier.
- One transaction is one version, so a bulk import of thousands of Documents is a single
  version that no version boundary can cut. Such a version is uploaded in slices by `seq`,
  and the cursor is stored as `"<version>.<seq>"` until the version is complete, so an
  interrupted upload resumes where it stopped. Slicing is used only when the version's `seq`
  values are unique; otherwise the version goes in one request, as it always did. Measured:
  a 21,000-change import uploads in 44 requests instead of one of tens of megabytes that the
  server parsed and merged in a single uninterrupted step.
- A sync that neither uploaded nor received anything does no further work: no merge-base
  bookkeeping, no reload of the tree, dashboard or variables. With 5,000 Documents an idle
  sync took 1,248 ms before this and 5 ms after.

## Merge base for document bodies

`note_sync_base` (client-local, not replicated) holds the body the server is known to hold,
for Documents that have an edit the server has not acknowledged, and for no others. The
three-way merge of concurrent body edits depends on it being exactly that:

- It is captured just before the first local write that makes a Document differ from the
  server (`captureMergeBase`, called inside the writing transaction by every code path that
  writes a body: editor save, conflict resolution, import overwrite). A later save of the
  same unsent edit does not touch it.
- It is dropped when the upload is acknowledged with nothing newer waiting, and when a remote
  body is adopted. A Document in step with the server has no row. An earlier version kept a
  row for every Document and scanned for missing ones on every sync, which doubled local
  storage for bodies and cost over a second per idle sync at 5,000 Documents.
- It does **not** move on a local save or on a manual conflict resolution. Those are edits
  that still have to be uploaded. A base that already contains the unsent edit equals the local
  body, so every incoming body looks safe to adopt and the edit is lost without a conflict.
- Nothing is captured when the stored body is not known to be the server's: an edit is already
  waiting, or this replica has not yet completed a sync with the push cursor. A concurrent
  edit then becomes a conflict that keeps both bodies, not a merge from a guessed ancestor.
- An incoming body is concurrent only if this replica has an unacknowledged edit to that
  document, an unsaved draft, or a local value that outranked the remote row. Otherwise it is
  simply newer and is adopted, with or without an existing base. A draft counts as unsaved
  only while it differs from what the editor itself last saved or adopted; the draft store
  also holds the last text of Documents that are merely open.

The server makes the second half possible by replying with other replicas' changes as they
stood before it merged the request's upload (see the `/sync` contract in `data-model.md`).
The decision table is `planRemoteContent` in `frontend/src/utils/syncMerge.js`.

What the line merge calls clean is wider than it sounds. Two different lines inserted at the
same point, or appended at the end, merge without a conflict as this replica's line followed
by the other's, and each replica computes that in its own order. With
`CONTENT_MERGE_WRITEBACK_ENABLED` off the result is only offered for review; with it on, the
write-back rules in COLLAB-02 §6.3 decide whose order stands. Two different edits of the
same line, or of adjacent lines, are always a conflict.

## Stored conflicts

`note_conflicts` (client-local, not replicated) holds two bodies for a Document whose
concurrent edits could not be settled automatically. One of the two is the Document's stored
text. The other exists nowhere else, and keeping it is what the record is for. Which is which
depends on who won last-writer-wins when the conflict was recorded:

| Winner | Stored text is | Held only in the record |
|---|---|---|
| The other replica | `theirs_content` | `mine_content`, this device's displaced edit |
| This replica | `mine_content` | `theirs_content`, the body this upload displaced on the server |

The second row exists because of the pre-merge reply: the winner is told what it overwrote,
and after the other device adopts the winning body that record is the only copy left.

Rules, implemented by `planConflictAfterChange`:

- When the stored text changes, by a later remote body or a local save, the side that was the
  stored text follows it. The held side is never overwritten.
- The record is dropped only when the new text already contains what the held body changed.
- If neither recorded body is the text being replaced, the record cannot tell which one is
  held, and gives up neither unless the new text contains it.

While a record exists the Document is read-only on that device, in the editor and for
toolbar, replace, undo and image inserts. The record has room for one held body; editing on
would create a third version, and a second conflict on the same Document would then have to
discard one of them. Text typed before the pause took effect is carried into the record:
text the editor was holding against a remote change becomes `mine_content`, anything else
still pending is saved normally and the record follows the save.

Known limit: if a save that was already in flight when the conflict was recorded itself
collides with another remote edit before it is acknowledged, three bodies exist and the
record keeps the two newest. This needs two further concurrent edits within the same couple
of seconds.

## Transactions on the client

Every `BEGIN … COMMIT` on one database shares a single connection, and SQLite refuses a
`BEGIN` while a transaction is open on it. Applying remote rows awaits between statements, so
an editor save could start in the middle and fail with "cannot start a transaction within a
transaction"; the save was then lost. `runExclusive` in
`frontend/src/utils/scopedRepository.js` queues exclusive sections per database.
`repository.transaction`, the remote apply and the post-upload bookkeeping all go through it.
Code inside such a section must not start another one on the same database: it would wait
for itself.

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
| A document created on a second device never appears elsewhere, or appears without a title | One clock served as both pull position and upload position, so a write at the version the clock landed on was never selected | Separate push cursor in the replica's own version space; one-time full re-offer of own changes | 2026-10-10 log |
| The API stops answering for seconds at a time, for every user | better-sqlite3 is synchronous, so a statement waiting on a lock held outside the process (the backup tool, a repair script, an operator's `sqlite3` session) stalls the whole process for the length of `busy_timeout`, which was 30 s on the metadata databases | `busy_timeout` of 250 ms in the service; a request that still finds the database locked gets `503 DATABASE_BUSY` with `Retry-After`; `_users.db` uses write-ahead logging so readers no longer wait for a writer | 2026-10-10 log |
| The API process exits on one request | (a) a WebSocket frame that breaks the protocol raised an `error` event nobody listened for; (b) a change whose primary key is not a packed key reached CR-SQLite's native unpacking, which aborts | Error listeners on the server and every socket, `maxPayload`; every key in a batch validated before the first row is merged, `400 INVALID_CHANGE` | 2026-10-10 log |
| `could not find row to merge with for tbl images` | A failed merge left the cached connection's sync bit set; the next image prune suppressed its delete trigger and created an orphan clock | Connection invalidation, health checks, fail-closed merge handling, and orphan repair | 2026-07-06 and 2026-07-11 logs |

## Rules when changing sync or schema

- Any local table with an FK to a CRR parent must use `ON DELETE CASCADE`.
- Schema changes belong in both `syncStore.js` (`DB_SCHEMA`) and `db.js` (`BASE_SCHEMA`).
- New CRR tables must also be added to `CRR_TABLES` in `db.js`.
- **Adding a column to an existing CRR must go through `crsql_begin_alter` /
  `crsql_commit_alter`.** See [Altering a CRR table](#altering-a-crr-table).
- NOT NULL CRR columns need defaults for CR-SQLite compatibility.
- Never mutate a CRR base table from a connection that may have a poisoned sync bit.
- Background jobs must validate connection health before CRR writes.
- Do not return success for a batch whose merge was not durably applied; preserve the request's
  failure semantics and invalidate the connection.

## Altering a CRR table

CR-SQLite generates a CRR's insert/update/delete triggers from the base table's column list
at the moment the table is registered. Those triggers bind a fixed number of values. A bare
`ALTER TABLE … ADD COLUMN` therefore leaves triggers that no longer match the table, and the
next write to that table fails with:

```text
SQLiteError: expected N values, got M
```

Re-running `crsql_as_crr('<table>')` does **not** rebuild them; it reports success and leaves
the stale triggers in place. The supported sequence is:

```sql
SELECT crsql_begin_alter('<table>');
ALTER TABLE <table> ADD COLUMN <column> <type> NOT NULL DEFAULT <default>;
SELECT crsql_commit_alter('<table>');
```

`crsql_commit_alter` regenerates the clock table and the three triggers, and the new column
starts producing `crsql_changes` rows, so it replicates like any other column.

Two practical consequences:

- A database can be left half-migrated — column present, triggers stale — either by an older
  bare-`ALTER` migration or by a process interrupted before the commit. `ensureImagesSchema`
  and `ensureNotesSchema` in both layers detect that shape by checking the table's generated
  update trigger and repair it with an empty `begin_alter` / `commit_alter` pair.
- Only call `crsql_begin_alter` when the table really is a CRR on that connection. On a fresh
  database `BASE_SCHEMA` creates the columns before `ensureCrr` registers the table, and a
  handle opened without the extension has no CR-SQLite functions at all.

## Diagnosing a live incident

Follow [the sync incident runbook](../runbooks/sync-incident-response.md). It covers backup,
dry-run inspection, repair, and post-repair sentinel checks.

## Runtime and vendoring note (2026-08-16)

`better-sqlite3` moved from 9.6.0 to 12.11.1, which bundles SQLite 3.53.2 — up from 3.45.3.
Panino no longer installs the unmaintained `@vlcn.io/crsqlite` packages. The backend loads
`backend/api-service/native/crsqlite.so`, built from the maintained fork against its vendored
SQLite 3.53.4 headers, and the frontend imports its runtime from `frontend/src/vendor/`.
The backend binary targets Linux x86_64 and remains a standard SQLite loadable extension
rather than a Node addon; other platforms must supply a compatible binary with
`CRSQLITE_EXT_PATH`.
Treat any future SQLite or CR-SQLite rebuild as a real risk to `crsql_changes` semantics, not
as a routine dependency bump.

The required verification for a rebuilt extension is a `loadExtension` +
`crsql_db_version()` probe, the complete backend suite, and the merge-behaviour round trip
against a restored production database copy specified in
[DX-10](../specs/shipped/dx-10-node-runtime-upgrade.md) §6 Phase 2 step 8.

The 2026-08-16 vendoring verification loaded the binary into `better-sqlite3` 12.11.1
(SQLite 3.53.2), returned `0` from `crsql_db_version()`, and passed all 177 backend tests.
The two-arm merge harness completed all seven operations with no errors against both a
synthetic fixture and a fresh 11 MB production snapshot. Clock totals, tombstones, visible
changes, and the six-version clock advance were identical between SQLite 3.45.3 and 3.53.2.
The production snapshot and all working copies were deleted immediately after verification.

## Provenance

- `docs/agent-logs/2026/06/2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md`
- `docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md`
- `docs/agent-logs/2026/07/2026-07-11_12-00_review-latest-sync-fix.md`
- `docs/agent-logs/2026/07/2026-07-11_00-00_sync-connection-recovery.md`
- `docs/agent-logs/2026/10/2026-10-10_10-05_sync-upload-cursor.md`
