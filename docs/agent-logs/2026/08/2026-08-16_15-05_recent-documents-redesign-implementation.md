# Recent Documents Redesign — Implementation

- Agent: Claude Code (Opus 5)
- Start: 2026-08-16 15:05
- Branch: `feat/recent-documents-redesign`
- Spec: [`docs/specs/shipped/recent-documents-redesign.md`](../../../specs/shipped/recent-documents-redesign.md)
- Status: complete, awaiting review

## Objective

Implement the Recent Documents / folder-document dashboard redesign: shared
`DocumentDashboard` for the global `__recent__` route and real folder routes, a global-only
Continue Writing rail, quick filter, type filter, sort, time grouping, and a synced `pinned`
note attribute.

## User journeys

| # | Persona | Journey | Acceptance | Result |
|---|---|---|---|---|
| U1 | Returning writer | Opens the app at root, sees Continue Writing cards for the three most recently edited notes, clicks one | The exact note opens through the existing `selectFile` + `doc` route flow | Verified in browser |
| U2 | Writer with many notes | Types part of a title, folder path, or excerpt into the header quick filter | Cards and list narrow live; a clear control restores the unfiltered set | Verified in browser |
| U3 | Writer keeping a working set | Pins a note, then filters to `Pinned` | Pin persists and replicates; filter shows only pinned notes | Verified, including a server round trip |
| U4 | Writer inside a project folder | Opens a folder, filters to `Pinned` | Only notes directly in that folder appear | Verified: a pinned note in `Dashboard QA / Deep Notes` did not appear under `Dashboard QA` |
| U5 | Writer starting fresh | Presses `New Note` on both scopes | Root note and folder note created, then opened | Verified in browser |
| U6 | Keyboard / screen-reader user | Enter/Space on a row or card; tab to a pin button | Note opens; pin toggles without opening; names and `aria-pressed` announced | Covered by component tests; names verified in the live DOM |
| U7 | Phone user | Scans the list on a narrow viewport | Metadata stacks below the excerpt, pin stays top-right, no horizontal scroll | Verified at 584px (see limitation below) |
| U8 | Multi-device user | Edits/pins while a dashboard is mounted | The dashboard reloads without a manual refresh | Covered by component tests for `recentDocVersion` and `contentVersion` |

## Progress

Built in the order utilities → store → UI, per the feature-development skill.

1. **Schema.** `pinned INTEGER NOT NULL DEFAULT 0` on `notes` in `DB_SCHEMA` (frontend) and
   `BASE_SCHEMA` (backend), plus an idempotent `ensureNotesSchema` migration on each side.
   `notes` was already in `CRR_TABLES`, so no CRR registration change was needed.
2. **Utilities.** `recentDocuments.js` grew `isPinned` normalization, quick-filter matching,
   sorting, local-calendar time grouping, and relative-time / word-count formatting. Every
   time-dependent helper takes an injectable `now`.
3. **Store.** `docStore` gained `getRecentDocuments(limit = 50)`, `getFolderDocuments(folderId,
   limit = 50)` (strictly `notes.folder_id IS ?`), and `setDocumentPinned`. `structureStore`
   gained a `contentVersion` counter bumped by every write action, so a create/rename/move/
   delete/edit refreshes any mounted dashboard.
4. **UI.** `DocumentDashboard.vue` plus `DocumentDashboardHeader`, `RecentDocumentCard`,
   `RecentDocumentRow`, `DocumentPinButton`, and `FolderNavigationList`. `FolderPreview.vue` is
   now a four-line route shim; `FolderPreviewItem.vue` is deleted.

### Finding: altering a CR-SQLite CRR table

Browser validation caught a real defect that unit tests could not: the first pin click failed
with

```text
SQLiteError: expected 17 values, got 15
```

`notes` is already a CRR, and CR-SQLite generates its triggers from the column list at
registration time. A bare `ALTER TABLE … ADD COLUMN` leaves triggers bound to the old column
count, and **re-running `crsql_as_crr` does not rebuild them** — it returns success and leaves
the stale triggers in place. That was the pattern the existing `ensureImagesSchema` used, so it
looked like the house style.

Confirmed with a direct probe against the pinned 0.16.3 extension in the api-service image:

| Path | Result |
|---|---|
| `ALTER` + `crsql_as_crr` | `as_crr` reports ok; next `UPDATE` fails `expected 9 values, got 7` |
| `crsql_begin_alter` + `ALTER` + `crsql_commit_alter` | `UPDATE` succeeds; a `pinned` row appears in `crsql_changes` |

Both migrations now use `crsql_begin_alter` / `crsql_commit_alter`, only when the table is
actually a CRR on that connection, and both self-heal a database left half-migrated (column
present, triggers stale) by checking whether `notes__crsql_utrig`'s SQL mentions the column.
Promoted to [`docs/architecture/crsqlite-sync.md`](../../../architecture/crsqlite-sync.md)
§ Altering a CRR table.

**Latent bug, not fixed here:** `ensureImagesSchema` on both layers still uses the bare-`ALTER`
pattern for `size_bytes` and `sha256`. Any database created before those columns existed has
stale `images` triggers. Out of scope for this spec; recorded in the architecture doc.

### Finding: responsive header

At tablet width the single-row header truncated `Recent Documents` to `R..`, because the title
and the search field shared a row from `sm` upward. The spec puts the single-row header at
1024px and above, so the breakpoint moved from `sm:` to `lg:`. Covered by a component test.

### Deviations from the spec, agreed during review

Three UI decisions taken while the dashboard was running in the dev stack. All are recorded as
"As built" notes in the spec.

