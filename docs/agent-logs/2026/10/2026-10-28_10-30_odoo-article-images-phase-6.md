# Odoo integration — Phase 6: images uploaded into Knowledge articles

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 10:30
- **Status:** Done

## Objective

Phase 6 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
replace the "Image not sent" placeholders of Phase 5 with the Document's own images, uploaded
onto the Knowledge article.

## Progress

- `odooArticleImages.js`: `internalImageSources` and `uploadArticleImages`. Each of Panino's own
  images (the sender's, or a space's they belong to, through `readInternalImage` now exported by
  `pdf.js`) is uploaded as an `ir.attachment` with `res_model knowledge.article` / `res_id`,
  checksum-verified, and the `<img src>` rewritten to `/web/image/<id>`. The same bytes already
  on the article are reused (checksum search), so a resend adds nothing. An unreadable or
  refused image becomes a placeholder and is counted; a rejected key, access error or lost
  article fails the send. The file field is detected lazily, so a body whose images all fail to
  read never calls Odoo.
- `sendArticleToKnowledge` creates or writes the article with placeholders first and writes the
  image body once the uploads are done, so Odoo never holds a Panino URL. Results carry
  `imagesUploaded` and `imagesMissing`; the sheet says how many images could not be sent.
- `articleBody` keeps internal `<img>` elements when asked (`keepInternalImages`), and external
  `https?` images keep their address instead of becoming placeholders.
- Browser check against the real local Odoo 20 Enterprise: an image uploaded to Panino, used
  twice in the Document plus an external one; after the send the body points both uses at one
  attachment that belongs to the article (76 bytes, image/png); a resend leaves one attachment;
  a logged-in Odoo reader sees both uses render (`naturalWidth > 0`). The only "failure" in the
  script is the external `example.com` image not loading in the sandbox, which is not ours.

## Changes Made

- `backend/api-service/odooArticleImages.js` (new), `odooKnowledge.js`, `odoo.js`, `pdf.js`
  (`readInternalImage`), `tests/fakeOdoo.js` (`ir.attachment/search_read`),
  `tests/unit/odooArticleImages.test.js` (new, 6), `tests/integration/odooKnowledge.test.js` (+2).
- `frontend/src/components/OdooSendModal.vue` (copy and the missing-images message),
  `frontend/tests/unit/odooSendModal.test.js` (+1).
- Docs: spec §7 images and Phase 6 ✅; `backend/api-service/AGENTS.md`.

## Tests

- Docker, the Odoo test files: `odooSend` 14, `odooChatter` 13, `odooKnowledge` integration 12,
  `odooKnowledge` unit 6, `odooArticleImages` unit 6, all passing. Two expectations were wrong at
  first: the same image reached through `/images/<id>` and `/api/images/<id>` counted twice (the
  upload is now keyed by image identity, one Odoo call), and external images are kept rather than
  replaced.
- `npm run test:be`: 43 files, 625 tests passed. `npm run test:fe`: 75 files, 931 tests passed.
- Frontend `odooSendModal.test.js`: 17 passed. `npm run lint`: clean.
- Headless browser check (`scratchpad/images-browser.mjs`): 9/10, the one being the external
  image described above.

## Open Items / Notes

- Attachments uploaded by a sender stay on the article even if the Document later loses that
  image; Panino never deletes in Odoo.
- Phases 7 (key lifecycle) onward are next.
