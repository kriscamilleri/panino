# Tag System — Spec

> Color-coded document tags defined in front-matter, visible in the sidebar.
> Status: active (being implemented on `feature/tag-system`)
> Created: 2026-03-21
> Last updated: 2026-10-25 — redesigned for shared spaces (COLLAB-04)
> Revised 2026-11-08 — aligned with [advanced search](../proposed/advanced-search.md) §6.3 and §7:
> tags are read by `readTags` in `shared/frontMatter.js`, and one per-database in-memory
> Document metadata index (§7) serves the tag system and search alike
> Implementation: `shared/frontMatter.js` (`readTags`, `canonicalTagName`);
> `backend/api-service/db.js` (`tags`, `ensureTagsSchema`), `sync.js` (allowlist),
> `spaceTransfer.js` (`copyTagStyles`); `frontend/src/store/documentIndexStore.js`,
> `frontend/src/utils/documentMetadataIndex.js`, `frontend/src/store/tagStore.js`,
> `frontend/src/utils/{tagPalette,tagPaletteVerify,tagAutocomplete,tagFilter,tagsSchema}.js`,
> `frontend/src/components/tags/`, `scripts/verify-tag-palette.cjs`
> Remaining: search's `tag:` part and result chips (advanced search, phase 4), which read this
> spec's index; swapping `utils/tagFilter.js`'s Trash rule for `shared/trashFolder.js` once search
> adds it; browser checks listed in `docs/agent-logs/2026/11/2026-11-08_19-10_tag-system.md`

---

## 1) Summary

Add a tagging system where tags are declared as values in a Document's YAML front-matter. Tags are displayed as color-coded badges in the sidebar next to each Document. Users can give a tag a display name and color from a dedicated management UI. Tag colors are stored per database, synced via CR-SQLite, and usable as search/filter criteria.

Tags work the same way in a personal database and in a shared space
([COLLAB-04](../shipped/collab-04-shared-spaces.md)). A space has its own shared set of tag colors, exactly as
it has its own shared globals and templates.

---

## 2) Goals

1. Allow users to assign one or more tags to any Document via front-matter.
2. Display tags as colored badges/chips in the sidebar Document list.
3. Provide a tag management UI to set a tag's display name and color, and to remove that styling.
4. Sync tag colors and assignments across devices and across the members of a space.
5. Enable filtering the sidebar by tag, across personal Documents and every space at once.

## Non-Goals

- No hierarchical/nested tags in v1.
- No auto-tagging or AI-suggested tags.
- No tag-based access control or sharing. A tag never grants or limits access to a Document.
- No bulk rewriting of Documents' front-matter from the management UI (see §5.3).
- No per-person tag colors inside a space in v1 (see §8).

---

## 3) Front-Matter Schema

```yaml
---
title: Meeting Notes
tags:
  - work
  - urgent
---
```

Tags are read by **`readTags(markdown)`** in `shared/frontMatter.js`
(`@panino/content-merge/front-matter`), next to the shared parser `parseFrontMatter`. Both the app
and the API use it, so a Document has the same tags everywhere. `parseFrontMatter` itself is
unchanged: it reads `key: value` lines only and keeps list items such as `  - work` unread, which
is why tags need their own reader.

- The block rules are the shared parser's: front matter counts only when the block opens on the
  first non-blank line, is closed by a second `---` line, and is YAML-shaped (at least one
  `key: value` line, nothing that is not YAML). An unclosed block, or `---` rules around prose,
  has no tags.
- The `tags` key is found case-insensitively at the top level of the block (`Tags:` works).
- `tags` may be:
  - a list of items on the following lines (`- work`, indented or not);
  - a single string (`tags: work`), read as a one-item list;
  - the inline form `tags: [work, "q3 plan"]`.
  Items may be quoted with `'` or `"`. A YAML comment (` # …`) after a value is ignored. `[]`,
  `~` and `null` mean no tags.
