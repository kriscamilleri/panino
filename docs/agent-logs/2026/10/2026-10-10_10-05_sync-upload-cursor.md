# Fix stranded uploads and lost import messages

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-10 10:05 (+02:00)
- Status: complete

## Objective

Fix two defects found on `main` while assessing the collaboration branch:

1. A local write could be stranded and never uploaded.
2. The result messages of a successful import were discarded by the page reload that follows it.

## Progress

- Reproduced the first defect on `main`'s own client and server in an isolated stack: a fresh
  device signed in to an account with existing documents and created one document. After four
  syncs and an explicit one the server did not have it (local version 57, pull clock 57). After
  typing in it the server held only `content` and `updated_at`.
- Cause: the client used the pull clock (server version space) to select changes to upload
  (local version space). See `docs/architecture/crsqlite-sync.md`, "Two positions per client".
- Probed CR-SQLite to confirm that `crsql_db_version()` reports the committed version while an
  open transaction's rows already carry the next one, which is what makes the upper bound on the
  upload safe.
- The second defect dates from 2026-04 (`86ee1fa`): `ImportModal` queues its toasts and then
  calls `window.location.reload()`.

## Changes Made

- `frontend/src/utils/syncCursor.js` (new): push cursor resolution, batch planning on version
  boundaries, and the three statements that read own changes.
- `frontend/src/store/syncStore.js`: `sync()` uploads through the push cursor, advances it when
  the server acknowledges, continues while a backlog remains, and `resetDatabase()` clears it.
- `frontend/src/utils/deferredToasts.js` (new): a bounded, validated toast queue in
  `sessionStorage`.
- `frontend/src/components/ImportModal.vue`: queues its result messages when a reload follows.
- `frontend/src/components/ToastContainer.vue`: shows queued messages on mount.
- `docs/architecture/crsqlite-sync.md`: documents the two positions and the failure mode.

No backend change. No schema change.

## Tests

- `frontend/tests/unit/syncCursor.test.js` (16), `deferredToasts.test.js` (6),
  `toastContainer.test.js` (2), and three additions to `importModal.test.js`.
- `npm run test:fe`: 28 files / 412 tests passed. `npm run lint`: 0 errors.
- Browser check against `main`'s unchanged server, isolated stack, disposable account:
  - The device holding the stranded document opened the fixed build; after its first sync the
    server had all seven columns of that document. Pull clock 59, push cursor 58.
  - A brand-new device created one document at local version 60 while its pull clock was 61;
    the document was on the server within six seconds.
  - Two queued messages were visible after a page reload.

## Open Items / Notes

- The first sync after this ships re-offers every change the device authored, in batches. The
  server merge treats them as no-ops, but its revision capture may record a first snapshot for
  documents that had none. This is bounded at one per document.
- Two tabs of the same browser profile share one local database and one cursor. That hazard
  predates this change and is not addressed here.
- The backend suite was not run for this branch because no backend file changed.
