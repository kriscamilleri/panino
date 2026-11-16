# Disable Cover Header & Footer

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-15, 20:30
- Status: Implemented and validated; PR open against `develop`

## Objective

Implement [`docs/specs/shipped/disable-cover-header-footer.md`](../../../specs/shipped/disable-cover-header-footer.md):
a print-style checkbox that prints page 1 of a PDF without the Puppeteer header and footer.
It is for Documents that open with a cover page.

## Progress

1. **Shared settings.** Added `disableCoverHeaderFooter: false` to `DEFAULT_PRINT_STYLES` and to
   `NON_CSS_PRINT_KEYS`. `printStyleRules.js` now uses one `BOOLEAN_KEYS` set for this key and
   `enablePageNumbers`. `parseStyleValues` already coerces keys whose default is a boolean.
2. **Renderer.** `renderHtmlToPdf` takes `skipFirstPageHeaderFooter`. After the final pass,
   `withBareFirstPage` swaps in the draft pass's page 1. The draft pass already runs, to count
   pages for `%P`, so there is no extra Chromium render.
3. **Tagged-PDF finding.** The spec flagged the risk that Chromium's tag tree would point at the
   removed page. Checked with pdf-lib: after a plain splice, one `/Pg` was dangling. The draft and
   final page 1 have the same `StructParents` (0) and the same MCIDs, and the header and footer
   are untagged. So `/Pg` is repointed to the new page and the tags stay valid. Dropping the tags
   was not needed.
4. **Size finding.** pdf-lib writes every object it holds. The replaced page's resources were
   still written, so a full-page cover image was stored twice (+269 KB in the test). Added a
   reachability sweep from the trailer (`dropUnreachableObjects`). A test guards it, and it fails
   when the sweep is disabled (checked).
5. **Odoo sync hash.** `buildDocumentPdfRequest` hashes the whole `printStyles` object. A new
   default key would have changed every stored hash and re-sent every synced PDF once after
   deploy. The hash now leaves the key out while it is `false`. Ticking it still changes the
   hash (U6).
6. **UI.** Checkbox after **Enable Page Numbers** on the Print Styles page. `StyleCustomizer.vue`
   gained an optional per-field `help` line, linked with `aria-describedby`. The help text says
   "Documents", per the terminology rule.
7. **Docs.** "First page" section in `docs/architecture/pdf-pipeline.md`, including the two
   DOMPurify `<style>` gotchas. Both were re-verified against the frontend's DOMPurify: a leading
   `<style>` is dropped, and so is one with `<b` inside a CSS comment. `<` followed by a space
   survives.

## Changes Made

- `shared/styleDefaults.js`, `shared/printStyleRules.js`, `shared/stylePresets.js` (doc comment)
- `backend/api-service/pdf.js`: defaults, `EXCLUDE_STYLE_KEYS`, `withBareFirstPage`,
  `repointPageRefs`, `dropUnreachableObjects`, `skipFirstPageHeaderFooter`
- `backend/api-service/documentPdf.js`: `hashedPrintStyles`
- `frontend/src/pages/PrintStylesPage.vue`, `frontend/src/components/StyleCustomizer.vue`
- Tests: `shared/tests/printStyleRules.test.js`, `frontend/tests/unit/stylePresets.test.js`,
  `backend/api-service/tests/integration/pdf.test.js`,
  `backend/api-service/tests/unit/documentPdf.test.js`
- Docs: the spec (added to `docs/specs/shipped/`), `docs/architecture/pdf-pipeline.md`

## Tests

Environment: no Docker daemon and no root. Ran natively on Node 24.19.0 (`.nvmrc`). Chrome's
shared libraries and Liberation fonts were unpacked from Ubuntu `.deb` files into a scratch
directory and used through `LD_LIBRARY_PATH` and `FONTCONFIG_FILE`. Without fonts, every render
is one page. That also fails the existing "honours a `<style>` block" test on unchanged code, so
it is an environment condition, not a regression.

- `npm run lint`: clean.
- Shared: 70 passed.
- Frontend: 89 files, 1087 tests passed.
- Backend `tests/integration/pdf.test.js`: 33 passed. That includes the render comparison
  (page 1 shorter, pages 2–3 byte-identical), the tag tree, the cover image stored once, the
  count mismatch, `POST /render-pdf` with and without a header, and defaults.
- Backend `tests/unit/documentPdf.test.js`: 5 passed (named style carries the flag; hash
  stability).
- Full backend suite, run one file at a time with a 3-minute cap each: 76 of 76 files passed;
  1204 tests passed, 0 failed, 1 skipped. It took about 14 minutes. A single unfiltered
  `vitest run` over the whole suite looks hung for that long, so per-file runs are easier to
  follow.

Browser validation (Puppeteer driving the real UI). The dev backend ran from a scratch copy of
`backend/api-service` so it did not touch the repository's `data/` directory.

- Signed up a throwaway user. Created a 3-page Document with `print-style: Proposal` front matter.
- Print Styles: saved "Proposal" as a named style. The checkbox shows the label and help text and
  is off by default.
- Ticked: the request carries `disableCoverHeaderFooter: true`. The PDF has 3 pages. Page 1's
  content stream dropped from 1089 to 312 bytes; pages 2–3 are byte-identical to the unticked
  render. In Chrome's PDF viewer, page 1 shows no header or footer and page 2 shows
  "Professional Document".
- Reloaded and reselected "Proposal": still ticked, so it saves with the named style.
- Unticked: page 1 is byte-identical to the original again, with header and "Page 1 of 3" visible.
- 375px: checkbox and help text wrap cleanly, no horizontal overflow.
- Console: three 404s, only when signed in. The likely cause is add-on endpoints, since the dev
  backend ran without the add-on flags. Not investigated further. No page errors.

## Open Items / Notes

- Not checked: Acrobat, macOS Preview and `pdftotext`. No PDF reader or extractor could be
  installed here. Chrome's viewer renders the spliced PDF correctly, and pdf-lib re-parses it.
- The phone Export sheet and the Odoo/AI routes were not driven in a browser. They share
  `renderPdf` and the request builders covered above.
- `enablePageNumbers` still appears unused by the renderer (spec §8). Left for a separate cleanup.
