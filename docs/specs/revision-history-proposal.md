# Revision History — Product & Technical Specification (v2)

> Per-document revision history for Panino.
> Last updated: 2026-02-15

---

## 1) Summary

Panino will add **backend-hosted revision history** for notes so users can browse and restore earlier versions even after reloads and cross-device sync.

This spec adopts:

- Full-snapshot revisions (no delta chains)
- Gzip-compressed markdown content in backend SQLite
- Capture in backend sync processing plus explicit manual checkpoints
- Deterministic retention rules with explicit precedence

This version clarifies API contracts, race behavior, retention precedence, and rollout/testing requirements.

---

## 2) Scope

### In scope (v1)

- Store note revisions in backend per-user SQLite only
- Auto-capture revisions from sync-applied content/title edits (throttled)
- Manual “Save version” endpoint
- List, fetch, and restore revision endpoints
- Basic frontend panel: list revisions + restore
- Hard cap + coarse retention pruning

### Out of scope (v1)

- Offline revision browsing
- Deleted-note recovery workflow
- Cross-note/global search in revision bodies
- Server-side diff storage

---

## 3) Goals and Non-Goals

### Goals

1. Recover previous note states reliably.
2. Keep implementation simple and robust.
3. Keep storage bounded and predictable.
4. Preserve low latency in normal sync paths.

### Non-goals

1. Perfectly preserve every keystroke forever.
2. Provide legal/audit-grade immutable logs.
3. Replicate revisions via CR-SQLite to clients.

---

## 4) Architecture Decision

### Decision

Use **backend-only full snapshots** with gzip compression.

### Why

- Simple restore path: one revision row yields one full content payload.
- No fragile diff chains or reconstruction failures.
- Gzip provides strong compression for markdown without new dependencies.
- Avoids client DB bloat and extra CRR traffic.

### Trade-off accepted

Revision browsing requires network connectivity. Core editing remains fully offline via local-first notes.

### CR-SQLite 0.16 capture strategy

CR-SQLite 0.16 does **not** auto-apply changes to base tables when rows are inserted into `crsql_changes`. This means after applying a sync payload, `SELECT content FROM notes WHERE id = ?` may not reflect the incoming values.

**Prescribed approach — change-set extraction:**

The capture hook must extract proposed `content` and `title` values directly from the incoming change-set array, **not** from the `notes` base table. The algorithm:

1. Before inserting into `crsql_changes`, scan the change array for rows where `table = 'notes'` and `cid` is `'content'` or `'title'`.
2. Group by note ID (extracted from `pk` JSON array, element 0).
3. If multiple changes exist for the same note + column, keep the last one (highest `db_version` / array order).
4. After the `crsql_changes` insert transaction completes, use the extracted values to evaluate capture (duplicate check, throttle, snapshot creation).
5. If only `title` changed (no `content` in the change set), read the existing `content` from the base table for the snapshot — the base table value is still valid for columns not present in the current change set.

This approach is deterministic, does not depend on CR-SQLite internals, and works within the existing sync transaction.

**Compression dependency:** Gzip is provided by Node.js built-in `zlib` module — no additional dependency required.

---

## 5) Data Model

```sql
CREATE TABLE IF NOT EXISTS note_revisions (
  id                 TEXT PRIMARY KEY NOT NULL,      -- UUID v4
  note_id            TEXT NOT NULL,                  -- FK logical reference to notes.id
  title              TEXT,
  content_gzip       BLOB NOT NULL,                  -- gzip-compressed markdown utf8 (using Node zlib)
  type               TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'manual' | 'pre-restore'
  content_sha256     TEXT NOT NULL,                  -- hex digest of uncompressed content
  uncompressed_bytes INTEGER NOT NULL,
  compressed_bytes   INTEGER NOT NULL,
  created_at         TEXT NOT NULL,                  -- ISO 8601 UTC, e.g. 2026-02-15T21:00:00.000Z
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE INDEX IF NOT EXISTS idx_note_revisions_note_created
  ON note_revisions(note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_revisions_note_type_created
  ON note_revisions(note_id, type, created_at DESC);
```