- The **canonical name** is the trimmed value with runs of white space collapsed to one space and
  letters lower-cased. A name that is empty or longer than **50 characters** is ignored (never
  truncated: two long names cut to 50 could become one tag). Duplicates (by canonical name) are
  dropped; the first spelling found is kept as the Document's display casing. At most 100 tags
  are read per Document.
- Reading is linear in the length of the block, including a single 2 MiB line: no regular
  expression that can backtrack.
- `readTags(markdown)` returns the canonical names; `readTagEntries(markdown)` returns
  `{ name, label }` pairs (label: the spelling found); `canonicalTagName(value)` is the one
  canonicaliser, used for table keys, filters and `tag:`.
- Front-matter is the only source of truth for *which* tags a Document has. Because it is part of
  the Document's content, assignments travel with the Document: they sync, merge
  ([COLLAB-02](../shipped/collab-02-content-merge.md)), appear in revision history and move with the Document
  between databases with no extra work.
- A tag with no color row (§4) renders in the neutral style. Nothing is written to the database
  when a Document mentions a new tag.

---

## 4) Tag Colors

A tag's display name and color are stored in a `tags` table **in the database that holds the
Documents** — the personal database, or a space's database. The same tag name can therefore look
different in your personal Documents and in a space; that is intended (§8).

### Table: `tags` (CRR-synced)

| Column | Type | Notes |
|--------|------|-------|
| `name` | TEXT PRIMARY KEY NOT NULL | Canonical name (§3) |
| `display_name` | TEXT NOT NULL DEFAULT '' | Preferred casing; empty means use the casing found in the Document |
| `color` | TEXT NOT NULL DEFAULT '' | A palette key (§4.2); empty means neutral |
| `created_at` | TEXT NOT NULL DEFAULT '' | ISO 8601 (the default exists only because CR-SQLite requires one on every NOT NULL column) |
| `updated_at` | TEXT NOT NULL DEFAULT '' | ISO 8601 |

Add to `BASE_SCHEMA` and `CRR_TABLES` in `backend/api-service/db.js` and to `DB_SCHEMA` in
`frontend/src/store/syncStore.js`.

**Why the name is the primary key.** CR-SQLite does not allow a unique index other than the
primary key on a CRR table, so the earlier design (UUID `id` plus `UNIQUE(name)`) cannot be made a
CRR. Even if it could, two editors in a space who each style a new tag "work" on different devices
would create two rows for one tag. With the canonical name as the key, both write the same row and
CR-SQLite merges them column by column (last writer wins per column). This mirrors `globals`
(`key` primary key plus `display_key`).

**Later writes touch one column.** The first write creates the row, so it writes every column
(the ones it does not set get `''`). After that, setting a color updates `color` (and
`updated_at`) only, and setting a display name updates `display_name` only. A member changing the
color therefore never overwrites another member's concurrent display name. Two first writes
from different sites still converge: CR-SQLite breaks the version tie by value, and `''` is the
smallest, so the set values win (checked with the native extension, 2026-11-08 review). Choosing
Neutral for a tag with no display name removes the row, as Reset does.

**A display name changes only the spelling.** `display_name` must have the same canonical name as
the row (`Work` or `WORK` for `work`, not `Job`). Renaming a tag is out of scope (§5.3), and a
display name that named another tag would make the chip, the filter and `tag:` disagree.

### 4.1 When a row exists

A row is written only when someone sets a display name or color in the management UI. Mentioning a
tag in a Document never creates one. This keeps sync quiet, avoids every member's client racing to
create the same rows in a space, and means the management list is the union of styled tags (rows)
and tags found in the database's Documents.

### 4.2 Palette

Store a palette **key**, not a hex value, so colors can be retuned for contrast without a data
migration. The palette (`frontend/src/utils/tagPalette.js`):

| Key | Hex |
|---|---|
| `neutral` | `#78716c` |
| `red` | `#dc2626` |
| `orange` | `#c2410c` |
| `amber` | `#a16207` |
| `green` | `#15803d` |
| `teal` | `#0f766e` |
| `violet` | `#7c3aed` |
| `pink` | `#db2777` |

