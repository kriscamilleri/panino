# Table of contents and internal links: all five phases

- Agent: Claude Code (Opus 5.5), one of four parallel agents, in its own worktree
- Start: 2026-11-08, 19:10
- Status: Built and tested on `feature/toc-internal-links` (from `develop` 10b06f4); not pushed,
  not merged. Spec moved to `docs/specs/active/`.

## Objective

Implement [`editor-toc-and-internal-links.md`](../../../specs/active/editor-toc-and-internal-links.md)
(Kris answered Q1–Q6 and N1–N3): a stored, refreshable table of contents with outline numbers,
and links to headings, other Documents and headings in other Documents, in the Preview, the
editor, the phone, PDFs (web-app links built from `FRONTEND_URL`), and ZIP/JSON export and import.
Other agents worked at the same time on typewriter mode, tags and advanced search, so edits in the
shared hot spots (Editor.vue, SubMenuBar.vue, docStore.js, DocumentMenuSheet.vue,
shared/package.json, markdownSnippet.js) were kept to a few additive lines.

## Progress

1. **Phase 1, shared (pure).** `documentOutline.js` (GitHub slugs, `pn-` ids, `env.outline`,
   `#slug` → `#pn-slug`), `documentLinks.js` (`panino:doc/<uuid>[#slug]`, modes
   `'app'|'pdf'|'text'`, hand-written `#/…` inert), `markerBlocks.js` (fence- and
   front-matter-aware marker blocks, insert/replace/remove, `escapeInlineText`, `markerJson`),
   `tocMarker.js` (config validation and the `<nav class="pn-toc">` rule),
   `tableOfContents.js` (outline, build with outline numbers, insert, refresh, options, remove,
   stale status). `createDocumentRenderer({ documentLinks })` installs the three rules. The
   shared fixture gained heading ids, a table and links; both sides' parity tests pass.
2. **Phase 2, rendering.** API: `publicUrls.js` `appBaseUrl()`, `renderPdf(..., { appLinks })`,
   a DOMPurify `afterSanitizeAttributes` hook that writes `<FRONTEND_URL>/#/doc/<id>[?heading=]`
   (or strips the href) and removes `data-pn-*`, `/render-pdf` passing `appBaseUrl()`,
   `TOC_PRINT_CSS` in the base stylesheet, a startup warning, `documentPdf.js`
   `documentLinks` option. Odoo opt-ins: `syncPdf.js` wraps the core builder with `'pdf'`, the
   three `renderPdf` calls pass `appLinks`, `OdooSendModal` asks for `'pdf'`. App: Preview in
   `'app'` mode with click delegation, decoration, arrival at `?heading=`, the stale bar;
   HomePage deep link without a usable `dbKey`, `doc-not-available`.
3. **Phase 3, stores.** `documentLinkStore.js` (resolution cache, outline, deep-link lookup,
   picker search), `tableOfContentsStore.js` (status and actions), `linkPickerStore.js`;
   `docStore` exposes `resolveDocuments`, `getDocumentOutline`, `findDocumentDbKey`.
4. **Phase 4, UI.** Toolbar `TocMenuButton` (Insert/Refresh, Options…, Remove, stale dot),
   `TocOptionsForm` in `TocOptionsModal` and `phone/TocSheet` (`?sheet=toc`), phone Document
   menu rows, `LinkPicker` in `LinkPickerPopover` (desktop `[[`, Ctrl/Cmd+K, toolbar Link) and
   `phone/LinkSheet` (`?sheet=link`, Link key, `[[`), Mod+click, paste conversion, OverType
   patches, stale notice on Print Styles and the phone Export sheet.
5. **Phase 5, export/import.** ZIP export writes relative `.md` links and `notes: [{ id, path }]`
   in `_panino_metadata.json`; imports plan ids first, then rewrite relative `.md` links and old
   ids (ZIP metadata, JSON ids) to `panino:doc/<new id>`; card snippets skip tables.

## Decisions where the spec left room (recorded, not asked)