### Pruning timestamp tracking

To avoid running pruning on every revision insert, track when each note was last pruned:

```sql
CREATE TABLE IF NOT EXISTS note_revision_meta (
  note_id        TEXT PRIMARY KEY NOT NULL,
  last_pruned_at TEXT              -- ISO 8601 UTC; NULL means never pruned
);
```

This table is lightweight (one row per note that has revisions) and is queried during capture to decide whether to trigger pruning.

### Notes

- `content_sha256` is used to skip duplicate snapshots without decompressing prior rows.
- `type='pre-restore'` is created automatically before a restore operation overwrites the note, capturing the state that is about to be replaced.
- Table is backend-only and **not** a CRR table.
- **No `ON DELETE CASCADE`**: Note deletions arrive as CRR tombstones via `crsql_changes` INSERT, not as SQL `DELETE` statements. SQLite FK cascades only fire on actual `DELETE`, so `ON DELETE CASCADE` would give false confidence. Orphan revision cleanup is handled explicitly (see §8).
- **No `user_id` column**: Ownership is enforced by per-user database isolation — each user's revisions live in their own `{userId}.db` file, so cross-user access is architecturally impossible.

---

## 6) Behavioral Invariants

1. **Ownership:** all revision operations are scoped to authenticated user-owned notes only. Enforced by per-user database isolation (`getUserDb(req.user.user_id)`) — no `user_id` column needed in `note_revisions`.
2. **No duplicate consecutive revisions:** if `content_sha256` and title match latest revision, skip capture.
3. **Throttle:** at most one `auto` revision per note per 5-minute bucket.
4. **Restore safety net:** restore always creates a `type='pre-restore'` revision capturing the current note state before overwriting it, so the pre-restore content is never lost.
5. **Retention precedence:** manual revisions are prune-exempt by policy tier, but hard-cap rules still apply.
6. **Auth source of truth:** all revision endpoints must use `req.user.user_id` from JWT middleware exclusively. Never fall back to `req.body.userId` or `req.body.user_id`.

---

## 7) Capture Rules

### Auto capture trigger

During `/sync`, after a note update is successfully applied, candidate capture is evaluated if either:

- `notes.content` changed, or
- `notes.title` changed.

### Capture unit

- At most one capture attempt per note per sync request.
- If multiple edits to same note appear in request, capture post-apply final state once.

### Throttle algorithm

- Compute SQL-based check: `created_at > datetime('now', '-5 minutes')`.
- Allow `auto` capture only if no `auto` revision exists in this window.
- Use database time instead of application time to avoid clock skew.
- Enforce inside the same transaction as insert decision.

### Manual capture

- `POST /notes/:id/revisions` creates a `manual` revision.
- Manual capture ignores auto throttle and runs duplicate check (skip allowed with explicit response).

### Restore capture behavior

On restore:

1. Snapshot the **current** note state as a `type='pre-restore'` revision (content + title before overwrite). This ensures the pre-restore content is always recoverable.
2. Write the restored content and title into the `notes` base table. Update `notes.updated_at` to `new Date().toISOString()` to ensure the change propagates to clients via CRR sync.
3. Broadcast a `{ type: 'sync' }` WebSocket poke to all connected clients for the same user so they pull the restored content immediately.

No post-restore revision is created — the restored state already exists as the source revision the user selected.

---

## 8) Retention and Pruning

Retention uses two layers:

1. **Age-density pruning** on `auto` and `pre-restore` revisions
2. **Absolute hard cap** per note over all revision types

### v1 retention policy (coarse)

- Keep all revisions for last 48 hours.
- For older than 48 hours, keep one revision per day.
- Apply hard cap: keep newest 200 revisions per note.

### Precedence

1. Apply age-density pruning first.
2. Apply hard cap second.
3. Hard cap can remove any type when necessary (including manual).

### Execution model

