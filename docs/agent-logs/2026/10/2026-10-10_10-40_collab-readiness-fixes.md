# Collaboration branch readiness fixes

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-10 10:40 (+02:00)
- Status: complete for the flag-off gate; production-copy drill and flag-on gates remain

## Objective

Fix the defects found by the merge-readiness assessment
(`2026-10-10_09-07_collab-merge-readiness.md`) so that `feature/collab` can pass the first
review gate: nothing breaks, and nothing is lost, for existing users with both feature flags
off.

## Progress

- Merged `fix/sync-stranded-writes` into `feature/collab`. That also brings in `main`'s
  document folder import, so the branch is now tested as it would land.
- The upload-cursor fix from `main` did not apply to the rewritten sync store and was
  re-implemented per database.
- Investigating the content-merge defect showed the one-line cause (base written on local
  save) was not the whole problem. A replica whose upload wins on the server never received
  the body it overwrote, so no client-side rule could preserve it. The server reply was
  reordered to make the rule possible. See `docs/architecture/crsqlite-sync.md`.
- While writing the server test, sending a key in a form the server does not decode aborted
  the test worker. A malformed primary key reaches CR-SQLite's native unpacking, which aborts
  the process. This exists on `main` as well. Keys are now validated before the merge.

## Changes Made

Client (`frontend/`):

- `store/syncStore.js`: per-database push cursor; remote bodies classified by
  `planRemoteContent`; base recorded on adoption and on acknowledged upload; held conflicts
  kept across later adoptions; session-expiry message, sync off and no reconnect when the
  session cannot be refreshed; reconnect backoff; a one-time notice and a slow retry when the
  per-account connection limit refuses a tab; writes to local-only tables no longer schedule a
  sync.
- `utils/syncMerge.js`: `planRemoteContent`, `resolveServerValue`, `supersedes`.
- `utils/syncRegistry.js`: push cursor keys, legacy cursor migration, `reconnectDelayMs`.
- `store/docStore.js`, `store/conflictStore.js`: no longer write the merge base.

Server (`backend/api-service/`):

- `sync.js`: reads other replicas' changes before merging the upload; validates every packed
  primary key before the first row is merged (`400 INVALID_CHANGE`); sends
  `contentMergeWriteback` from `CONTENT_MERGE_WRITEBACK_ENABLED`.
- `pdf.js`: absolute links to the user's own images are also recognised on `FRONTEND_URL`.
- `docker-compose.yml`, `docker-compose.dev.yml`: `CONTENT_MERGE_WRITEBACK_ENABLED`, default
  false.

Docs: sync architecture, `/sync` contract, deployment flags, incident runbook paths (the
database directory in the container is `/app/backend/api-service/data`), and an amendment
section in the COLLAB-02 spec.

## Tests

- `npm run lint`: 0 errors. `npm run test:shared`: 25 passed.
- `npm run test:fe`: 54 files / 593 tests passed (519 before this work).
- `npm run test:be` (Node 24 Docker): 27 files / 321 tests passed (309 before).
- Frontend production build: passed.

Two-device checks in real Chromium profiles, isolated stack, disposable accounts. Devices were
prepared on the original `main` build and then opened on the fixed build:

| Scenario | Before | After |
|---|---|---|
| Stale device, first sync after upgrade, never edited anything | Conflict for each document changed elsewhere | Adopts the remote edit, no conflict |
| Device with an edit that never uploaded, competing edit on the server | Devices diverged silently | Edit uploads; conflict holds both bodies; review prompt shown; all copies converge once resolved |
| Concurrent offline edits, switch off, later upload wins | One edit gone, no conflict | Conflict on the later device holds both; prompt shown |
| Concurrent offline edits, switch off, later upload loses | One edit gone, no conflict | Conflict on the later device holds both; prompt shown |
| Concurrent offline edits, switch on, both orders | Not possible to enable | Both edits in both documents, both editors and the server; no prompt |
| Session invalidated while open | No message, "Sync On", 22 reconnects in 20 s | Message shown once, sync off, one refused socket and no retry |
| Fresh device creates one document | Never uploaded | On the server within six seconds |
| Same document open on two devices, one types | Second editor updates | Unchanged |
| Rollback to the original `main` client and server | Works | Works; documents intact, edits upload |

## Open Items / Notes

- **Not pushed.** Commits are local on `fix/sync-stranded-writes` and `feature/collab`.
- **Production-copy drill not run.** Database open on the branch is fail-closed and every
  database gains two `note_revisions` columns and an `application_schema` table. This needs
  the restore tooling, a fresh backup and approval before merge.
- **Merge order.** `fix/sync-stranded-writes` can ship to `main` on its own; the branch
  already contains it.
- **First sync after release** re-offers every change a device authored, in batches of at most
  500. The server may record one first revision snapshot per document that had none.
- **Residual loss case.** An edit stranded by the old upload logic that is also older (lower
  column version) than a competing server edit is overwritten on first sync, as it would have
  been before. Nothing local distinguishes it from a stale synced copy.
- **Single conflict slot.** A second conflict on a document that already has an unresolved
  one replaces the held local body.
- **Not exercised:** shared spaces and live sessions (flags on), a production build with its
  service worker update cycle, mobile viewports.
- The COLLAB specs are still under `docs/specs/proposed/` with `Status: proposed`.
