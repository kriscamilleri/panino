# Odoo integration — Phase 4: PDF to an opportunity or sales order

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 07:30
- **Status:** Done

## Objective

Implement Phase 4 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
send a Document's PDF to the chatter of a CRM opportunity or a sales order as an internal note,
with a record picker, overwrite on resend plus a "replaced" note, and the ownership rules of §6.

## Progress

- Verified the record URL form before writing code: logged into the local Odoo 19 headlessly;
  `/odoo/crm.lead/1` and `/odoo/sale.order/1` open the record forms (`/odoo/m-crm.lead/1` redirects
  to the same). Recorded in spec §4.
- Backend: `odooChatter.js` (`searchRecords`, `readRecords`, `sendPdfToChatter`,
  `parseChatterTarget`, `recordUrlPath`), `GET /addons/odoo/records`, `/send` extended to take
  `documents` and/or `chatter`, rendering the PDF once and reporting per destination through a
  shared `destinationResult` helper. `CHATTER_MESSAGES` for the user-facing codes.
- Extracted the fake Odoo of `odooSend.test.js` into `tests/fakeOdoo.js` and taught it
  `ir.attachment`, `crm.lead`, `sale.order`, `message_post` (relinks staged attachments, answers
  `[message id]`), a `failNotes` switch and an `apps` list; `odooSend.test.js` now imports it.
- Frontend: `odooStore.fetchRecords`, the send sheet's "PDF to an opportunity or sales order"
  section (checkbox, internal-note notice, search over reference/name/customer, sent-to records
  first with "Sent … by …", per-destination result alerts, "Update in Odoo" only when every
  chosen destination updates).
- Browser check against the real local Odoo 19 Community (CRM + Sales, no Documents) through the
  dev stack, headless Puppeteer: desktop 1280px first send, Odoo-side verification of the note
  (subtype Note, type comment, PDF attachment on the lead, 29 KB), resend → "replaced" note with
  no attachment and the same attachment id; phone 375px Document menu → Send to Odoo → sales
  order, no horizontal overflow. Reruns against the same Odoo correctly add a new note per new
  Panino user, which makes the count assertions of the script fail on a second run; the first
  run was clean.

## Changes Made

- `backend/api-service/odooChatter.js` (new), `odoo.js` (records route, send route, messages,
  `senderConnection.apps`), `tests/fakeOdoo.js` (new), `tests/integration/odooChatter.test.js`
  (new, 13 tests), `tests/integration/odooSend.test.js` (uses the shared fake).
- `frontend/src/store/odooStore.js` (`fetchRecords`), `frontend/src/components/OdooSendModal.vue`
  (chatter section, per-destination results), `frontend/tests/unit/odooSendModal.test.js`
  (13 tests).
- Docs: spec Phase 4 ✅ and the record-URL row in §4; `backend/api-service/AGENTS.md` and
  `frontend/AGENTS.md` module rows.

## Tests

- `./scripts/test-backend.sh tests/integration/odooSend.test.js tests/integration/odooChatter.test.js`:
  27 passed (one assertion fixed: the same content renders to byte-identical PDFs, so the resend
  check now looks at the renamed attachment instead of changed bytes).
- `npm run test:fe`: 74 files, 924 tests passed.
- `npm run test:be`: 40 files, 601 tests passed.
- `npm run lint`: clean.
- Headless browser check (`scratchpad/chatter-browser.mjs`, desktop + phone, real Odoo 19):
  first run 20/20 desktop checks before a phone click failed on the PWA install prompt; after
  clicking the menu through the DOM, the phone part passed; the remaining failures on reruns
  are note counts from earlier runs and the pre-existing `/spaces` 404 in the dev stack.

## Open Items / Notes

- Odoo escapes HTML in `message_post` bodies, so the notes are plain text (as in Phase 0).
- The picker shows at most 10 opportunities and 10 orders per query, newest change first.
- Phase 5 (Article to Knowledge) is next; it needs the local Odoo 20 Enterprise (Knowledge).
