# Panino Mobile UI — Implementation Spec

19 October 2026 · Status: shipped · Design spec: [panino-mobile-ui-spec.md](panino-mobile-ui-spec.md)

> Shipped: 2026-10-19 (see `docs/agent-logs/2026/10/2026-10-19_10-44_mobile-ui-redesign.md`)
> Implementation: `frontend/src/components/phone/`, `frontend/src/pages/Phone*.vue`,
> `frontend/src/pages/SettingsRoute.vue`, `frontend/src/composables/` (`useViewport`, `useSheetRoute`,
> `usePhoneStatus`, `usePhoneSelection`, `usePhoneGestures`, `useDialogFocus`, `usePwaInstall`,
> `useSyncToggle`), `frontend/src/utils/` (`markdownKeys`, `markdownTasks`, `markdownSnippet`,
> `homeView`, `searchQuery`, `syncStatus`, `editorMode`, `pdfExport`, `caretPosition`),
> `frontend/src/assets/phone.css`, tests `frontend/tests/unit/phone*.test.js`, `pdfExport.test.js`

This spec turns the design spec into decisions against the current code. Where the two
disagree, this file wins for implementation; the design spec stays the visual reference.

## 1. Scope

All four releases from the design spec, built in order on `feature/mobile-ui` and committed
release by release. The phone layout applies below 768 px. At 768 px and up every screen
renders exactly as before: the desktop components are untouched apart from removing code
that only ever ran below 768 px.

Non-goals: native apps, sync engine or PDF renderer changes, new document features, schema
changes. Nothing in this spec adds a column or a table.

## 2. Open questions — resolved

| Question | Decision | Why |
| --- | --- | --- |
| Is there an Inbox? | **Inbox = personal Documents with `folder_id IS NULL`.** No new folder row. Capture saves there by default. | Unfiled Documents already live at the personal root; a real folder would need a migration and would move nothing that exists. |
| Note colours | **Dropped.** No Colour action in multi-select, cards use one tone. | A colour needs a new synced column; the design calls colours decorative. |
| Templates | **Existing `templates` table** through `TemplatePickerModal`. | Already shipped and seeded. |
| Sharing model | **Per space.** A space is a shared database; every member is an editor; the owner is Owner. "Can view" is not offered. | Invitations create editors only (`data-model.md`). |
| Copy link | **Members-only deep link** (`/#/doc/<id>?dbKey=…`). No public links. | Public links would be a new server feature. |
| Styles | **One preview style and one print style per user**, as today. The Export sheet has no preset tiles; it links to the print style editor. | There are no named presets to pick from. |
| Trash | **No Trash.** "Move to trash" becomes "Delete Document" with a confirmation. Drawer has no Trash row. | Deletion is immediate today; a soft delete is a schema change. |
| Pinning | **Shared with collaborators** (the existing `notes.pinned` column). | Per-user pinning needs a per-user table. |
| Snippet storage | **Stripped at render time**, memoised per Document version. Not stored. | Storing it is a schema change; stripping 200 bodies is cheap. |
| Fonts | Serif display stack `"Source Serif 4", Georgia, serif`; UI stack system sans; Write mode `ui-monospace` stack. No web font download. | The app is offline-first and ships no web fonts for chrome. |
| Folder pinning (All folders swipe) | **Rename, Move, Delete** instead of Pin, Move, Rename. | Folders have no pinned column. |
| Inbox / Shared chips | Chips **filter Home in place** (`?filter=inbox|shared|pinned`). The Drawer's Inbox and Pinned rows set the same filter. | One mechanism; chips are toggle buttons with `aria-pressed`. |

## 3. Routes

URLs stay shared between desktop and phone so a link opens the same Document on either.