Every entry must:

- pass at least 3:1 contrast against both `#ffffff` and `--pn-surface: #151515`, the same rule as
  the identity palette in [COLLAB-03 §3](../shipped/collab-03-identity-palette.md) (the earlier list's yellow
  `#f1c40f` and gray `#95a5a6` fail on white);
- stay perceptually distinct from `--pn-primary` and `--pn-accent` (CIEDE2000 ΔE ≥ 12);
- stay distinct from every other entry (ΔE ≥ 12);
- keep its hue outside 200–260° (blue is reserved for links, `ui-design-system.md` §1).

`neutral` is used when `color` is empty or not a palette key.

No free-form color picker in v1: it cannot be held to the contrast rule.

### 4.3 Tags and people's colors

People in a space are shown with colors from the identity palette, which already covers most hues
(rose, orange, amber, olive, green, teal, cyan, pink). Tag colors cannot avoid all of them, so tags
and people are told apart by **shape, not hue**:

- people are filled circles with initials (COLLAB-03 `AvatarStack`);
- tags are rounded-rectangle chips (`rounded-md`, a 1 px border in the tag's color and a faint
  tint of it) with a `#` glyph in the tag's color and the tag name in the normal text color, or,
  where space is short, a small square swatch — never a filled circle.

The name is never drawn in the tag's color, so its contrast does not depend on the palette.

`scripts/verify-tag-palette.cjs` (alongside `scripts/verify-identity-palette.cjs`) checks the
rules above, and a unit test runs the same checks.

---

## 5) UX & UI

### 5.1 Sidebar Display

- Each Document in the sidebar shows its tags as compact chips to the right of the title.
- If a Document has more than 3 tags, show the first 3 and a `+N` overflow indicator.
- A chip uses the color from the Document's own database. A Document in a space shows the space's
  color for that tag, even if you styled the same tag differently in your personal Documents.
- A chip's label is the row's display name, else the spelling found in that Document.
- Clicking a tag chip filters the sidebar to Documents with that tag.

### 5.2 Tag Filter Bar

- A filter row at the top of the sidebar (below the folder breadcrumb) shows active tag filters.
- Filters match by canonical name across **every** open database — personal and all spaces — so
  filtering by `work` finds personal and shared Documents together.
- Multiple tags can be selected (AND logic — a Document must have all selected tags).
- Each filter chip can be removed on its own; a Clear button removes all tag filters. Filters last
  for the session (they are not saved).
- While a filter is active the sidebar shows the matching Documents as a flat list in place of the
  tree: title, chips, and the space name and folder path.
- The sidebar tree already merges per-database results in JavaScript
  ([COLLAB-04 §5.3](../shipped/collab-04-shared-spaces.md)); tag filtering runs per database and merges the same
  way. Sorting and any limit are applied after merging, never per database. The order is newest
  edit first, then id: the order search gives a query of `tag:` parts alone.
- **Same Documents as `tag:`.** The filter bar is a query of `tag:` parts: filtering by `work` and
  `urgent` gives exactly the Documents `tag:work tag:urgent` gives in search. Both read the
  metadata index (§7) and both leave out Documents in the database's top-level `Trash` folder, by
  the search spec's rule (§4 there).

### 5.3 Tag Management

- Accessible via **Tools → Tags** (desktop), and **Settings → Tools → Tags** on a phone.
- Modal (reuse existing modal pattern) with a **scope selector** at the top: Personal, then each
  space the user belongs to. Everything below applies to the selected database only. It opens on
  the database of the Document being edited.
- Lists every tag in that scope — styled tags and tags found in its Documents — with swatch,
  name and Document count. The count includes Documents in Trash; the filter leaves them out.
- Per-row actions:
  - **Set color** (a row of palette swatches) and **Set display name** write the row.
  - **Reset** deletes the row; the tag returns to the neutral style.
