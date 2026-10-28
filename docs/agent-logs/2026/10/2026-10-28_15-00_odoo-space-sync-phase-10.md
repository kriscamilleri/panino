# Odoo integration — Phase 10: space sync

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 15:00
- **Status:** Done

## Objective

Phase 10 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
whole-space syncs and syncs of space folders and Documents, space settings, owner/editor
rules, pause and take-over.

## Progress

- Probed both local Odoo instances: `has_access(operation)` is public through JSON-2 on 19 and
  20 and answers `true`/`false`, so a take-over can check write access on the sync's articles
  without writing anything.
- Backend: `POST /addons/odoo/syncs` accepts `scope: 'space'` for a `space:` key (the top
  level's folders and Documents become the roots); `POST …/:id/take-over` switches `run_as` to
  the caller after `has_access('write')` on the sync's articles (`403 access_denied` otherwise,
  `409 different_odoo` when their Odoo is another one) and runs at once. The scheduler checks
  at run time that the runner is still an owner or editor of the space and pauses with
  `left_space` otherwise; pause and resume now cover the runner's spaces as well as their own
  database. The fake Odoo got a second user (`OTHER_API_KEY`), a write-denial switch and
  `has_access`.
- Frontend: `OdooSyncsCard` space mode ("The whole space" in Add sync, "Syncing as …", Take over
  for syncs run by someone else); the Spaces page shows it to owners and editors when their
  Odoo add-on is on, with a hint otherwise; `odooStore.takeOverSync`.

## Changes Made

- `backend/api-service/odoo.js`, `odooSyncScheduler.js`, `tests/fakeOdoo.js`,
  `tests/integration/odooSpaceSyncs.test.js` (new, 5).
- `frontend/src/components/OdooSyncsCard.vue`, `pages/SpacesPage.vue`, `store/odooStore.js`,
  `tests/unit/odooSyncsCard.test.js` (+1).
- Docs: spec §11 API rows and Phase 10 ✅; `frontend/AGENTS.md`.

## Tests

- `npm run test:be`: 46 files, 645 tests passed (space syncs 5, syncs 13 including the Phase 11
  image test). `npm run test:fe`: 77 files, 945 tests passed. `npm run lint`: clean.
- Two test fixes along the way: the owner in the whole-space test never had the add-on on, so
  the gate answered 403 (the test now switches it on), and `listSpacesForUser` returns
  `{ spaces, membershipVersion }`, which the scheduler iterated as if it were the array, so
  pausing never reached the spaces.
- Browser (`scratchpad/space-sync-browser.mjs`, headless, real Odoo 20 Enterprise): the dev
  stack runs with `SHARED_SPACES_ENABLED` off, so the API container was recreated with the
  flag on for the check and put back afterwards. The owner's Spaces page shows the hint while
  the add-on is off, the "Sync to Odoo Knowledge" section once it is on, Add sync offers "The
  whole space", the whole-space sync is listed as run by "you" with no take-over button, and the
  server lists it active. 9/10: the one miss is the script's own localStorage write on
  `about:blank`.

## Open Items / Notes

- A space sync's `GLOBAL_DATE`/`GLOBAL_TIME` and global variables come from the space's own
  `globals` table, which the space may not use.
