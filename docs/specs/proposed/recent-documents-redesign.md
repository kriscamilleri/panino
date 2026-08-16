# Recent Documents Redesign — Spec

> Redesign Recent Documents and folder document views into searchable writing dashboards with a Continue Writing rail on the global view and persistent pinned notes.
> Status: proposed
> Created: 2026-08-16
> Last updated: 2026-08-16

---

## 1) Summary

Replace the current plain, ten-item Recent Documents list and generic folder preview with the
dashboard shown in the reference image: a page header, primary New Note action, compact filters,
and documents grouped by time. The global Recent Documents view also has a Continue Writing card
rail. Folder views reuse the header and grouped-list layout without that global rail. The redesign
keeps Panino local-first: all document discovery, filtering, pinning, and sorting happen against
the local SQLite database, with normal CR-SQLite replication of the pin state.

Visual reference: [attached reference image](recent-documents-redesign/8015cb47-fb52-4ac0-98d5-0cb4deba1698.png).

## 2) Goals

1. Make the root/home route and selected-folder route feel like useful writing dashboards rather
   than generic previews.
2. Surface the three most recently edited documents as Continue Writing cards.
3. Make it fast to find a recently edited document by title, folder path, or text excerpt.
4. Let users pin documents and limit the list to pinned documents.
5. Scope folder document lists and their Pinned filter to notes directly in the selected folder,
   while keeping Recent Documents global across all folders.
6. Preserve the current click and keyboard flow for opening a note.
7. Preserve local-first operation and refresh the view after local writes and sync updates.
8. Match the existing UI design system: gray primary actions, blue only for document links,
   `rounded-md` controls, `rounded-lg` containers, and Lucide icons.

## 3) Non-goals

- This is not the full workspace search proposed in
  [`advanced-search.md`](advanced-search.md). It does not search every note body, tags, or
  front-matter field.
- It does not introduce shared-document ownership or a meaningful "My notes" scope: all notes
  in a user's local database are already their notes.
- It does not add note tags, a full-text-search index, pagination, or server-side queries.
- It does not alter the editor, preview, navigation layout, or document creation semantics.

## 4) Current state and constraints

The root route renders `FolderPreview` with the special `__recent__` folder ID. It loads at most
ten notes through `docStore.getRecentDocuments(10)`, then renders each with the generic
`FolderPreviewItem` row. A selected folder currently renders a recursive generic folder/file
tree. The existing normalized model already provides title, complete folder path, excerpt, word
count, and a display date; it has no pin state.

The notes schema currently has no `pinned` column. Since pinning must survive devices, the
column is a synced note attribute rather than browser-only UI state. The schema migration must
therefore be made in both `frontend/src/store/syncStore.js` (`DB_SCHEMA`) and
`backend/api-service/db.js` (`BASE_SCHEMA` and the relevant `CRR_TABLES` entry).

## 5) Information architecture and layout

### 5.1 Desktop layout

At widths of 1024px and above, the document dashboard renders, in this order:

1. A page header:
   - `Recent Documents` on the global view or the selected folder name on a folder view, in the
     `pn-title-page` tier.
   - A context-aware quick-filter input aligned right, with a Search icon and the placeholder
     `Search recent documents` or `Search this folder`.
   - A `BaseButton` primary action labelled `New Note`, with a Plus icon. It opens the existing
     create-file flow in the current context (root on Recent Documents; selected folder on a
     folder view) and navigates to the new document after creation.
2. On Recent Documents only, a full-width `pn-panel` Continue Writing section:
   - `CONTINUE WRITING` as an uppercase `pn-meta` label.
   - A three-column card grid below it.
3. The document-list toolbar:
   - `Recent` on the global view or `Documents` on a folder view, as the `pn-title-section`
     label.
   - An `All` filter select.
   - A `Modified` sort select.
   - A `Pinned` toggle button with a Star icon.
4. The grouped document list. On folder views, retain a compact child-folder navigation section
   above this list; it shows only immediate child folders and continues to open folders through
   the existing route flow. The new document filters never hide or search those child-folder
   navigation items.