| URL | Phone | Desktop |
| --- | --- | --- |
| `/` (`?filter=`) | Home | unchanged |
| `/doc/:fileId?dbKey=` (`?mode=write`) | Editor | unchanged |
| `/folder/:folderId?dbKey=` | Folder view | unchanged |
| `/search?q=&scope=&folder=&dbKey=` | Search | redirects to `/` |
| `/folders?tab=mine|shared` | All folders | redirects to `/` |
| `/settings` | Phone Settings | unchanged account page |
| `/settings/account` | Account page (existing component) | Account page |

Sheets and the Drawer are `?sheet=drawer|capture|menu|move|collaborate|export` on the current
route, pushed onto history, so back closes the sheet before leaving the screen. Closing a
sheet that this session opened calls `router.back()`; closing one that arrived in the URL
(reload, shared link) replaces the query instead, so back never leaves the app.

## 4. Architecture

```text
HomePage.vue ── isPhone? ──┬─ no ─► Navbar + SubMenuBar + Sidebar + ContentArea  (desktop, unchanged)
                           └─ yes ─► PhoneShell.vue
                                      ├─ PhoneHome.vue          (no file, no folder)
                                      ├─ PhoneFolderView.vue    (folderId)
                                      ├─ PhoneEditor.vue        (fileId)
                                      ├─ PhoneDrawer.vue        (?sheet=drawer)
                                      └─ sheets (capture, menu, move, collaborate, export)
PhoneSearchPage.vue, PhoneAllFoldersPage.vue, PhoneSettingsPage.vue  (own routes)
```

- `composables/useViewport.js` — one shared `matchMedia('(max-width: 767.98px)')` and the
  `visualViewport` keyboard inset. Replaces HomePage's own resize listener.
- `composables/useSheetRoute.js` — open/close sheets through the route query.
- `components/phone/` holds every phone-only component. Shared building blocks:
  `BottomSheet`, `SegmentedControl`, `NoteCard`, `FilterChip`, `SyncDot`, `KeyRow`,
  `CaptureBar`.
- Phone design tokens are CSS variables scoped under `.phone-ui` in `assets/phone.css`, with
  a dark mirror under `html[data-theme='dark'] .phone-ui`. They never apply to desktop markup.

### Editor on phones

`PhoneEditor` mounts the existing `Editor.vue` (with a `phone` prop) and `Preview.vue` (with
`interactive-tasks`) and shows one of them with `v-show`. The Editor stays mounted in Preview
mode because it owns the pending save, the conflict state and the live-session binding;
unmounting it to show Preview would end a live session.

- `phone` hides Editor's collaboration bar, stats and metadata strips (moved to the top bar
  and the Document menu), sets the Write-mode font, and draws remote carets.
- The conflict banner stays in the Editor in both modes, because it carries decisions.
- Initial mode: `?mode=write` (set by capture and template creation), else the "Open notes in"
  setting, else Write for an empty body and Preview otherwise.
