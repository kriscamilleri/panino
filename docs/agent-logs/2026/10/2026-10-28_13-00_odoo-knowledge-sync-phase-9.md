# Odoo integration — Phase 9: sync to Knowledge

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 13:00
- **Status:** Done (personal databases; spaces are Phase 10)

## Objective

Phase 9 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md) §11:
keep a folder or a single Document mirrored into Odoo Knowledge, one way, with change
detection, archiving, read-only articles, a scheduler and a status card.

## Progress

- The spec's §11 API table was empty; it is now filled in (`GET/POST /addons/odoo/syncs`,
  `POST …/:id/run`, `DELETE …/:id`, and `sync` on `GET /addons/odoo/links`).
- `odooConnection.js` takes the connection helpers out of `odoo.js` so the scheduler can run
  with a person's connection without importing the routes.
- `odooSync.js`: `syncTree` walks the folder subtree (or the Document) level by level with
  siblings in title order; `runSync` hashes name + parent + body + order, creates a level with
  one `create` call (falling back to one by one when a record is refused, so the others still go
  through), writes only changed records, adopts a hand-sent article, archives what left the tree
  and restores what came back, gives root articles `internal_permission: 'read'` with the runner
  as write member, uploads images after the body, records per-record failures, and pauses the
  sync on a rejected key. The daily reconcile also compares Odoo's side (name, parent, order,
  active) and re-archives what someone unarchived there.
- `odooSyncScheduler.js`: a run three minutes after the last `/sync` change (restarted by more
  changes), Sync now, daily reconcile, one job per sync, 60 calls a minute per Odoo target,
  pause and resume from the add-on hooks, connect and disconnect.
- Frontend: `OdooSyncsCard` (desktop and phone Settings) and the send sheet's Keep in sync.
- Two test expectations needed thought: moving a Document into a subfolder also reorders its
  old and new siblings (three updates, not two), and a batch create that fails must not record a
  failure for the record the fallback then creates.

## Changes Made

- Backend: `odooSync.js`, `odooSyncScheduler.js`, `odooConnection.js` (new); `odoo.js` (routes,
  add-on hooks, connect/disconnect pause-resume, `synced` refusal, `sync` on links),
  `odooLinks.js` (`sync_id`, `content_hash`, `archived_at`, `source_type`), `db.js`
  (`odoo_syncs`), `sync.js` (schedule after changes, daily reconcile), `tests/fakeOdoo.js`
  (article order, active, permissions, refused names), `tests/integration/odooSyncs.test.js`
  (new, 12).
- Frontend: `OdooSyncsCard.vue` (new), `OdooSendModal.vue`, `SettingsPage.vue`,
  `PhoneSettingsPage.vue`, `odooStore.js`, `tests/unit/odooSyncsCard.test.js` (new, 5),
  `tests/unit/odooSendModal.test.js` (+2).
- Docs: spec §11 API and Phase 9 ✅; both handbooks.

## Tests

- Docker: `odooSyncs` 12, with the other Odoo files 62 passing together; `npm run test:be`:
  45 files, 639 tests passed.
- Frontend Odoo tests: sync card 5, send modal 20; `npm run test:fe`: 77 files, 944 tests
  passed. `npm run lint`: clean.
- Headless browser check against the real local Odoo 20 Enterprise
  (`scratchpad/sync-browser.mjs`): folder made in the app with two Documents, Add sync in
  Settings → both articles at Knowledge's top level, read-only, in title order, checklist
  intact; an edit plus Sync now rewrote the article; Keep in sync from the send sheet made the
  standalone Document an article and the sheet shows it as synced; phone Settings lists both
  syncs without overflow. 14/16: the status line read "Syncing now…" right after Sync now
  because a finished job was still reported as running (fixed: `finishedAt` on the job), and
  one "page error" was the script's own localStorage write on `about:blank`.
- Trap: the dev stack keeps `/app/shared/node_modules` in an anonymous volume, so the new
  shared dependencies needed `docker compose … up -d --build -V api-service`; noted in the
  backend handbook.

## Open Items / Notes

- `GLOBAL_DATE` and `GLOBAL_TIME` in a synced article use the server's locale, not the
  person's browser locale.
- Spaces (Phase 10): the scheduler's pause/resume only looks at the person's own database so
  far; space settings UI, owner/editor rules and take-over are next.