The content column may use the available width; it must not be artificially constrained to the
current `max-w-3xl`. Keep comfortable horizontal page padding of 16px on compact desktop and
24px at large desktop widths.

### 5.2 Continue Writing cards

The global Recent Documents rail displays the first three documents from the active, sorted
result set. Cards are not removed from the list below; duplication is intentional so users can
either resume a likely document quickly or scan the chronological list. Folder views omit the
rail: their focused header and grouped document list are the shared layout.

Each card is a clickable, keyboard-operable `pn-panel` with:

- document title as a blue, single-line truncated link;
- full folder path below the title, muted and single-line truncated;
- word count and relative edited time on one muted metadata line;
- a two-line-clamped excerpt, omitted when the note has no non-whitespace content;
- an icon-only pin toggle in the top-right corner.

Cards use a responsive grid: three columns at 1024px and above, two columns at 640–1023px, and
one column below 640px. If fewer than three results exist, render only the available cards; do
not render placeholder cards. If no result matches the current filters or quick filter, hide
the section rather than showing an empty container.

### 5.3 Document list and time groups

List items use a flat, border-separated layout rather than cards. On desktop each item has:

- a document icon at the leading edge;
- title (blue), folder path, and two-line-clamped excerpt in the main column;
- word count and relative edited time, right aligned in a non-wrapping metadata column;
- a pin toggle at the trailing edge.

The time group label is uppercase `pn-meta` with a structural divider:

| Group | Condition, evaluated in the user's local time zone |
|---|---|
| `TODAY` | `updated_at` is on the current calendar date |
| `YESTERDAY` | `updated_at` is on the preceding calendar date |
| `EARLIER THIS WEEK` | Earlier than yesterday but within the current Monday–Sunday week |
| `EARLIER` | Any older document |

Within every group, sort documents according to the selected sort order. A document with an
invalid or absent edit timestamp remains visible in `EARLIER`, after timestamped documents.
Show `Unknown update time` rather than producing an invalid relative-time string.

### 5.4 Empty state

- With no documents at all in the active scope: display `No documents yet.` on Recent Documents
  or `No documents in this folder yet.` on a folder view, with a visible `New Note` primary
  action.
- With a quick filter or filter combination that has no results: display
  `No recent documents match these filters.` or `No documents in this folder match these
  filters.`, as appropriate, and an affordance to clear the active filters.
- Do not show empty time-group headings.

## 6) Data and interaction behavior

### 6.1 Document queries and normalization

Replace the fixed ten-item home query with a bounded request for the 50 most recently modified
notes across all folders. Add a corresponding bounded folder query for notes where
`notes.folder_id = ?`; it must return only notes directly in the selected folder, not notes in
descendant folders. Both queries return the recursive folder path, title, content, `updated_at`,
`created_at`, and `pinned`.

The global Recent Documents scope always contains recent notes from every folder. A folder
dashboard's scope contains only direct notes in that folder. Consequently, selecting `Pinned`
on Recent Documents shows every pinned note in the user's database, while selecting `Pinned` in
a folder shows only pinned notes assigned to that folder. A pinned descendant note appears only
after its own folder is opened.

`normalizeRecentDocument()` must expose a boolean `isPinned`. Treat `NULL`, `0`, and absent
values as `false`, so databases created before the migration render safely. The query remains
parameterized; the UI must never concatenate search text, IDs, or sort choices into SQL.

### 6.2 Pinning

Add `pinned INTEGER NOT NULL DEFAULT 0` to `notes`. Existing notes must migrate as unpinned.

- The pin control has an accessible name of `Pin <title>` or `Unpin <title>`.
- Activating it must not open the document card or row.
- Pin and unpin write `1` and `0`, respectively, and update `updated_at` so the result is
  consistently ordered and syncs as a normal note change.
- The UI updates optimistically, surfaces write failures via the existing toast system, and
  refreshes from the database afterward.
- A filled Star marks a pinned note; an outlined Star marks an unpinned note. Never use color
  as the only state indicator.