- In a space, owners and editors can both manage tags (COLLAB-04 has no read-only role). Changes
  affect every member, so the modal says so under the scope selector: "Changes apply to everyone in
  <space name>."

**Tag management never edits Documents.** The earlier design removed a deleted tag from every
Document's front-matter. In a space that is one person silently rewriting many shared Documents,
possibly while another member has one open in a live session
([COLLAB-05](../shipped/collab-05-live-sessions.md)); it would also flood revision history. Resetting a tag
only removes its styling. Renaming a tag across Documents is out of scope for v1; a later bulk
rename must be an explicit, previewed, per-Document edit with revisions, and is its own spec.

### 5.4 Inline Tag Entry

- In the editor, front-matter `tags:` values get autocomplete suggestions from the tags known in the
  **current Document's** database (styled tags first, then tags found in its Documents, most used
  first), leaving out tags the Document already has.
- Suggestions appear while the caret is in a `tags:` value inside a front matter block at the top
  of the Document: after `tags:`, in an inline `[…]` item, or in a `- ` item under `tags:`. The block
  need not be closed yet (it is being typed). Up/Down choose, Enter or Tab accept, Esc dismisses;
  a click or tap accepts.
- Accepting replaces the partly typed name with the tag's display spelling, quoted when YAML would
  otherwise misread it.
- On a phone the same list shows under the caret; tapping accepts.

### 5.5 Phone

