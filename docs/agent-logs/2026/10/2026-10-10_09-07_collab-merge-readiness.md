# Collab branch merge-readiness assessment and gate A checks

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-10 08:50 (+02:00)
- Status: complete (assessment and checks only; no product code changed, nothing merged)

## Objective

Decide whether `feature/collab` (PR #9) is ready to merge into `main`, propose how to review
a change of this size, and run the first review gate: does anything break for existing
users with both feature flags off.

## Progress

- Measured the branch: 23 commits (2026-08-16 to 2026-08-25), 205 files, +24,454 / −1,581.
  PR #9 is open and mergeable with 0 reviews. Its last CI run predates the folder-import
  work that reached `main` on 2026-10-10.
- Built the merge of `feature/collab` into `main` in a throwaway worktree and ran the full
  suite against that result.
- Read the unflagged server paths in full (`db.js`, `sync.js`, `index.js`, `websocket.js`,
  `revision.js`, `pdf.js`, `image.js`, `spaceStorage.js`) and the core of the client sync
  path (`syncStore.js` sync/apply/registry sections, `syncMerge.js`, `syncRegistry.js`,
  `databaseKey.js`, `scopedRepository.js`, `crsqlitePk.js`, `docStore.js` save path,
  `draftStore.js`, the editor's remote-change handling).
- Ran an isolated stack (own ports, own Docker volumes, disposable account) and drove it with
  scripted headless Chromium, one persistent browser profile per "device". The same server
  data and the same browser profiles were taken main → merged → main → merged.

- Afterwards used a real Chrome tab group (the extension had not been connected earlier) for
  a pass on the merged build: folder import with linked images, preview rendering, and PDF
  export. The folder picker was pointed at a folder prepared in the browser's private file
  system, so the real import code ran without a native dialog.

Not reviewed line by line: the rest of `Editor.vue` and `structureStore.js`,
`conflictStore.js`, `importExportStore.js`, the remaining stores, `shared/contentMerge.js`,
and every flag-gated module (`spaces.js`, `spaceTransfer.js`, `collab.js`).

## Changes Made

None to product code. This log only.

## Tests

Automated, against the trial merge (not the branch tip alone):

- Frontend 50 files / 519 tests, shared 25 tests, backend (Node 24 Docker) 26 files / 309
  tests: all passed. `npm run lint` and the frontend production build passed.

Browser checks, flags off, personal documents only:

| Check | Result |
|---|---|
| Upgrade main → merged on the same server data (volume remounted at the new path) | Passed. Server databases migrated; `_spaces.db` created; no errors logged. |
| Device with an unsynced offline edit carried across the upgrade | Passed. Edit kept and uploaded; legacy clock key migrated. |
| Rollback merged → main on migrated server and client data | Passed. Documents intact, sync and revision routes work; the client re-syncs from clock 0. |
| Same document open on two devices, one types | Improved. The second device's editor now updates; on main it stays stale. |
| Session becomes invalid while the app is open | Regressed. See finding 1. |
| Concurrent offline edits to different parts of one document | Not protected. See finding 2. |
| First open of a stale device after the upgrade | False conflicts when the new code performs the first sync. See finding 3. |
| Folder import with linked images on the merged build (real Chrome) | Passed. Document created, existing image uploaded and its link rewritten, image renders in preview, missing and external links left alone. |
| PDF export with an uploaded image (real Chrome) | Relative `/api/images/<id>` path: embedded. Absolute URL with no matching configured origin: image removed. See finding 7. |
| Fresh device signs in and creates one document, on main's client and server | Fails on main. The document never uploads. See finding 4. |

Not run: any flag-enabled behaviour, a production build with its real service worker update
cycle, mobile viewports, the native directory picker itself, and anything against
production data.

## Open Items / Notes

Findings, most severe first.

1. **Regression: an invalid session is silent and retries forever.** On main the client
   shows "Your session has expired. Please log in again to sync.", disables sync, and stops
   reconnecting. On the merged build there is no notice, the bar still reads "Sync On", and
   the WebSocket reconnected 22 times in 20 seconds (close 1008, "Invalid token"). The
   handling was dropped when `sync()` was restructured into `syncDatabase()`;
   `hasShownAuthWarning` is now only ever reset.
2. **The content-merge feature does not protect concurrent offline edits.** Two devices
   offline, each editing a different part of one document, then reconnecting: one edit was
   discarded on both devices with zero rows in `note_conflicts` and no notice (2 of 2 runs).
   The discarded text was not in the server's revision history. Cause:
   `docStore.updateFileContent` writes `note_sync_base` on every local save, so the base
   already contains the device's own unsynced edit and the incoming version is classified as
   "adopt theirs". The spec says the base is written only when client and server agree. Main
   loses one side in the same scenario, so this is not a regression, but the feature's stated
   guarantee is not met.
3. **Upgrade creates false conflicts.** A device that had never edited anything, opened for
   the first time on the new code, recorded a conflict for each document changed elsewhere
   since its last sync (2 of 2 documents) and showed "Some document changes need your
   review" with a Resolve action. This did not occur on two other stale devices whose first
   sync was performed by the previously cached app before it updated itself; how often each
   path occurs with the production service worker was not measured.
4. **On main today: a write can be stranded and never uploaded.** The upload query selects
   `db_version > clock`, and one stored clock serves as both the server cursor and the local
   cursor. When a sync both pushes local changes and the server was already ahead, the
   returned clock lands on the version the device's next transaction will use, and that
   transaction is never selected. Reproduced on main's own client and server: a fresh device
   signed in to an account with existing documents and created one document; after four
   syncs and an explicit one it was absent from the server (local version 57, clock 57).
   After typing in it, the server held only `content` and `updated_at`; `title`,
   `created_at`, `user_id`, `folder_id` and `pinned` never arrived. Also seen on the merged
   build in real Chrome: an imported document never uploaded while its image did, leaving the
   server reporting the image with zero usage, which makes it a candidate for the orphan
   image prune. In a separate run two devices kept different text for one document with no
   conflict recorded. The merge-base logic on the branch assumes client and server agree
   after a successful sync, which this breaks.
5. **New per-account limit of 10 WebSocket connections.** An eleventh connection is closed
   with 1008 and the client retries once a second indefinitely with no notice. Found by
   accident when the test profile accumulated restored tabs.
6. **No server switch for automatic merge.** `/sync` responses contain `changes`, `clock` and
   `skipped` only; the client's `contentMergeWriteback` can never become true.
7. **PDF export drops images whose absolute URL does not match a configured origin.**
   Confirmed: with `INTERNAL_API_URL` and `PUBLIC_API_BASE_URL` unset, an absolute image URL
   was treated as external, blocked by the SSRF check and removed. Main resolves any URL
   containing `/images/<uuid>`. Relative production-style paths still embed. Production
   needs `PUBLIC_API_BASE_URL` set to the public origin for absolute links to keep working.
8. **On main since April: the import result is never readable.** A successful import reloads
   the page immediately after queuing its toasts, so "Import complete" and the "Skipped N
   item(s)" warning disappear at once. A missing or oversized linked image is skipped
   without the user seeing why.
9. From code reading, not exercised: database open is now fail-closed (`ensure*Schema` and
   `ensureCrr` throw); `docs/runbooks/sync-incident-response.md` and
   `scripts/repair-orphan-image-clocks.mjs` still reference `DB_DIR=/app/data`, which no
   longer exists in the container (confirmed absent in the merged image).

Withdrawn during the work: an early observation that an open editor never receives remote
edits, and a server-side connection leak. Both were artifacts of the test profile restoring
extra tabs; they did not reproduce once each device was a single tab.

Gate A verdict: not passed. Findings 1 to 3 should be resolved or consciously accepted
before merge. Finding 4 is live on main, is independent of the merge, and is the most
serious item here; finding 8 is also on main.

Left behind for inspection, all stopped: containers `panino-gatea-api` and
`panino-gatea-api-main`, volumes
`panino-gatea-data` and `panino-gatea-uploads`, images `panino-gatea-main` and
`panino-gatea-merged`, and two detached worktrees plus browser profiles and the scenario
scripts in the session scratchpad. None of it touches the normal dev stack or its data. The Chrome profile used for the real-browser pass still holds local site data
for `http://localhost:15173` (the test account was logged out; no token remains).

Follow-up: the fixes for findings 1 to 9 are recorded in
`2026-10-10_10-05_sync-upload-cursor.md` (the two defects on `main`) and
`2026-10-10_10-40_collab-readiness-fixes.md` (the branch).