### 6.3 Filters, sorting, and quick filter

The controls are intentionally limited to facts represented by the current local data model:

| Control | Values and behavior |
|---|---|
| Type filter | `All` (default) and `Pinned`. `Pinned` returns only `isPinned === true` from the active global or folder scope. |
| Sort | `Modified` descending (default) and `Modified, oldest first`. |
| Pinned button | A pressed-state shortcut for the same Pinned filter; it stays synchronized with the type select. |
| Quick filter | Case-insensitive substring filter over normalized title, folder path, and excerpt. It updates the global cards and list or the active folder list as the user types. |

The quick filter is local to its dashboard and has no debounce because it filters an already
loaded, bounded in-memory collection. Its clear control appears only when text is present and
restores the active select/toggle filters without resetting them. It never expands a folder
scope or includes descendant notes. The input must not claim to search tags or all note content
until the Advanced Search feature exists.

Do not render a `My notes` filter in this version. It would be a deceptive no-op in Panino's
per-user local database. Shared-workspace scope, if introduced later, can add it alongside the
type filter.

### 6.4 Opening and creating documents

Clicking a card, a list row, or pressing Enter/Space on either opens the exact document through
the existing `draftStore.clearDraft()`, `docStore.selectFile()`, and `doc` route flow. The pin
button must prevent the parent open action.

`New Note` uses the same prompt and creation action as the existing Documents-pane New File
control. On Recent Documents it creates a root note; on a folder dashboard it creates the note
in the selected folder. It does not create a parallel form or change default folder behavior.

### 6.5 Refresh behavior

Each active dashboard reloads after:

- initial local database initialization;
- `docStore.recentDocVersion` changes after sync;
- a note is created, renamed, moved, edited, deleted, pinned, or unpinned while its global or
  folder view is mounted.

Avoid stale async results: if a previous request resolves after a newer refresh, discard it.

## 7) Implementation plan

1. Add a shared `DocumentDashboard.vue` component, parameterized with either global recent scope
   or a selected `folderId`. Route both the `__recent__` and real-folder branches through it.
   Do not overload `FolderPreviewItem.vue` with card, group, filter, and pin logic.
2. Extract presentational subcomponents only when they remove duplication, for example
   `DocumentDashboardHeader.vue`, `RecentDocumentCard.vue`, `RecentDocumentRow.vue`, and
   `FolderNavigationList.vue`. Cards are global-only; the header, toolbar, rows, grouping, and
   empty states are shared. Row/card components receive an already normalized document model and
   emit `open` and `toggle-pin`.
3. Extend the recent-document utility with `isPinned`, robust local-date grouping, and reusable
   relative-time/word-count formatting helpers. Keep those helpers unit-testable and avoid
   calling `Date.now()` implicitly where a testable `now` parameter is practical.
4. Extend `docStore` with parameterized global-recent and direct-folder document loading plus a
   dedicated pin-toggle action. Keep SQL and database access in the store; components only
   consume results and emit intentions.
5. Apply the `pinned` schema change on both client and server and include the table in CR-SQLite
   replication configuration.
6. Reuse `BaseButton`, `pn-panel`, `pn-meta`, `pn-divider`, and the documented focus/radius/
   color rules. Use Lucide `Search`, `Plus`, `FileText`, `Star`, and `X` icons.
7. Retire the recent-only branch of `FolderPreviewItem` and the folder file-row rendering after
   the dashboard owns document rows. Preserve its child-folder navigation behavior through the
   dedicated folder-navigation section.

## 8) Accessibility and responsive requirements

- Every interactive card and row is reachable by keyboard and has a visible
  `focus-visible:ring-2 ring-gray-500 ring-offset-2` treatment.
- Pin controls are real buttons, not click handlers on decorative SVGs, and have explicit
  accessible names and `aria-pressed`.
- The search input has a visible or programmatic context-aware label: `Search recent documents`
  or `Search this folder`.
- Screen readers receive the result count after each quick-filter or filter change through a
  polite live region.