- Pruning does **not** run on every write.
- Trigger pruning when creating a revision if `note_revision_meta.last_pruned_at` is NULL or older than 60 minutes. Update `last_pruned_at` after pruning completes.
- Also run bounded startup sweep (batched notes, time-limited pass).
- Run a **daily global maintenance prune** (every 24h) to process inactive notes and cleanup orphan revision rows.

### Daily maintenance prune requirements

1. **Inactive-note pruning**
  - Apply normal retention rules to notes even when they have not received recent edits.
2. **Deleted-note cleanup (primary orphan cleanup mechanism)**
  - Delete orphan rows in `note_revisions` where `note_id` has no matching record in `notes`.
  - Also delete orphan rows in `note_revision_meta` where `note_id` has no matching record in `notes`.
  - This is the **primary** cleanup mechanism for CRR-mediated note deletions, because `ON DELETE CASCADE` does not fire for tombstone-based deletes via `crsql_changes`.
  - Additionally, when the sync capture hook detects a `notes` delete in the incoming change set (a row with `table='notes'`, `cl=` tombstone marker), it should proactively delete revisions for that note within the same transaction.
3. **Bounded execution**
  - Process in batches with checkpoints to avoid long-running locks.
  - If a pass exceeds time budget, resume next scheduled pass from the last checkpoint.
4. **Scheduling semantics**
  - Run once shortly after backend startup, then every 24 hours.
  - Ensure only one maintenance pass runs at a time per user database.

---

## 9) API Contract

All routes require JWT auth.

### `GET /notes/:id/revisions`

Returns lightweight list ordered newest first.

Query params:

- `limit` (optional, default `50`, max `200`)
- `before` (optional, ISO timestamp cursor for older results)
- `beforeId` (optional, revision UUID tie-breaker — used together with `before` when multiple revisions share the same `created_at` timestamp)

Response `200`:

```json
{
  "revisions": [
    {
      "id": "uuid",
      "noteId": "uuid",
      "title": "My note",
      "type": "auto",
      "createdAt": "2026-02-15T21:00:00.000Z",
      "uncompressedBytes": 10420,
      "compressedBytes": 2411
    }
  ]
}
```

Errors: `401`, `403`, `404`.

### `GET /notes/:id/revisions/:revisionId`

Returns one revision with decompressed `content`.

Response `200`:

```json
{
  "revision": {
    "id": "uuid",
    "noteId": "uuid",
    "title": "My note",
    "type": "manual",
    "createdAt": "2026-02-15T21:00:00.000Z",
    "content": "# markdown..."
  }
}
```

Errors: `401`, `403`, `404`, `422` (corrupt payload).

### `POST /notes/:id/revisions`

Creates manual checkpoint from current note state.

Response `201` when created:

```json
{ "created": true, "revisionId": "uuid" }
```

Response `200` when skipped as duplicate:

```json
{ "created": false, "reason": "duplicate-latest" }
```

Errors: `401`, `403`, `404`.

### `POST /notes/:id/revisions/:revisionId/restore`

Restores selected revision content and title into current note.

Request body (optional):

```json
{ "expectedUpdatedAt": "2026-02-15T20:59:00.000Z" }
```

If `expectedUpdatedAt` is provided and does not match current note `updated_at`, return `409`.

Response `200`:

```json
{
  "restored": true,
  "note": {
    "id": "uuid",
    "title": "Restored title",
    "content": "# markdown...",
    "updatedAt": "2026-02-15T21:10:00.000Z"
  },
  "preRestoreRevisionId": "uuid"
}
```

The response includes the restored `content` so the frontend can update its local state immediately without waiting for a sync round-trip.

The endpoint must also broadcast a `{ type: 'sync' }` WebSocket poke to all connected clients for the same user (via `req.clients`) so other devices pull the change.

Errors: `401`, `403`, `404`, `409`, `422`.

### UI loading model (frontend)

Revision panel loading behavior is standardized to keep payloads small and interaction responsive:

1. **Panel open**
  - Call `GET /notes/:id/revisions?limit=50`.
  - Render skeleton rows in list while loading.
  - Do not fetch full revision bodies at this stage.
