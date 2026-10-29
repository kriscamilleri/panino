# Odoo sync: fixes for the three review findings

- Agent: Claude Fable 5.1 (Claude Code)
- Start: 2026-10-29 09:30 Europe/Malta
- Status: complete

## Objective

Resolve the three P2 findings in [`docs/code-reviews/2026-10-28-odoo-integration.md`](../../../code-reviews/2026-10-28-odoo-integration.md)
(reviewer: Codex, against `5c538dc`), all in sync recovery:

1. a link stored its content hash before the image write, so a failure after the article was
   created left it with placeholders forever;
2. the daily reconcile never read the article body, so a body-only edit in Odoo stayed;
3. `filePdf` trusted a matching hash during the reconcile too, so a PDF deleted in Odoo was
   never refiled.

## Progress

- Wrote the regression tests first (my own versions of the reviewer's patch, in the existing
  suites, with the extra cases the review asked for) and ran them on the unfixed code: all three
  failed at their behavioral assertions, as the review reported.
- Fixed the sync module, ran the Odoo suites, then the full backend suite and lint.
- The reviewer's patch file and review were left as they are; the tests here supersede the patch.

## Changes Made

- `backend/api-service/odooSync.js`
  - `completeArticle`: the link is saved with `hash: null` (pending) before the images go up and
    with the real hash only after the final body write succeeds with no refused upload.
    `finishCreate` saves the article's identity before even the `read` after `create`, so a
    failure anywhere after `create` never makes a second article. `updateArticle` returns
    `{ outcome, images }`.
  - An upload Odoo refused is reported as `images_failed` (with `images: n`) on the record and
    the record stays pending, so the next run retries. An image Panino cannot read stays a
    placeholder and does not hold the record back (unchanged from Phase 11).
  - Daily reconcile: for a complete, locally unchanged record the `read` also fetches `body`
    and compares `bodySignature(theirs) === bodySignature(ours)`; a difference rewrites.
  - `filePdf`: a matching hash is still the fast path on ordinary runs; on the daily pass the
    linked `documents.document` is read first and the PDF is re-rendered and refiled when the
    record is gone or has another `create_date`. A failed repair is a `pdf: true` failure and
    never stops the articles.
- `backend/api-service/odooKnowledge.js`: `bodySignature(html)` — tags, the attributes Panino
  sets, text with whitespace collapsed; Odoo's `data-*`/editor attributes, `/web/image/<id>`
  ids, placeholders for Panino images, `<br>` and empty `p`/`div`/`span` are ignored, and
  `false` (Odoo's empty html) equals `''`.
- `backend/api-service/odooArticleImages.js`: `uploadArticleImages` returns `failed` (the part
  of `missing` that Odoo refused).
- `backend/api-service/tests/fakeOdoo.js`: `failAttachmentCreates` and `failArticleWritesOnce`.
- Tests: `odooSyncs.test.js` (+2: body/emptied/equivalent body on reconcile; pending article
  after a failed write and after a refused upload, same article id, hash only when complete),
  `odooSyncPdfs.test.js` (+1: deleted PDF, replaced record, nothing to do when still there,
  failed repair reported as a PDF failure), `tests/unit/odooKnowledge.test.js` (+2 for
  `bodySignature`), `tests/unit/odooArticleImages.test.js` (asserts `failed`).
- `docs/specs/active/odoo-integration.md` §11: the completion contract and what the daily
  reconcile compares.

## Tests

- Before the fix, `./scripts/test-backend.sh tests/integration/odooSyncs.test.js tests/integration/odooSyncPdfs.test.js`:
  3 failed (the three new tests, at their behavioral assertions), 16 passed.
- After the fix, the same two suites plus `odooSpaceSyncs`, `odooKnowledge`, `odooSend` and the
  two unit files: 64 passed, after two fixture corrections of my own (a non-UUID image id in
  the signature test; the refused-upload case reused an attachment already on the article, so
  it now adds a second image).
- `npm run test:be`: 48 files, 655 tests passed.
- `npm run lint`: clean.
- Real Odoo 20 signature check: see Open Items.
- Frontend untouched (the sync card already shows failures by name and says they are retried).

## Open Items / Notes

- The review's remaining notes are not addressed here, by design: the daily reconcile still
  runs off `/sync` traffic (no pass while every client is offline), and membership/add-on are
  checked at run start only. Both are documented limits in the spec.
- A PDF whose bytes were replaced in Odoo under the same record is not detected (no checksum
  stored on the link); only a deleted or replaced record is. Worth a `odoo_links` column if it
  matters.
- The signature was checked against what the real local Odoo 20 Enterprise stores: a script in
  the dev API container wrote a typical sync body (headings, inline marks, nested lists, an
  `o_checklist`, blockquote, code block, table with `colspan`, entities), an image body
  (`/web/image/<id>`, an external image, a placeholder) and an empty body to a throwaway
  article through the JSON-2 API, read each back, and compared signatures: all three the same.
  The article was archived afterwards. What Knowledge's browser editor saves after a person
  edits an article was not checked; a difference there means one rewrite on the next daily
  pass, after which the stored body is the server-side form again.