- Key row (`#` `-` `[ ]` `**` `_` `` ` `` `[]()` `⇥`, then image, dictation when supported,
  undo, redo, hide keyboard) is fixed at `bottom: keyboardInset` and scrolls sideways. Keys use
  `pointerdown.prevent` so the textarea keeps focus and the keyboard stays up.
- Every key and the Preview checkbox go through one new Editor method,
  `transformText(fn, { focus })`, which reads `{ value, selectionStart, selectionEnd }`, applies
  a pure function, writes the result and dispatches `input`. That one path keeps undo history,
  the draft, the debounced save, and the live-session binding consistent.
- Preview checkbox: the Nth rendered task checkbox maps to the Nth task line in the source
  (`utils/markdownTasks.js`, skipping fences and front matter). If the counts disagree the tap
  is refused with a toast instead of toggling the wrong line. A tap saves immediately and does
  not change mode.

### Data

- Home lists `docStore.getRecentDocuments(limit)` across every open database (limit raised to
  200 on phones), split into Pinned and Others.
- Search is `docStore.searchDocuments({ query, scope, folderId, dbKey })`: parameterized
  `LIKE ? ESCAPE '\'` over title and body per database, `%`/`_`/`\` escaped, at most 50 rows
  per database, folder scope walking descendants with a recursive CTE.
- Capture uses `structureStore.createFile(dbKey, title, folderId, { content })`, a new optional
  argument, so the Document is created with its body in one transaction.
- Phone preferences (`homeLayout`, `openNotesIn`, `newNotesDestination`) join the existing
  `uiSettings` row in `uiStore`.
- Appearance gains **System**: `themePreference` accepts `system` and resolves it through
  `prefers-color-scheme`; `themeStore.theme` stays the resolved `light`/`dark` so existing
  readers are unchanged, and `themeStore.preference` holds the choice.
- Sync status is derived by `utils/syncStatus.js` from `isOnline`, `syncEnabled`,
  `isSyncing`, per-database `status`, and the live session: synced, syncing, offline, error,
  off, live.
- Toasts gain an optional `action` (`{ label, onSelect }`) for Undo after Move.
- PDF rendering moves out of `PrintStylesPage` into `utils/pdfExport.js`
  (`buildPdfRequest`, `requestPdf`); the page and the Export sheet both use it.

## 5. Behaviour and edge cases

- **Crossing the breakpoint** (rotation, split screen) swaps layouts. The Editor unmounts,
  which flushes its pending save; a live session ends with it. That is accepted and logged.
- **Space root as folder**: `/folder/space:<uuid>?dbKey=space:<uuid>` lists the space root.
- **Move** stays inside one database. A Document in a space lists that space's folders; a
  cross-database move remains the desktop copy/move dialog. Multi-select Move is disabled
  when the selection spans databases, with the reason shown.
- **Capture title**: the typed title, else the first non-empty line stripped of markdown and
  cut to 80 characters, else "Untitled". With a typed title the body is `# Title\n\n<body>`,
  matching how `createFile` starts Documents today.
- **Discard checks**: Cancel, swipe down, Escape or back on a capture sheet with text asks
  "Discard note?" in an in-app dialog, never `window.confirm`.
- **Read-only states**: a paused (conflicted) or dropped live Document refuses key-row edits
  and checkbox taps through the Editor's existing `editingBlocked()`.
- **Offline**: everything except Search history sync, Collaborate, Export and Images works;
  those controls are disabled with the reason as their label.
- **No Documents**: Home shows the empty state; with sync errors it still shows local data.

## 6. Cleanup (leftovers removed by this work)

| Leftover | Why it goes |
| --- | --- |
| `MobileMenu.vue`, Navbar mobile menu button and state | Navbar no longer renders below 768 px |
| Navbar `md:` icon/label variants | Only the desktop branch remains |
| `OfflineIndicator.vue` | Not mounted anywhere |
| `ContentArea` `isMobileView` prop and stacked-pane classes | Editor and Preview never stack now |
| `SidebarWithResizer` `isMobileView` prop and full-width hack | Sidebar no longer renders on phones |
| `uiStore.collapseDocumentsOnMobile` | Phones never show the sidebar; it also hid the sidebar on desktop |
| HomePage resize listener | Replaced by `useViewport` |
| PDF request code in `PrintStylesPage` | Moved to `utils/pdfExport.js` |

## 7. Security

- Search and every new query are parameterized; LIKE wildcards are escaped.
- Snippets, search highlights and breadcrumbs render as text nodes, never `v-html`.
- Preview keeps DOMPurify; enabling task checkboxes only removes `disabled` from inputs the
  renderer produced, after sanitizing.
- The Export preview is a `sandbox=""` iframe with sanitized HTML.
- Invite email goes to the existing server route, which enforces owner, rate and quota rules.
- Copy link copies an in-app URL that only members can open.

## 8. User journeys

| # | Journey | Acceptance |
| --- | --- | --- |
| U1 | Open an existing Document on a phone | Opens in Preview; one top bar; Write/Preview switch; never both panes |
| U2 | Tick a checklist item in Preview | Source line flips `[ ]`↔`[x]`, saves, stays in Preview |
| U3 | Format in Write with the key row | Key inserts at the caret; keyboard stays up; undo reverts it |
| U4 | Capture from Home | Bar → type → Save creates an Inbox Document and opens it in Write |
| U5 | Browse Home | Pinned then Others, grid or list, no raw markdown in cards |
| U6 | Navigate | Drawer → folder → subfolder → back walks one screen at a time; back closes sheets first |
| U7 | Search | Typing filters within 150 ms of pausing; matches highlighted; folder scope from a folder |
| U8 | Move a Document | Move sheet → tap folder → toast with Undo restores it |
| U9 | Collaborate on a space Document | Menu → Collaborate → Live on; avatars in top bar; status "Live · N editing" |
| U10 | Export | Menu → Export → A4 default → Download PDF |
| U11 | Settings | Appearance System/Light/Dark applies at once; Home layout persists |
| U12 | Desktop | At 1280 px every screen looks as before |

## 9. Tests

- Unit (Vitest): `markdownSnippet`, `markdownTasks`, `markdownKeys`, `syncStatus`,
  `captureTitle`, `searchQuery` (escaping and snippets), `editorMode`, `themePreference`
  (system), `pdfExport`, toast actions, `createFile` with content, `searchDocuments`.
- Component: KeyRow keeps focus, SegmentedControl `aria-pressed`, BottomSheet focus return
  and Escape, PhoneEditor never shows both panes, Navbar has no mobile menu.
- Browser: 390 × 844 and 1280 × 800 against the dev stack, every journey above, console clean.

## 10. Decisions made while building

| Area | What shipped | Why |
| --- | --- | --- |
| Write mode type | 16 px monospace, not 15 px | iOS Safari zooms the page into any field under 16 px |
| Preview with the Editor mounted | `Editor` takes `hide-text`; only its text hides | `display: none` on the whole Editor also hid the conflict banner and the Save version / resolve dialogs |
| Key row extras | After the eight spec keys: image, dictation (when supported), undo, redo, then hide keyboard | Phones had these in the old toolbars; the row scrolls sideways |
| Settings → "New notes go to" | Applies to capture from a folder: that folder (default) or the Inbox | Capture from Home always saves to the Inbox |
| Folder actions on phones | Rename, New subfolder, Delete | Folders cannot move between databases, and a same-database folder move needs a picker the Move sheet does not have yet |
| Settings tools | Images, Templates, Spaces, Variables, Import, Export all, GitHub backup | They lived in the Navbar menus that phones no longer show |
| Deep links | A cold start returns to the requested route through `/loading?redirect=` | Reloads and Home Screen shortcuts used to land on Home |
| Remote carets | Drawn at the character offset each person last sent | Offsets are not Yjs relative positions, so a caret can lag until that person's next keystroke |

### Not done here

- Real-device checks of the key row docking (iOS Safari, Android Chrome, rotation), VoiceOver
  and TalkBack walkthroughs. Browser checks ran in desktop Chrome in a 390 × 712 frame.
- A two-device live session. Carets and avatars were checked with an injected participant.
- PNG icons for iOS (`apple-touch-icon`); the manifest still has the SVG only.
- Find and replace on phones.

## 11. Later changes

- **2026-10-19, Inbox removed.** Users found it confusing. Notes in no folder are simply
  shown on Home; where a location must be named it is "No folder". The Inbox chip, Drawer row,
  All folders row, count query and the "New notes in a folder go to" setting are gone.
- **2026-10-19, sorting.** Home and folders sort by date modified (default), date created or
  title, ascending or descending, from a sort button or Settings; pinned notes stay first.
- **2026-10-19, install banner.** The floating install card no longer shows on phones (it
  covered sheets); Settings offers install, as the design spec intended.