2. **Revision selected**
  - Fetch detail lazily via `GET /notes/:id/revisions/:revisionId`.
  - Render detail skeleton while request is in flight.
  - Cache fetched revision body in-memory for the current panel session.
3. **Load older revisions**
  - Request next page with `before=<oldestCreatedAtCurrentlyLoaded>`.
  - Append items; stop requesting when returned count is less than requested `limit`.
4. **Post-action refresh**
  - After manual save or restore, refresh the first page.
  - Keep current selection if still present; otherwise clear selection and show a non-blocking notice.
5. **Error handling**
  - List fetch failure: inline retry in list panel.
  - Detail fetch failure: keep list usable and provide retry in detail pane.

No background polling is required in v1.

---

## 10) Transaction and Concurrency Semantics

### Required transaction boundaries

- `sync apply + capture decision + capture insert` must be in one DB transaction per request.
- `restore read + note write + restore-revision insert` must be in one DB transaction.

### Race handling

- Duplicate prevention is based on latest revision hash/title fetched under transaction.
- Throttle check uses latest `auto` bucket under transaction.
- Restore supports optimistic concurrency with optional `expectedUpdatedAt`.

### Restore and CRR propagation

When restore writes to the `notes` base table directly (`UPDATE notes SET content=?, title=?, updated_at=?`), this creates a backend-authored CRR change under the backend DB's implicit `site_id`. Key considerations:

- **Backend `site_id` stability**: Each per-user DB file (`{userId}.db`) has a CR-SQLite-assigned `site_id` that is stable across restarts (persisted in the DB file). The backend does not need to manage this explicitly.
- **Client notification**: The restore endpoint must broadcast a `{ type: 'sync' }` WebSocket poke to all connected clients for the user. Clients then pull changes via their normal `/sync` flow and receive the restored content.
- **Concurrent edit conflict**: If a client is editing the same note while a restore happens, CRR last-writer-wins semantics apply per column. A concurrent client edit with a higher `col_version` could override the restore. The `expectedUpdatedAt` optimistic lock mitigates this at the API level, but the CRR merge is ultimately authoritative.

---

## 11) Security and Data Lifecycle