1. **No panel chrome around Continue Writing.** The `pn-panel` wrapper and the uppercase
   `CONTINUE WRITING` label are gone; the cards stand on their own. The grid element itself now
   carries the `v-if`, so nothing renders on a folder view or when the result set is empty —
   a wrapper-only guard would have left bare cards behind, which is exactly what happened
   briefly and is now covered by tests that assert on card count, not on the wrapper.
2. **The rail hides while the quick filter has text.** During a search the list is the answer;
   repeating its first three hits as cards only pushes the results down. A whitespace-only
   query does not count, and the Pinned filter is not a search, so both keep the cards.
3. **One type control, not two.** The `All` / `Pinned` select was dropped; the Pinned toggle
   button is the single control. The underlying `filter` state is unchanged, so restoring the
   select is a template-only change. Component tests drive the toggle and assert the select
   only when it is present.

## Changes Made

| File | Change |
|---|---|
| `frontend/src/utils/recentDocuments.js` | `isPinned`, filter/sort/group pipeline, formatters, `buildDashboardView` |
| `frontend/src/store/docStore.js` | Parameterized global and folder queries, `setDocumentPinned`, `contentVersion` passthrough |
| `frontend/src/store/structureStore.js` | `contentVersion` + `markContentChanged`, bumped by every write action |
| `frontend/src/store/syncStore.js` | `pinned` in `DB_SCHEMA`; `ensureNotesSchema` with CRR-safe alter and self-heal |
| `frontend/src/components/DocumentDashboard.vue` | New shared dashboard for both scopes |
| `frontend/src/components/DocumentDashboardHeader.vue` | Title, quick filter, New Note |
| `frontend/src/components/RecentDocumentCard.vue` | Continue Writing card |
| `frontend/src/components/RecentDocumentRow.vue` | List row with responsive metadata |
| `frontend/src/components/DocumentPinButton.vue` | Accessible pin toggle |
| `frontend/src/components/FolderNavigationList.vue` | Immediate child folders, outside the filters |
| `frontend/src/components/FolderPreview.vue` | Reduced to a route shim |
| `frontend/src/components/FolderPreviewItem.vue` | Deleted |
| `backend/api-service/db.js` | `pinned` in `BASE_SCHEMA`; exported `ensureNotesSchema` |
| `frontend/vitest.config.js` | Vue plugin + `@` alias so SFCs can be mounted in tests |
| `frontend/package.json` | `@vue/test-utils` and `jsdom` dev dependencies |
| `docs/architecture/crsqlite-sync.md` | New § Altering a CRR table |
| `docs/architecture/data-model.md` | `notes` row notes the `pinned` flag |

## Tests

| Suite | Result |
|---|---|
| `frontend/tests/unit/recentDocuments.test.js` | 44 passed — normalization, pin coercion, quick filter, sort with missing timestamps, all four local-date groups against a fixed `now`, formatter boundaries |
| `frontend/tests/unit/documentDashboard.test.js` | 42 passed — new file; real mounted SFCs |
| `frontend/tests/unit/docStoreDocuments.test.js` | 14 passed — new file; parameterized queries, folder scoping, pin write, error paths |
| `npm run test:fe` (whole suite) | 351 passed, 19 files |
| `npm run test:be` | 176 passed, 15 files (6 new in `tests/unit/db.test.js`) |
| `npm run lint` | 0 errors, 40 warnings, all pre-existing `no-console` |

`@vue/test-utils` + `jsdom` are new dev dependencies. Existing tests keep the `node`
environment; only the component file opts into jsdom via a `// @vitest-environment jsdom`
docblock.

### Manual browser validation (Docker dev stack, Chrome)

| Check | Result |
|---|---|
| Recent Documents at 1281px | Header, three Continue Writing cards, toolbar, `TODAY` / `EARLIER` groups |
| Folder dashboard | Folder name title, `Search this folder`, `Documents` heading, no Continue Writing rail |
| Child-folder navigation | `FOLDERS` chip row above the list; survives a quick filter that matches no documents |
| Pin / unpin | Filled star, `Edited 1 second ago`, no console errors after the CRR fix |
| Sync round trip | `pinned = 1` present in the backend per-user database and in `crsql_changes` |
| Global Pinned filter | `Nested Secret` (`Dashboard QA / Deep Notes`) + `DX Test Note` (`Root`) |
| Folder Pinned filter | `Dashboard QA` → no results, folder-specific message; opening `Deep Notes` → `Nested Secret` |
| Quick filter | Matched folder path (`deep notes`) and excerpt (`sprint cycle`); clear control appears only with text |
| Sort | `Modified, oldest first` reverses order within groups |
| 800px | Two-column cards, header stacked |
| 584px | Single-column cards, metadata beneath the excerpt, 40×40 pin target, no horizontal overflow |

**Limitation:** Chrome would not open a window narrower than ~584 CSS px, so the exact 375px
and 320px viewports were not rendered. 584px is below the 640px breakpoint, so the mobile
branch itself was exercised; the narrower widths rely on the same branch plus `min-w-0` /
`truncate` / `line-clamp` clamping.

**Dev data created during validation** (left in place, in the `DX Verify` dev account): folder
`Dashboard QA`, child folder `Deep Notes`, notes `Sprint Retro` and `Nested Secret`, and pins on
`Nested Secret` and the pre-existing `DX Test Note`.

## Open Items / Notes

- `ensureImagesSchema` still uses the bare-`ALTER` pattern on a CRR table (see the finding
  above). Worth its own fix; not touched here.
- The `pinned` column is only ever written by `setDocumentPinned`; the import/export paths
  insert explicit column lists, so pre-migration exports import cleanly as unpinned.
- Spec follow-ups are unchanged: workspace search may later replace the header field, and a
  shared-workspace model may add a `My notes` filter once note ownership can actually differ.