Phones get the parts that fit their screens (`docs/specs/shipped/mobile-ui/`): tag chips on Home
and folder cards (read from the card's Document text, colored from its database), the Tags manager
from Settings, and editor autocomplete. Filtering by tag on a phone is search's `tag:` on the
Search page, which the search spec wires (§4 and phase 4 there); the phone has no sidebar to hold
a filter bar.

---

## 6) Shared spaces

Everything in §3–§5 applies to spaces. This section lists what spaces need beyond that.

### 6.1 Sync allowlist

A space's `/sync` rejects any table or column not on `SPACE_CHANGE_ALLOWLIST`
([sync.js](../../../backend/api-service/sync.js)) with `400 SPACE_CHANGE_NOT_ALLOWED`. Add:

| Table | Allowed `cid` values |
|---|---|
| `tags` | `name`, `display_name`, `color`, `created_at`, `updated_at`, `-1` |

Update the table in [COLLAB-04 §4.2](../shipped/collab-04-shared-spaces.md) in the same change, with schema
tests that fail if `tags` gains a column the allowlist does not name. The client keeps the same
list (`SPACE_OUTGOING_COLUMNS` in `frontend/src/utils/syncRegistry.js`) and drops anything else
before upload; a table missing there is never sent from a space.

### 6.2 Schema rollout

- Existing personal and space databases need the table: add an `ensureTagsSchema` repair to
  `initializeContentDb` and bump `CONTENT_SCHEMA_VERSION` (2 → 3). The frontend runs the same
  repair when it opens a database. The repair adds any missing column through
  `crsql_begin_alter` / `crsql_commit_alter`, rebuilds stale CRR triggers, and registers the table
  as a CRR if it is not one.
- Bump `MINIMUM_CLIENT_SCHEMA_VERSION` **only after** the frontend that knows the table is
  released, per COLLAB-04 §3.1. An older client never sends `tags` changes, so the floor protects
  against an old client opening a space whose local schema it cannot maintain, not against bad
  writes. This change does not bump it.
- An older client that pulls a `tags` row cannot apply it, and that database's sync stalls until
  the service worker update reloads the app, as with the named-style tables. The whole pulled
  change set fails, `notes` rows included, and the client downloads the same batch again on every
  poke until it reloads. Uploads continue, so nothing is lost. The service worker checks for an
  update every 60 s and reloads on `controllerchange`, so the window is about a minute for an open
  tab. Rows exist only once someone styles a tag with the new client (§4.1).
- A server rolled back to a build that knows content schema 2 refuses databases this build has
  opened (`application_schema` records 3): every request for those users fails. **Roll the backend
  forward, not back.** `docs/runbooks/deployment.md` ("Rolling back a release") says so for every
  release that raises `CONTENT_SCHEMA_VERSION`.
- Ship backend first (table + allowlist), then frontend.

### 6.3 Moving a Document between databases

Front-matter tags move with the Document. Colors live in the source database and do not move on
their own. The cross-database transfer ([COLLAB-04 §5.4](../shipped/collab-04-shared-spaces.md)) gains one
step, after the destination Document is written and before it is confirmed: for each tag in the
moved Document's front-matter (`readTags`) that has a row in the source and **no row in the
destination**, copy the row to the destination. Never overwrite an existing destination row
— the space's colors belong to its members. Record the copied tags on the transfer record
(`space_transfers.copied_tags_json`; `NULL` until the step has run) so a resumed transfer does not
repeat the step, even if a destination member has reset a copied tag in between. The move
confirmation does not need to mention tags. The step applies to copies and moves alike.

### 6.4 Leaving or losing access to a space

No special handling. The space's `tags` rows live in the space's local database and are removed
with it by the existing cleanup. The in-memory index (§7) drops the space's entry when its
database is removed.

---

## 7) Data Flow

### 7.1 The Document metadata index

One **per-database in-memory index of Document metadata** serves the tag system and search
(search spec §6.3): `frontend/src/store/documentIndexStore.js`, Pinia store
`useDocumentIndexStore`.

- Per Document: its canonical tags with their display casing, and its front matter properties
  (`parseFrontMatter(head).metadata`, values unquoted as the API's `readProperties` gives them),
  read from the first 16 KB of the body (the API's `FRONT_MATTER_SCAN_CHARS`). A block longer than
  that is unclosed in the head and has neither tags nor properties, as in the API.
- Built lazily the first time something needs a database's metadata, by streaming rows in pages
  ordered by `rowid` with a yield between pages. Not during start-up: the sidebar asks for it when it
  first shows that database's Documents (its chips need it), and the first build waits for the
  browser to be idle. Only a body whose first 1 KB (after blank lines) starts with `---` sends its
  head into JS; every other row sends only its id (the API's prefilter). The build's cost on a large
  account is measured in the integration browser run (2026-11-08).
- Updated for changed Documents only:
  - every local write to `notes` (save, create, duplicate, delete, import, restore) through the
    database's update hook: the changed rows are re-read in one query shortly after, inside the
    database's exclusive queue so an open transaction has finished;
  - after sync, for the note ids in the applied change set (`syncStore` calls the index's
    `remoteChangesApplied` hook).
- Dropped when a space's database is removed (left, removed, deleted, "Remove locally"), and when
  the database handle is reopened.
- Never written to the database and never synced.

Contract (JSDoc in the store; search builds on these names):

| Member | Returns |
|---|---|
| `ensure(dbKey)` | `Promise<void>`; builds once, concurrent callers share one build |
| `isReady(dbKey)` | `boolean` |
| `entry(dbKey, id)` | `{ tags: string[], tagLabels: Record<string,string>, properties: Record<string,string> } \| null` (null before the build or for an unknown id) |
| `idsWithTags(dbKey, names)` | `Set<string>` of Documents carrying every name (AND; names canonicalised) |
| `tagCounts(dbKey)` | `Map<string, number>` canonical name → Documents |
| `tagLabel(dbKey, name)` | the most used spelling of a tag in that database |
| `propertyKeys(dbKey)` | `{ key, count }[]`, most used first; keys grouped case-insensitively |
| `propertyValues(dbKey, key)` | `{ value, count }[]`, most used first |
| `noteChanged(dbKey, id, content)` | updates one Document from its text |
| `noteRemoved(dbKey, id)` | forgets one Document |
| `remoteChangesApplied(dbKey, changes)` | the after-sync hook: refreshes the note ids in a change set |
| `drop(dbKey)` | forgets a database |
| `version`, `versionOf(dbKey)` | reactive counters that bump on every change |

### 7.2 Flow

1. A Document is saved → its row changes → the index re-reads it and reads its tags with
   `readTags` and its properties with `parseFrontMatter`.
2. The sidebar chips read `entry(dbKey, id)` and the database's `tags` rows (`tagStore`); the
   filter bar asks `idsWithTags` of every database, reads those rows' titles, paths and edit
   times, leaves out Trash and merges. Search's `tag:` asks the same `idsWithTags`.
3. Setting a color writes one `tags` row in the selected database; it syncs like any CRR row,
   to the user's other devices (personal) or to every member (space).
4. An incoming sync refreshes the index for the changed Documents and reloads the database's
   `tags` rows when the change set touches `tags`.

---

## 8) Decisions and alternatives

- **Colors per database (chosen)** vs **colors per person**. Per person would give one look across
  all of a user's Documents, but members of a space would see different colors for the same tag, so
  a color could not mean "urgent" to the team. Per database matches how globals and templates
  already behave in spaces. A per-person override can be added later without changing this schema.
- **No automatic rows** (§4.1) vs auto-create on first use: auto-creation produced a write per new
  tag on every member's client and needed a unique name to deduplicate.
- **One index for tags and search** (§7) vs a tag index of its own: two indexes would read every
  body twice and could disagree about which Documents carry a tag.
- **Update hook plus an explicit after-sync call** (§7.1): the hook catches every local write path
  without each one having to remember the index; the explicit call guarantees that synced
  Documents are refreshed whatever the hook reports during a merge.
- **Long names are ignored, not cut** (§3).

---

## 9) Security Considerations

- Tag names: trimmed, max 50 characters, rendered as text only (Vue interpolation, never
  `v-html`).
- `color` must be a known palette key; an unknown value renders as `neutral`. In a space, rows come
  from other members' clients, so the renderer — not only the editor — enforces this. A chip's
  color reaches the page only as a hex value looked up from the palette.
- A `display_name` from another member is shown only if it canonicalises to the row's name and is
  at most 50 characters; otherwise the chip falls back to the spelling found in the Document.
- The space sync allowlist (§6.1) is the only path for `tags` rows into a space database.
- Every query is parameterized; id lists are bound as one JSON array (`json_each(?)`).
- Reading tags is linear-time on hostile input (§3).

---

## 10) Tests

- Unit (`shared/`): `readTags` — a list, a single string, the inline form, quotes and comments,
  missing or unclosed or prose-ruled blocks, mixed case, white space, duplicates, the 50-character
  limit, the 100-tag cap, and 2 MiB hostile lines in linear time.
- Unit: canonicalisation and the per-database metadata index — lazy build shared by concurrent
  callers, streaming in pages, the 16 KB head, `noteChanged` / `noteRemoved`, the update hook
  (writes, deletes), the after-sync hook, `drop` and removal of a database, property keys and values.
- Unit: filter merging across personal and space databases, with sorting after the merge and
  Trash left out.
- Unit: palette verification (contrast in both themes, distance from primary/accent and between
  entries, no blue) and the renderer's fallback for an unknown key; the script runs in CI-able form.
- Unit: autocomplete context and the edit it makes; the tag store's writes (one column each,
  display-name rule, reset).
- Backend: `tags` is a CRR in personal and space databases after `initializeContentDb`, including
  a database created by the previous build (content schema 2, no `tags` table).
- Backend: `ensureTagsSchema` adds a missing column and repairs stale triggers.
- Backend: the space allowlist names exactly the `tags` columns (fails when one is added).
- Backend: space `/sync` accepts `tags` changes and still rejects an unknown `tags` column.
- Backend: concurrent writes to the same tag name from two sites converge to one row.
- Backend: a transfer copies a missing tag row, leaves an existing destination row unchanged,
  records what it copied and does not repeat the step on resume.
- Browser: style a tag in a space on one device; a second member's device shows the new color.
