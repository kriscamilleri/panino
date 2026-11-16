# Disable Cover Header & Footer — Skip the Print Header and Footer on Page 1

> Status: shipped
> Created: 2026-11-12
> Last updated: 2026-11-16
> Shipped: 2026-11-16 (branch `feature/disable-cover-header-footer`)
> Implementation: `shared/styleDefaults.js`, `shared/printStyleRules.js`,
> `shared/stylePresets.js`, `frontend/src/pages/PrintStylesPage.vue`,
> `frontend/src/components/StyleCustomizer.vue`, `backend/api-service/pdf.js`,
> `backend/api-service/documentPdf.js`, `docs/architecture/pdf-pipeline.md`

---

## 1) Summary

A print style gets a new checkbox, **Disable Cover Header & Footer**. When it is ticked, the PDF
prints page 1 without the print header and footer, and every later page with them, like Word's
"Different first page". This is for documents that open with a full-bleed cover page, such as
the PrettyNeat proposal template.

This cannot be done from a Document today. The header and footer are Puppeteer
`displayHeaderFooter` templates. Chromium paints them on top of every page after the content,
in a separate document that a Document's CSS cannot reach. Verified 2026-11-12:

- A full-page cover background does not hide them; the template text paints over it.
- `@page :first { margin: 0 }` does not move or clip them.
- CSS `@page` margin boxes on the first page or on all pages do not suppress them.

The header/footer fields accept only `style` attributes, so they cannot carry a conditional
either. The workaround in use today moves the header and footer into Custom CSS margin boxes and
leaves the Header/Footer fields empty. That loses the Header/Footer settings UI (alignment, font
size, colour, `%p`/`%P`) for every document.

## 2) Goals

1. One boolean print-style setting, off by default, shown as a checkbox on the Print Styles page.
2. When on, and the style has a header or footer, page 1 of the PDF has neither. Pages 2+ are
   unchanged.
3. Works for every PDF route, since they all go through `renderPdf` / `producePdf` in `pdf.js`:
   Export, phone Export sheet, Odoo send and syncs, and the AI/MCP `export_pdf`.
4. Works per named print style, so a template can set `print-style: Proposal` in front matter and
   only Documents using that style lose the header and footer on page 1.
5. No extra Chromium render.

## 3) Non-goals

- A different header or footer on the first page; it is only hidden.
- Changing page numbering. Page 2 still reads "2" and `%P` still counts the cover.
- Hiding headers and footers drawn by a Document's own CSS margin boxes. A Document controls
  those itself with `@page :first`.
- A per-Document front-matter switch. A possible follow-up is a `cover: true` key that overrides
  the style; it is out of scope here.
- Any change to the Preview, which has no page model.

## 4) User stories

| # | Who | Does | Result |
|---|---|---|---|
| U1 | Writer | Ticks **Disable Cover Header & Footer** on the "Proposal" print style and exports a Document using it | Page 1 has no header or footer; pages 2+ show them with correct page numbers ("Page 2 of 4") |
| U2 | Writer | Leaves the box unticked (the default) | Output is byte-for-byte what it is today |
| U3 | Writer | Ticks the box on a style with empty Header and Footer fields | No change; there was nothing to hide |
| U4 | Writer | Exports a one-page Document with the box ticked | One page, no header or footer |
| U5 | Writer | Creates a Document from a template whose default print style has the box ticked | The Document gets `print-style:` front matter and its PDF skips the header and footer on page 1 |
| U6 | Odoo user | A Knowledge sync renders a Document whose style has the box ticked | The synced PDF skips page 1's header and footer; toggling the box changes the sync hash, so the next sync re-sends it |

## 5) Design

### 5.1 Setting

- Key: `disableCoverHeaderFooter`, boolean, default `false`.
- Label: **Disable Cover Header & Footer**.
- Help text: "Print the first page without the header and footer, for Documents that start with
  a cover page."
- It is not CSS. It is listed wherever `enablePageNumbers` is listed as a non-CSS print key, so
  it never reaches the generated stylesheet:
  - `shared/styleDefaults.js`: `DEFAULT_PRINT_STYLES` (value `false`) and `NON_CSS_PRINT_KEYS`.
  - `shared/printStyleRules.js`: the allowed-keys list and a `BOOLEAN_KEYS` set used by
    `validatePrintStyleValue` (`true`, `'true'`, `1`, `'1'` → `true`, anything else `false`).
  - `shared/stylePresets.js`: already coerces keys whose default is boolean.
  - `backend/api-service/pdf.js`: `PRINT_STYLE_DEFAULTS` (value `false`) and `EXCLUDE_STYLE_KEYS`.
- Stored inside the print style's JSON like every other key. No migration: a missing key reads
  as the default (`false`).

### 5.2 UI

`frontend/src/pages/PrintStylesPage.vue`: a `type: 'checkbox'` field with
`modelKey: 'disableCoverHeaderFooter'` next to **Enable Page Numbers**. It saves through the
existing style-editing flow, so named styles, folder defaults and template defaults need no
further work. `StyleCustomizer.vue` gains an optional `help` line per field (linked to the
input with `aria-describedby`) to show the help text.

### 5.3 Rendering (`backend/api-service/pdf.js`)

