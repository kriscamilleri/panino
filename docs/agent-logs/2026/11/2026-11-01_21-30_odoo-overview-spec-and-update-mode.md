# Odoo overview spec, and Update mode for the Send dialog

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-01, approximately 21:30
- Status: Spec written (proposed); Phase 2 implemented and verified locally on
  `feature/addons-menu`; not committed

## Objective

Kris asked how to keep the Odoo UI manageable once 20–30 or more Documents are sent or synced,
without adding complexity. After the recommendation (one overview list, an Update mode for the
Send dialog, Refresh all for sales order blocks), Kris approved including space Documents other
members sent, and writing the spec first.

## Progress

- Read the Odoo routes, `odoo_links` schema, sync payloads and the Send dialog. Findings that
  shaped the spec:
  - `GET /links` is per Document; nothing lists links across Documents or databases.
  - `notes.updated_at` moves on pin (docStore), so it cannot tell "changed since sent". The spec
    stores a content hash per manual send (`sent_hash`), with an `updated_at` fallback for old links.
  - Sending to an opportunity or sales order again posts a "replaced" note (`chatter.js`), so
    bulk Send updates excludes chatter.
  - The browser builders render only the selected Document; sync already renders on the server,
    so bulk resend renders there, after `syncStore.sync(dbKey)`.
  - Add-ons cannot add routes, so the overview is a wide add-on modal, not a page.
- Wrote `docs/specs/proposed/odoo-overview.md`.
- Implemented Phase 2 while the spec is reviewed.

## Changes Made

- `frontend/src/addons/odoo/components/OdooSendModal.vue`: when the Document already has a
  Documents record, or a Knowledge article no sync looks after, on the caller's Odoo, the dialog
  opens on a summary: where it is, last sent and by whom, Open links, **Send update**, and
  **Change where it goes** (the full form, those destinations ticked). Send update sends to
  those records only, never to opportunities or sales orders. Whether the summary shows is decided
  when the dialog opens, so a first send stays on the form.
- `frontend/src/addons/odoo/tests/sendModal.test.js`: the two "updates … sent before" tests
  rewritten for the summary; new tests for Change where it goes (and reopening), chatter-only
  links, a synced article with a PDF, and staying on the form after a first send.
- `docs/specs/proposed/odoo-overview.md`: new.

## Tests

- `npx vitest run src/addons/odoo/tests/sendModal.test.js`: 24 passed.
- `npm run lint`: clean. `npm run test:fe`: 86 files, 1056 tests passed.
- Headless Chromium (`scratchpad/odoo-update/check.mjs`) against the dev stack and local Odoo 20
  Enterprise, throwaway account: first open shows the form; first send "Sent to Odoo Documents."
  and the form stays; reopening shows the summary with Send update and a `_blank noopener
  noreferrer` link; Send update → "Updated in Odoo Documents."; Change where it goes shows the form
  with Documents ticked; the phone Document menu opens the same summary; no page errors. 11/11.
  The first run was 10/11: it caught the dialog flipping to the summary right after a first
  send, which is now fixed and covered by a unit test.

## Open Items / Notes

- Phases 1 (overview, `GET /overview`, `POST /resend`, `sent_hash`) and 3 (Refresh all) wait on
  review of the spec.
- Throwaway dev accounts `odoo-update-<timestamp>@example.test` remain, connected to the local
  Odoo, with a "Q3 proposal" PDF each in Odoo Documents.
- `feature/addons-menu` now holds three uncommitted pieces of work: the Add-ons menu, sidebar
  spaces and My Notes, and this one. They touch separate files, so they can be committed separately.