- Never trust note IDs from body; always authorize against JWT user context (`req.user.user_id` from middleware).
- **Fix required in `sync.js`:** The existing `extractUserId()` function falls back to `req.body.user_id` / `req.body.userId`, which contradicts the security rule. The revision capture hook must use `req.user.user_id` exclusively. The `extractUserId` fallback should also be removed from `sync.js` itself since the sync route runs after `authenticateToken` middleware.
- Validate that requested revision belongs to requested note. Cross-user validation is architecturally guaranteed by per-user DB isolation (each user's routes operate on `getUserDb(req.user.user_id)`).
- On note deletion via CRR sync: proactively delete revisions in the sync transaction when a tombstone is detected. Daily maintenance prune handles any missed orphans (see §8).
- On account deletion, remove all per-user DB content including revisions (the entire `{userId}.db` file is deleted).
- Revisions are included in server-side backups; **permanently excluded** from frontend export/import (revisions are a backend-only feature and not part of the user's portable data set).

---

## 12) Performance Expectations

- Typical gzip compression ratio target: 70–90% for markdown.
- List endpoint must avoid decompression (metadata only).
- Fetch single revision decompresses one blob only.
- Pruning workload is bounded by per-note hourly gate + startup batching.

Suggested telemetry (via headers or logs):

- `revision.capture.created`
- `revision.capture.skipped_duplicate`
- `revision.capture.skipped_throttle`
- `revision.prune.deleted_count`
- `revision.read.decompress_error`

---

## 13) Implementation Plan

### Phase 1 (ship)

- Backend schema (`note_revisions` + `note_revision_meta` tables + indexes) in `db.js`
- Change-set extraction logic in `sync.js` (scan incoming changes for note content/title, handle tombstone detection)
- Capture in `sync.js` with gzip + hash + throttle + orphan cleanup on delete
- Revision router (`revision.js`) with list/get/create/restore endpoints + WebSocket poke on restore
- Fix `extractUserId` in `sync.js` to remove `req.body` fallback
- Frontend `revisionStore.js` + `RevisionPanel.vue` — list with pagination, lazy detail fetch, restore action
- Simple side-by-side text comparison view (current vs. selected revision), toggled from the View menu
- Skeleton loading states for list and detail views
- Unit/integration tests for capture, throttle, duplicate skip, restore, prune, orphan cleanup, corrupt payload

### Phase 2

- Richer retention tiers (15-min/hour/day/week/month)
- Upgrade side-by-side text view to rich diff view (`diff-match-patch`)
- Revision count indicator

### Phase 3

- Optional admin tools (per-user retention stats, maintenance commands)

---

## 14) Test Matrix (Required)

1. **Capture correctness**
   - Content change captured (extracted from change set, not base table)
   - Title-only change captured (content read from base table for snapshot)
   - No-op change skipped (duplicate hash + title check)
2. **Throttle and races**
   - Multiple rapid sync writes create max one auto revision per bucket
3. **API authorization**
   - Verify JWT `req.user.user_id` is used for DB access (per-user DB isolation)
   - Revision belongs to requested note (same DB)
   - Unauthenticated requests rejected
4. **Restore behavior**
   - Restore snapshots pre-restore state as `type='pre-restore'` revision, then overwrites note
   - No post-restore revision created
   - Optional concurrency token returns `409` on mismatch
   - WebSocket poke sent to connected clients after restore
   - Response includes restored content for immediate frontend update
5. **Pruning**
   - Coarse age policy + hard cap applied as specified
   - `note_revision_meta.last_pruned_at` updated after pruning
   - Orphan cleanup deletes revisions for deleted notes
6. **Corrupt payload handling**
   - Bad gzip row returns controlled `422`, not server crash
7. **Orphan cleanup**
   - Revisions for deleted notes cleaned up in sync transaction (tombstone detection)
   - Daily maintenance pass catches any remaining orphans

---

## 15) Rejected Alternatives

- Delta-only or hybrid snapshot+delta history: higher complexity, chain fragility, harder pruning.
- Direct use of CR-SQLite internal change tables as history source: not a stable revision-log contract.
- Trigger-based compression in SQLite: cannot natively gzip in SQL and has uncertain behavior with CR-SQLite internals.

---

## 16) Resolved Decisions

1. **Restore snapshot**: Restore creates a **pre-restore** snapshot (`type='pre-restore'`) of the current note state before overwriting. No post-restore revision is needed — the restored state already exists as the revision the user selected.
2. **Export/import**: Revisions are permanently excluded from frontend export/import. They are a backend-only feature and not part of the user's portable data set.
3. **Manual revision hard-cap protection**: No special protection. Manual revisions are subject to the same hard-cap rules as all other types.
4. **Diff view (v1)**: Ship with a simple side-by-side plain-text comparison (current note vs. selected revision), toggled from the View menu. Phase 2 upgrades to a richer diff view using `diff-match-patch`.

---

## 17) File Impact Map

- `backend/api-service/db.js`
  - Add `note_revisions` table + indexes.
- `backend/api-service/sync.js`
  - Add transactional capture hooks.
- `backend/api-service/revision.js` (new)
  - Implement endpoints and prune helpers.
- `backend/api-service/index.js`
  - Mount revision router.
- `frontend/src/store/revisionStore.js` (new)
  - API calls + local cache for list/detail.
- `frontend/src/components/RevisionPanel.vue` (new)
  - List, inspect, restore UI.
  - Renders as a toggleable slide-over panel (similar pattern to `StyleCustomizer.vue`), anchored to the right side of `ContentArea.vue`. Toggle via a toolbar button.
  - Includes simple side-by-side text comparison (current vs. selected revision), toggled from the View menu.
- `backend/api-service/sync.js`
  - Fix `extractUserId` to remove `req.body` fallback (security fix, prerequisite).

### Naming note

The frontend already has a `historyStore.js` (undo/redo for the editor). The new store is named `revisionStore.js` to avoid confusion. The UI should use the term "Versions" or "Revision History" — not "History" — to distinguish from editor undo.