`renderHtmlToPdf` already does two passes when a header or footer is set:

1. A **draft** pass with `displayHeaderFooter: true` and empty templates (`<span></span>`), used
   only to count pages for `%P`.
2. A **final** pass with the real templates.

Both use the same page, `@page` CSS and margins, so they lay out identically. The draft's page 1
is exactly page 1 without the header and footer. So:

- `renderHtmlToPdf({ pdfOptions, headerFooter, skipFirstPageHeaderFooter }, job)`.
- `producePdf` sets it to
  `Boolean(headerFooter) && processedPrintStyles.disableCoverHeaderFooter === true`.
- After the final pass, when the option is on, `withBareFirstPage(final, draft)` replaces page 1
  of the final PDF with page 1 of the draft using pdf-lib:
  1. Load both buffers.
  2. If the page counts differ, or are 0, log a warning and return the final PDF unchanged.
  3. Otherwise `copyPages(draft, [0])` into the final document, `removePage(0)`,
     `insertPage(0, copied)`, and `save()`.
- Modifying the final document in place, rather than copying everything into a new one, keeps
  its document-level info.
- The header-less path (`!headerFooter`) is untouched: no header or footer, nothing to skip.

Cost: two `PDFDocument.load` calls and one `save` per affected render, with no Chromium work.
This happens inside the job, before its deadline checkpoint, so `PDF_JOB_TIMEOUT_MS` still covers
it.

### 5.4 Odoo sync hash

`buildDocumentPdfRequest` (`backend/api-service/documentPdf.js`) hashes the whole `printStyles`
object. Adding a new default key would change every stored hash and re-send every synced PDF
once after deploy. The hash therefore leaves `disableCoverHeaderFooter` out while it is `false`.
Ticking the box still changes the hash (U6).

### 5.5 Security

No new input reaches Chromium. The flag is a validated boolean; the merged PDF is built only from
the two PDFs the renderer already produced. The threat model in
`docs/architecture/pdf-pipeline.md` is unchanged.

### 5.6 Cover-page Documents (for reference, no code)

The PrettyNeat cover template keeps its own `@page :first { margin: 0 }` to print edge to edge,
and drops the header/footer margin-box workaround. It names its print style in front matter,
for example `print-style: Proposal`, where "Proposal" has this box ticked. Two template gotchas
are recorded in `docs/architecture/pdf-pipeline.md` (re-verified 2026-11-15 against the
frontend's DOMPurify):

- A `<style>` block must not be a Document's first node. The frontend's default
  `DOMPurify.sanitize` parses it into `<head>` and drops it.
- A `<style>` block whose text contains `<` followed by a letter, `/` or `!` (even in a comment)
  is removed whole by DOMPurify.

## 6) Tests

- `shared/tests/printStyleRules.test.js`: the key is accepted and off by default; boolean
  coercion for `true`, `'true'`, `1`, `'1'`, `false` and garbage; it round-trips through
  `validatePrintStyles`; it is absent from generated CSS.
- `frontend/tests/unit/stylePresets.test.js`: the key round-trips through a named style as a
  boolean, and an old style without the key reads `false`.
- `backend/api-service/tests/integration/pdf.test.js`:
  - **Render comparison.** A 3-page document through `renderHtmlToPdf` with a header and
    footer, option off and on; each page's content stream is inflated. Both have 3 pages, page 1
    is shorter with the option on, pages 2 and 3 are identical.
  - **Count mismatch.** `withBareFirstPage` returns the final buffer unchanged when the page
    counts differ, and for an empty PDF.
  - **`POST /render-pdf`.** With the option and a header, 200 with 3 pages and only page 1
    changed; with no header or footer, the output matches the option off.
  - **Defaults.** The key exists, `false`, in both default objects and in `EXCLUDE_STYLE_KEYS`.
- `backend/api-service/tests/unit/documentPdf.test.js`: a named style carries the flag into the
  request; ticking it changes the hash; an unticked style's hash equals the pre-setting hash.
- Browser validation: tick the box on a named style, export a 3-page Document using it, and
  confirm page 1 is clean and pages 2–3 read "Page 2 of 3" and "Page 3 of 3". Then untick the
  box and confirm the header and footer return on page 1.

## 7) Acceptance criteria

1. A **Disable Cover Header & Footer** checkbox appears on the Print Styles page, is off by
   default, and saves with the named style.
2. With the box ticked and a header or footer set, exported PDFs have no header or footer on
   page 1 and unchanged ones on later pages, for Export, the phone Export sheet, Odoo and AI/MCP
   export.
3. With the box unticked, PDFs are unchanged from today.
4. No additional Chromium render per export.
5. All tests in §6 pass.

## 8) Open questions

- `enablePageNumbers` is validated and stored but appears unused by the renderer: only
  `PRINT_STYLE_DEFAULTS` and `EXCLUDE_STYLE_KEYS` mention it in `pdf.js`. The new flag does not
  model its behaviour on it; consider a separate cleanup.
- Should a later version let page numbering start after the cover (cover = 0, so the next page
  reads "1 of N−1")? This would need `%p`/`%P` offsets in `buildHeaderFooterTemplate`; it is out
  of scope here.
