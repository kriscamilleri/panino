# Fixes from the pre-merge review of feature/odoo-sale-order-blocks

- Agent: Claude Code (Opus 5.5), review by an Opus 5.5 subagent
- Start: 2026-10-29, approximately 23:00
- Status: Implemented and verified locally; not merged into develop, not pushed

## Objective

Before consolidating the feature branches into `develop`, Kris asked for an independent code
review of `feature/odoo-sale-order-blocks` (the Odoo integration, the add-on framework and the
GitHub backup add-on), then for every necessary amendment.

## Progress

- **Branch survey.** Only two branches carry work `develop` lacks: this one (22 commits ahead,
  0 behind `origin/develop`, containing `feature/odoo-integration`, `docs/odoo-integration-spec`
  and the merged PDF hardening) and `docs/collab-deploy-log` (two 2026-10-11 deploy logs, rebased
  onto `origin/develop`). Local `develop` moved up to `origin/develop` (it was 9 behind). The rest
  are merged, patch-equivalent or superseded; `printheaders` is 2025 WIP and left alone. A trial
  merge of both into `origin/develop` was clean.
- **Review finding 1 (my error):** `git add -A` had committed untracked files that were not part
  of the work, among them `panino-upload/` (another client system's screenshots and change
  summary) and a 4 MB PDF. The commit was unpushed; amended with `git rm --cached`, files left on
  disk untracked. Kris to decide whether the PDF, `docs/code-reviews/` and the 2026-10-28
  code-review log belong in the repository.
- **Verified the reviewer's sync findings against the code** before fixing: the batch-create
  early return (2), the dropped `already-running` trigger (3), no sync re-check mid-run (4), and
  `void runSyncNow` with no handler and no `unhandledRejection` listener (5).

## Changes Made

Odoo (`backend/api-service/addons/odoo/`):
- `sync.js`: every id a batch `create` returns is linked (pending) before any record is finished
  (2); the run re-reads its sync before each record and stops with `interrupted` when it is gone,
  paused or switched off, and links pointing at a removed sync are adopted like a manual send's
  (4); dead conditional removed.
- `syncScheduler.js`: a `changes` trigger, or a manual one while running, sets `rerun` and one
  more run follows the current one (3); `runSyncNow` catches and logs everything, never rejects
  (5); space syncs read only images whose link names a space, for Knowledge uploads and filed
  PDFs (`imageReaderFor`, `withoutPersonalImages`) (12).
- `routes.js`: `POST /syncs/:id/run` answers `202 { started, queued, sync }` at once (8).
- `knowledge.js`: `ALLOW_DATA_ATTR: false` (7).
- `saleOrderBlocks.js`: the field catalog cache is keyed by target and Odoo uid (13).
- Frontend `OdooSyncsCard.vue`: after Sync now, polls `GET /syncs` until the run ends, then toasts.

GitHub (`addons/github/`):
- OAuth `state` was not tied to the browser (6). The callback now parks the code under a
  single-use, 10-minute handle and stores nothing; `POST /addons/github/complete` (behind the
  gate) finishes it only for the user the state names, 403 `other_account` otherwise.
- Fixed messages everywhere (`githubFailureMessage`): responses, the redirect, stored
  `last_error` (10).
- Return query is now `?addon=github&addonResult=…&addonMessage=…&handle=…`; the card completes
  a pending connection before opening the dialog.

Core:
- `frontend/src/composables/useAddonReturn.js`, used by both Settings pages: shows an add-on
  return's message while the add-on is off, when its card is absent (11).

Item 9 (the OAuth callback URL change) is a deploy step, already documented.

## Tests

- New: batch create stopping on the first record (no duplicates on the next run), an edit during
  a run (one more run writes it), a sync removed mid-run (stops; a new sync adopts its
  Documents), `runSyncNow` resolving on a bad database key, data attributes stripped, the
  catalog per Odoo user, space-sync image rules, the hijack case (the victim's session gets 403
  and nothing is stored on either account, and the handle is single-use), unknown handle,
  fixed messages for a GitHub failure and a failed backup, `useAddonReturn`, the card's pending
  and error returns, the store's `completeConnect`, the card polling a 202 run.
- The four sync tests were also run against the committed `sync.js` and `syncScheduler.js`:
  all four fail there and pass with the fixes.
- `npm run lint`: clean. `npm run test:be` (Docker): 53 files, 721 tests passed.
  `npm run test:fe`: 84 files, 1041 tests passed. Exit codes checked directly.
- Browser (Claude in Chrome, dev stack, API restarted): `/addons/github/callback` with a forged
  state and with `error=access_denied` redirects with fixed messages; with the add-on off,
  Settings shows the message and clears the query; with it on, the card shows it and opens the
  dialog. Dev user's switch restored to off. The real GitHub authorize round trip was not run
  (it would call github.com); the complete step is covered by the integration tests.

## Open Items / Notes

- Before deploying: update the GitHub OAuth app's callback URL to
  `https://panino.sh/api/addons/github/callback`.
- Parked GitHub connections are in memory: a restart within the 10 minutes drops them.
- Folder articles of a removed sync are still not adopted by a new sync of the same folder
  (design since deleteSync shipped; only Documents are adopted).
- Untracked on disk, not committed: `panino-upload/`, `docs/specs/shipped/mobile-ui/panino-mobile-ui-screens.pdf`,
  `docs/code-reviews/`, `docs/agent-logs/2026/10/2026-10-28_11-35_odoo-integration-code-review.md`.
