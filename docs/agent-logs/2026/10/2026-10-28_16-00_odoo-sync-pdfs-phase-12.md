# Odoo integration — Phase 12: PDFs in syncs

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 16:00
- **Status:** Done

## Objective

Phase 12 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
a sync may also file a PDF of each Document in an Odoo Documents folder, opt-in, rendered on
the server at lower priority than interactive exports, built the way the browser's Export
builds it.

## Progress

- Shared package: `styleDefaults.js`, `stylePresets.js` (named styles and their resolution),
  `pdfRequest.js` (`buildPdfRequest`, `normalizePaperSize`) and `styledRenderer.js`
  (`applyStyleMap`: the inline styles and external-link attributes the Preview and Export put
  on elements) moved out of the frontend, which re-exports them; `markdownStore.configureRenderer`
  now builds on `applyStyleMap` and only adds the image auth token. Shared tests cover the
  styled renderer, the request builder and style resolution.
- `pdf.js`: a low-priority lane; `renderPdf(payload, { userId, priority: 'low' })` runs only
  while no interactive export is queued.
- `odooSyncPdf.js`: `buildSyncPdfRequest` resolves a Document's print style (its front matter,
  the nearest folder default, else the account's saved print styles over the defaults), renders
  with the shared renderer and inline styles, builds the request and a hash of what the PDF
  depends on (title, content with the date and time variables blanked, CSS, print styles).

- Engine: `runSync` takes `renderPdf`; after a note's article is settled (created, updated or
  unchanged) `filePdf` builds the request, compares its hash with the Documents link's
  `content_hash` and, when different, renders and files the PDF through `sendPdfToDocuments`
  (same overwrite-in-place and ownership rules as a manual send), marking the link with the
  sync id and the hash. A lost PDF is a failure with `pdf: true` and never stops the articles.
  The scheduler passes a low-priority `renderPdf` only when the sync has a Documents folder.
- Routes: `documentsFolderId` on `POST /addons/odoo/syncs`, checked with
  `documents.document/read` and the Documents app; `documentsFolderId` in the payload.
- Card: "Also file a PDF of each Document in Odoo Documents" with a folder search in Add sync,
  a row line when a sync files PDFs, and "N PDFs filed" in the status line.
- A quirk found by the browser check: a new sync's `last_reconcile_at` was empty, so the daily
  reconcile ran right after the first `/sync`, and a later manual Sync now found nothing left.
  `createSync` now stamps the first reconcile as done at creation.
- The fake Odoo answers `documents.document/read` for its two demo folders, which the route's
  folder check needs.

## Changes Made

- Shared: `styleDefaults.js`, `stylePresets.js`, `pdfRequest.js`, `styledRenderer.js` (new),
  `package.json` exports, `tests/markdownRender.test.js` (+3).
- Frontend: `utils/styleDefaults.js`, `utils/stylePresets.js`, `utils/pdfExport.js` (re-exports),
  `store/markdownStore.js`, `components/OdooSyncsCard.vue`, `tests/unit/odooSyncsCard.test.js` (+1).
- Backend: `odooSyncPdf.js` (new), `odooSync.js`, `odooSyncScheduler.js`, `odoo.js`, `pdf.js`
  (low-priority lane), `tests/fakeOdoo.js`, `tests/unit/odooSyncPdf.test.js` (new, 2),
  `tests/integration/odooSyncPdfs.test.js` (new, 3).
- Docs: spec Phase 12 ✅ and the route row; both handbooks.

## Tests

- `odooSyncPdf.test.js` (unit, Docker): 2 passed; `odooSyncPdfs.test.js` 3 passed with the
  send and sync files. Shared suite: 49 passed. `npm run test:be`: 48 files, 650 tests passed; `npm run test:fe`: 77 files, 946 tests passed; `npm run lint`: clean.
- Browser (`scratchpad/pdf-sync-browser.mjs`, headless, real Odoo 20 Enterprise): Add sync
  with "Also file a PDF" and a Documents folder → "2 created, 2 PDFs filed"; Odoo Documents
  holds one `application/pdf` per Document (37 KB and 29 KB) in that folder; an edit plus a
  run rewrote the article and overwrote the PDF in place (still one PDF). 15/16; the miss was
  the reconcile quirk above, fixed afterwards.

## Open Items / Notes

- PDFs of deleted or moved-out Documents stay in Odoo Documents (Panino never deletes there).
- Server-rendered PDFs use the server's locale for `GLOBAL_DATE` / `GLOBAL_TIME`.