- At widths below 640px, move word count and edited time beneath the excerpt, retain the
  pin control at the row's top-right, and keep every title/path readable without horizontal
  page scrolling.
- Touch targets for the card/row and pin control are at least 40px in each dimension.

## 9) Test and validation plan

### Unit tests

Extend `frontend/tests/unit/recentDocuments.test.js` to cover:

- normalization of `pinned` values to `isPinned`;
- title/path/excerpt matching for the global and folder quick filters;
- direct-folder query scoping, including proof that pinned notes in descendants do not appear
  until that descendant folder is opened;
- newest-first and oldest-first sort behavior, including missing timestamps;
- all four local-date groups using a fixed local `now`;
- relative-time and word-count formatting boundary cases.

Add focused store tests for the parameterized recent query and pin-toggle action, including an
error path that preserves a truthful UI state.

### Component tests

Cover the global and folder dashboards for:

- three, two, one, and zero Continue Writing cards;
- intentional duplication of cards in the chronological list;
- each filter and sort option, and clearing a quick filter;
- global Pinned results across folders and folder-local Pinned results limited to the selected
  folder;
- folder-specific title, search label, New Note parent folder, immediate child-folder
  navigation, and empty states;
- pin/unpin events without triggering document open;
- opening a document by mouse and keyboard;
- no-results and no-documents states;
- accessible names, pressed state, and mobile metadata ordering.

### Manual browser validation

With the development stack running, verify Recent Documents and a folder route at desktop,
tablet, and phone widths; create a root and folder note; edit them; pin and unpin them; verify
global and folder-local Pinned results; use every filter and sort; enter and clear both quick
filters; and confirm a sync refresh updates each dashboard without a manual reload.

## 10) Acceptance criteria

- [ ] Recent Documents visually contains the header, New Note action, Continue Writing rail,
      filters, and grouped list described above.
- [ ] A selected folder uses the shared header, New Note action, filters, child-folder
      navigation, and grouped document list, without the global Continue Writing rail.
- [ ] The page uses the shared design-system primitives and has no new blue primary buttons or
      blue focus rings.
- [ ] Exactly the top three active results appear in Continue Writing, and they also remain in
      the chronological list.
- [ ] The list correctly groups local timestamps and sorts within groups.
- [ ] Search matches title, folder path, and excerpt locally, with a clear control and no
      misleading tag/full-text claim.
- [ ] Pinning is persistent, synchronized, keyboard accessible, and filterable.
- [ ] Recent Documents' Pinned filter includes pinned notes from every folder; a folder's Pinned
      filter includes only pinned notes directly assigned to that selected folder.
- [ ] The `pinned` migration is present in both client and server schema definitions and CRR
      configuration.
- [ ] Existing child-folder navigation and document open behavior remain unchanged.
- [ ] Targeted unit/component tests pass and the three responsive layouts are browser-validated.

## 11) Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pin state is added only to one schema and fails across devices | Make the paired frontend/backend schema and CRR changes a single implementation checklist item and test a sync round trip. |
| Global and folder dashboards drift apart | Share header, toolbar, row, grouping, and empty-state components; limit global-only behavior to the Continue Writing rail. |
| Folder filtering leaks notes from descendants | Use `notes.folder_id = ?` for folder queries and add direct-scope tests, including pinned descendant notes. |
| Timestamp grouping changes around midnight or in tests | Group by explicit local calendar boundaries and inject/fix `now` in tests. |
| Quick filtering looks like the unbuilt global search feature | Use the accurate `Search recent documents` label and retain full workspace search as a separate follow-up. |
| Long titles, paths, or excerpts overflow narrow layouts | Clamp text, stack metadata on mobile, and validate the 320px viewport. |

## 12) Follow-ups

- When [`advanced-search.md`](advanced-search.md) ships, the page-header field may become a
  global search launcher or be replaced by one. That change must preserve this dashboard's
  quick-filter behavior and its global-versus-folder scope boundary, or make the scope
  transition explicit.
- A future shared-workspace model may add `My notes` and collaborator-scoped filters. It must
  not introduce a no-op control before note ownership can differ.