| # | Decision | Why |
|---|---|---|
| D1 | The `<nav>` rule and `parseTocConfig` live in `shared/tocMarker.js`; `tableOfContents.js` re-exports them | `tableOfContents.js` needs the full renderer (for outlines) and `markdownRender.js` installs the rule: one module would be an import cycle |
| D2 | `useTableOfContents` is a Pinia store, `tableOfContentsStore.js`; picker UI state is `linkPickerStore.js`; resolution is `documentLinkStore.js`, reached through three delegating entries in `docStore` | One stale status shared by the toolbar, Preview bar, phone menu and export screens; tiny diff in the hot docStore |
| D3 | The picker searches titles with its own query (`searchLinkTargets`), not `docStore.searchDocuments({ scope: 'titles' })` | The advanced-search agent replaces that function's signature (`{ query, limit, cursor }`) |
| D4 | `extractOutline(env)` and `documentOutline(text, variables)` instead of `extractOutline(tokens)` | The outline is collected by the core rule into the env |
| D5 | Marker finding is line-based (column 0, outside fences and front matter), the `<nav>` rule token-based | Linear, no second parse for the editor's offsets; they agree on every tested case. A column-0 marker inside a list-nested fence counts as inside the fence (stricter) |
| D6 | `_` is escaped only where it could make emphasis (Odoo's rule); `[`, `]`, `\`, `` ` ``, `*`, `~`, `|`, `<` always | Readable labels; still text-only (tested) |
| D7 | A heading made only of inline HTML is labelled by its source text, escaped (`\<img …>`), slug `section` | §4.3 drops inline HTML, U16 wants "the text literally"; this does both and never writes an empty link |
| D8 | `applyDocumentVariables` is now a linear scan with exactly the old regex's matches (differential test over 3000 random strings) | The old `/\{\{\s*([^}]+?)\s*\}\}/g` was quadratic on many `{{`; the TOC parses on every stale check |
| D9 | Deep link wait: `syncStore.refreshMembership()` (returns the in-flight refresh, or re-reads the space list), then `isSyncing` clears; bounded at 30 s; no syncStore change | syncStore is the tag agent's hot spot; the extra request on a miss is about membership, not the id |
| D10 | Heading arrival: Preview scrolls (desktop and phone), ContentArea moves the caret when the Preview is hidden, PhoneEditor opens in Preview when `heading` is set | The Preview owns its DOM; no new prop chain |
| D11 | Over 1 MiB the stale check waits 1.5 s instead of reusing the Preview's render env | Simpler; documents without a marker are never parsed at all |
| D12 | The cross-database note shows for every target in another database: "Members of X may not be able to open this Document." from a space, "Only members of X can open this Document." to a space | §6.4 example plus the personal-to-space case |
| D13 | OverType's link tooltip is patched per editor by swapping the tooltip element for a clone with Panino's handlers; Ctrl/Cmd+K is handled on the textarea (OverType listens on `document`, so stopping it there also keeps it from OverType) and `ShortcutsManager` reports `k` unhandled | The tooltip class is not exported and binds its click at creation |
| D14 | Toolbar Link and the phone Link key open the picker; Editor's `insertLink` no longer inserts `[Link text](url)` | §6.4 |
| D15 | The toolbar button reads "Contents" (title and aria-label "Table of contents") | Fits the toolbar; collapses to the icon like the rest |
| D16 | An unclosed table hides the rest of a card snippet | Rare; the alternative was showing the list |

## Changes Made

Shared: `documentOutline.js`, `documentLinks.js`, `markerBlocks.js`, `tocMarker.js`,
`tableOfContents.js` (new); `markdownRender.js` (plugins, linear variables); `package.json`
(4 exports); fixture `document.{md,html}`.

Backend: `publicUrls.js` (new), `pdf.js`, `index.js`, `documentPdf.js`; Odoo add-on
`syncPdf.js`, `routes.js`, `syncScheduler.js` (opt-ins only).

Frontend new: `store/{documentLinkStore,tableOfContentsStore,linkPickerStore}.js`,
`composables/{useDocumentLinks,useEditorLinks,useLinkPickerChoice,usePdfDocumentLinks}.js`,
`utils/{editorLinks,previewLinks,caretRect,routeDocument,documentLinkPaths}.js`,
`components/{LinkPicker,LinkPickerPopover,TocMenuButton,TocOptionsForm,TocOptionsModal,TocStaleNotice,DocumentNotAvailable}.vue`,
`components/phone/{LinkSheet,TocSheet}.vue`.

Frontend edited: `Preview.vue` (rewritten script), `HomePage.vue`, `ContentArea.vue`,
`PhoneEditor.vue`, `PrintStylesPage.vue`, `phone/ExportSheet.vue`, `useDocumentPdfRequest.js`,
`useOverTypePatches.js`, `useSheetRoute.js` (`link`, `toc`), `markdownStore.js`,
`editorStore.js` (`openLinkPicker`), `importExportStore.js`, `importUtils.js` (`sourcePath`),
and the hot spots below. Odoo add-on: `OdooSendModal.vue` (opt-in).

Hot spots (additive):

- `Editor.vue` (+9): import and create `useEditorLinks`, attach/detach with the textarea,
  `insertLink` opens the picker, exposes `openLinkPicker`.
- `SubMenuBar.vue` (+3): `TocMenuButton` after Page Break.
- `docStore.js` (+5): import and three delegating functions.
- `phone/DocumentMenuSheet.vue`: two rows (`phone-menu-toc`, `phone-menu-toc-options`), `runToc`.
- `shared/package.json`: four exports.
- `utils/markdownSnippet.js`: skip table of contents blocks.

Docs: `docs/architecture/pdf-pipeline.md` ("Links in PDFs"), `frontend/AGENTS.md` (sheets list,
"Links and tables of contents"), `backend/api-service/AGENTS.md` (`publicUrls.js`).

Mistake caught and fixed before any commit: a `Write` overwrote the existing
`frontend/src/utils/caretPosition.js` (used by `RemoteCarets.vue`); the build failed, the file
was restored from `HEAD`, and the new helpers moved to `utils/caretRect.js`.

## Tests

- Shared: `npm test --prefix shared` — 9 files, 146 tests pass (new: `documentOutline`,
  `documentLinks`, `markerBlocks`, `tableOfContents`; github-slugger cases, hostile 2 MiB lines,
  numbering 10/1.10/10.1, six levels, no `<ol>`, §9 hostile headings).
- Frontend: `cd frontend && npx vitest run` — 99 files, 1153 tests pass (new: `previewLinks`,
  `useTableOfContents`, `linkPicker`, `overTypePatches`, `homePageRouteSelection`,
  `pdfExportLinks`, `documentLinkStore` (with snippets), `importExportLinks`, `editorLinks`,
  `tocEntryPoints`; Odoo `sendModal` asserts `'pdf'`).
- Backend: `PANINO_TEST_IMAGE=panino-api-test-toc ./scripts/test-backend.sh` — 76 files passed
  (1 skipped), 1213 tests passed (1 skipped) (new: `tests/integration/pdf.links.test.js` with pdf-lib annotation checks, Odoo
  send/sync PDF links, `syncPdf` hash independence, Knowledge article text).
- Lint: `npx eslint --ignore-pattern '.claude/**' .` — clean.
- Build: `npx vite build` — passes.

### Browser checks done (headless Chromium, scratch stack)

A scratch API container (`panino-toc-api-check`, the test image, `node index.js`, port 8012,
`FRONTEND_URL=http://localhost:5182`) and this worktree's Vite on 5182; a throwaway signup.
Script and screenshots: [`toc-assets/`](toc-assets/) (`browser-check.mjs`, `results.json`).
23/23 passed at 1280×900 and 375×812:

U1 insert after the H1 with the exact Markdown, no bullets and no nested gaps (computed styles);
U2 heading click focuses the heading, route unchanged; U3 stale bar within a second, Refresh,
one Undo; U7 `[[#bud`; U8 `[[proj`, Preview click opens the Document with `dbKey`, Back returns;
U9 `[[Project plan#bud`, opens scrolled to Budget; U10 tooltip "Project plan — No folder";
U13 Ctrl+K with the selection; U16 inert `#/addons/ai/authorize` with its title, hostile heading
as text, no dialog; U12 the PDF request marks the resolved link and keeps `#pn-` anchors;
U17 deep link without `dbKey` gains it, an unknown id shows `doc-not-available`; phone: menu
reads "Refresh table of contents", Contents options opens `?sheet=toc`, a heading link scrolls
only `.ph-preview`; no console errors except the dev stack's 404s. The container was stopped
(not removed); Vite was stopped.

### Browser checks still to run (dev stack)

Desktop 1280:
- [ ] U4 Options → H1–H4, Bullets, No title: marker `"min":1,"max":4,"numbered":false,"title":""`, bullets shown; back to Numbered restores numbers.
- [ ] U5 two `## Overview` and a fenced `## Not a heading`: entries `#overview`, `#overview-1`, each scrolls to its own section.
- [ ] U10 rename and move Project plan within the database: link still works, tooltip shows the new title/folder; delete it: broken style, click toasts, no navigation.
- [ ] U13 Cmd/Ctrl+click a Document link in the editor opens it in the app (no new tab); click OverType's link tooltip on it: same (needs a browser with CSS anchor positioning, e.g. Chrome 125+).
- [ ] U14 paste the address bar URL of another Document: becomes `[<title>](panino:doc/<id>)`.
- [ ] Dark mode: popover, menu, stale bar, options dialog, broken links readable.
- [ ] Desktop with the Preview hidden: open `#/doc/<id>?dbKey=…&heading=budget`: caret on the heading line.

Phone 375:
- [ ] U6 Document menu → Insert table of contents (lands after the leading H1), type a heading in Edit, menu shows "Out of date", Refresh clears it.
- [ ] Link key and typing `[[`: the Link sheet opens above the keyboard (real device or emulated keyboard), search autofocused; choosing inserts at the caret.

PDF and export:
- [ ] U12 export a Document with a table and a Document link: in the PDF viewer table entries jump to their pages; the Document link opens `<FRONTEND_URL>/#/doc/<id>[?heading=…]`, no `dbKey`, no marker text visible.
- [ ] U15 ZIP export, open in VS Code: relative `.md` links follow; re-import into a fresh account: links are `panino:doc/<newId>` and work.
- [ ] U17 signed out, open a PDF link: sign-in → loading → Document at the heading with `dbKey` added; a second account without access sees the same "isn't available" screen as for a deleted id.
- [ ] U18 12 H2s, the first with 11 H3s, one H3 with H4s: 1…12, 1.1…1.11, 1.3.1 in Preview, phone, PDF, GitHub, VS Code.
- [ ] U11 space pair (Alice links a space Document to her personal one; Bob sees broken label, PDF text) and U19 Odoo (send and Knowledge sync PDF links; Knowledge article shows the label as text).

## Open Items / Notes

- Follow-ups F1–F8 of the spec are untouched (backlinks, outline panel, PDF bookmarks, Odoo
  sales-order blocks on `markerBlocks.js`, cross-database relink, Knowledge mapping, GitHub
  backup links, AI tool descriptions).
- The AI agents add-on renders server PDFs with the core default `'text'` (non-goal); its
  library test expectation changed only for the new heading id.
- `utils/markdownSnippet.js` `stripInline` still has the old quadratic `{{ }}` pattern; it runs
  per line on card snippets (left alone: the search agent owns that file's search behaviour).
- Merge notes: `useSheetRoute.js` SHEETS, `PhoneEditor.vue`, `DocumentMenuSheet.vue`,
  `SubMenuBar.vue` and `frontend/AGENTS.md` are likely to need trivial conflict resolution with
  the typewriter and tags branches.

## Review fixes (orchestrator, 2026-11-08)

An independent Fable 5.1 review found two medium and several low issues, and no high ones.
Changes on this branch:

- **Hand-written app routes (medium).** Only `#/…` was inert. `/#/settings`, `./#/addons/ai/authorize`
  and `?a#/x` were live same-tab links that could move the app to any screen, the OAuth consent page
  included.
  - New shared `isAppRouteHref`: a relative link (no scheme, not `//`) whose fragment starts with
    `#/`.
  - The renderer makes these inert, and the Preview's click classifier refuses them too.
  - Tests cover both.
- **Link decoration speed (medium).** The broken-fragment pass ran two DOM queries per anchor on
  every render. It now builds one set of ids per render.
- **Tables near code (low → data safety).** Two changes:
  - The line scan now follows list items: a fence opened inside an item ends with the item, and
    lazy continuation lines are handled.
  - `findTocs`, and with it Refresh, Options and Remove, keeps only marker blocks that markdown-it
    parses as top-level HTML.

  Fuzzing 20,000 random documents against markdown-it:

  | Case | Original | Now |
  |---|---|---|
  | A block the menu could change that renders as code | 352 | 0 |
  | A rendered table the menu misses | 1332 | 117 |

  The remaining misses are harmless: the menu offers Insert instead of Refresh.
- **Hidden-editor edits (low).** These are refused during a live session on the Document, and
  recorded in undo history.
- **Title cap (low).** `tocMarkerLine` caps the title at 80, so a marker written from code reads
  back undamaged.
- **`FRONTEND_URL` (low).** A query or fragment counts as unset, since it would break every PDF
  link.
- **Rendering changes (low).** Spec §4.7 now records that Knowledge articles with headings are
  rewritten once, and the AI add-on's HTML output carries heading ids.
- **Not changed:**
  - A paste is refused while editing is paused. Every input is refused then, with the same toast,
    so it behaves like any paste.
  - The stale check's second parse is debounced (300 ms, or 1.5 s above 1 MiB).
  - The source-grep test in `pdfExportLinks.test.js` stays until the export pages get a mount
    test.
