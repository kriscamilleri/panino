# Tag System — Spec

> Color-coded document tags defined in front-matter, visible in the sidebar.
> Status: proposed
> Created: 2026-03-21
> Last updated: 2026-10-25 — redesigned for shared spaces (COLLAB-04)

---

## 1) Summary

Add a tagging system where tags are declared as values in a Document's YAML front-matter. Tags are displayed as color-coded badges in the sidebar next to each Document. Users can give a tag a display name and color from a dedicated management UI. Tag colors are stored per database, synced via CR-SQLite, and usable as search/filter criteria.

Tags work the same way in a personal database and in a shared space
([COLLAB-04](collab-04-shared-spaces.md)). A space has its own shared set of tag colors, exactly as
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

- `tags` is an array of strings. A single string (`tags: work`) is read as a one-item array.
- Tag names are case-insensitive for matching. The **canonical name** is the trimmed,
  lowercased value; the original casing is kept for display.
- Front-matter is the only source of truth for *which* tags a Document has. Because it is part of
  the Document's content, assignments travel with the Document: they sync, merge
  ([COLLAB-02](collab-02-content-merge.md)), appear in revision history and move with the Document
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
| `name` | TEXT PK NOT NULL | Canonical (lowercased) name |
| `display_name` | TEXT NOT NULL DEFAULT '' | Preferred casing; empty means use the casing found in the Document |
| `color` | TEXT NOT NULL DEFAULT '' | A palette key (§4.2); empty means neutral |
| `created_at` | TEXT NOT NULL | ISO 8601 |
| `updated_at` | TEXT NOT NULL | ISO 8601 |

Add to `BASE_SCHEMA` and `CRR_TABLES` in `backend/api-service/db.js` and to `DB_SCHEMA` in
`frontend/src/store/syncStore.js`.

**Why the name is the primary key.** CR-SQLite does not allow a unique index other than the
primary key on a CRR table, so the earlier design (UUID `id` plus `UNIQUE(name)`) cannot be made a
CRR. Even if it could, two editors in a space who each style a new tag "work" on different devices
would create two rows for one tag. With the canonical name as the key, both write the same row and
CR-SQLite merges them column by column (last writer wins per column). This mirrors `globals`
(`key` primary key plus `display_key`).

### 4.1 When a row exists

A row is written only when someone sets a display name or color in the management UI. Mentioning a
tag in a Document never creates one. This keeps sync quiet, avoids every member's client racing to
create the same rows in a space, and means the management list is the union of styled tags (rows)
and tags found in the database's Documents.

### 4.2 Palette

Store a palette **key**, not a hex value, so colors can be retuned for contrast without a data
migration. The palette must:

- pass at least 3:1 contrast against both `#ffffff` and `--pn-surface: #151515`, the same rule as
  the identity palette in [COLLAB-03 §3](collab-03-identity-palette.md) (the earlier list's yellow
  `#f1c40f` and gray `#95a5a6` fail on white);
- stay perceptually distinct from `--pn-primary` and `--pn-accent`;
- include a `neutral` entry, used when `color` is empty or unknown.

No free-form color picker in v1: it cannot be held to the contrast rule.

### 4.3 Tags and people's colors

People in a space are shown with colors from the identity palette, which already covers most hues
(rose, orange, amber, olive, green, teal, cyan, pink). Tag colors cannot avoid all of them, so tags
and people are told apart by **shape, not hue**:

- people are filled circles with initials (COLLAB-03 `AvatarStack`);
- tags are rounded-rectangle chips with a `#` glyph and the tag name, or, where space is short, a
  small square swatch — never a filled circle.

A verification script (alongside `scripts/verify-identity-palette.cjs`) checks the contrast rules
above.

---

## 5) UX & UI

### 5.1 Sidebar Display

- Each Document in the sidebar shows its tags as compact chips to the right of the title.
- If a Document has more than 3 tags, show the first 3 and a `+N` overflow indicator.
- A chip uses the color from the Document's own database. A Document in a space shows the space's
  color for that tag, even if you styled the same tag differently in your personal Documents.
- Clicking a tag chip filters the sidebar to Documents with that tag.

### 5.2 Tag Filter Bar

- A filter row at the top of the sidebar (below the folder breadcrumb) shows active tag filters.
- Filters match by canonical name across **every** open database — personal and all spaces — so
  filtering by `work` finds personal and shared Documents together.
- Multiple tags can be selected (AND logic — a Document must have all selected tags).
- Clear button removes all tag filters.
- The sidebar tree already merges per-database results in JavaScript
  ([COLLAB-04 §5.3](collab-04-shared-spaces.md)); tag filtering runs per database and merges the same
  way. Sorting and any limit are applied after merging, never per database.

### 5.3 Tag Management

- Accessible via **Tools → Tags**.
- Modal (reuse existing modal pattern) with a **scope selector** at the top: Personal, then each
  space the user belongs to. Everything below applies to the selected database only.
- Lists every tag in that scope — styled tags and tags found in its Documents — with swatch,
  name and Document count.
- Per-row actions:
  - **Set color** and **Set display name** write the row.
  - **Reset** deletes the row; the tag returns to the neutral style.
- In a space, owners and editors can both manage tags (COLLAB-04 has no read-only role). Changes
  affect every member, so the modal says so under the scope selector: "Changes apply to everyone in
  <space name>."

**Tag management never edits Documents.** The earlier design removed a deleted tag from every
Document's front-matter. In a space that is one person silently rewriting many shared Documents,
possibly while another member has one open in a live session
([COLLAB-05](collab-05-live-sessions.md)); it would also flood revision history. Resetting a tag
only removes its styling. Renaming a tag across Documents is out of scope for v1; a later bulk
rename must be an explicit, previewed, per-Document edit with revisions, and is its own spec.

### 5.4 Inline Tag Entry

- In the editor, front-matter `tags:` values get autocomplete suggestions from the tags known in the
  **current Document's** database (styled tags first, then tags found in its Documents).

---

## 6) Shared spaces

Everything in §3–§5 applies to spaces. This section lists what spaces need beyond that.

### 6.1 Sync allowlist

A space's `/sync` rejects any table or column not on `SPACE_CHANGE_ALLOWLIST`
([sync.js](../../../backend/api-service/sync.js)) with `400 SPACE_CHANGE_NOT_ALLOWED`. Add:

| Table | Allowed `cid` values |
|---|---|
| `tags` | `name`, `display_name`, `color`, `created_at`, `updated_at`, `-1` |

Update the table in [COLLAB-04 §4.2](collab-04-shared-spaces.md) in the same change, with schema
tests that fail if `tags` gains a column the allowlist does not name.

### 6.2 Schema rollout

- Existing personal and space databases need the table: add an `ensureTagsSchema` repair to
  `initializeContentDb` and bump `CONTENT_SCHEMA_VERSION`.
- Bump `MINIMUM_CLIENT_SCHEMA_VERSION` **only after** the frontend that knows the table is
  released, per COLLAB-04 §3.1. An older client never sends `tags` changes, so the floor protects
  against an old client opening a space whose local schema it cannot maintain, not against bad
  writes.
- Ship backend first (table + allowlist), then frontend.

### 6.3 Moving a Document between databases

Front-matter tags move with the Document. Colors live in the source database and do not move on
their own. The cross-database transfer ([COLLAB-04 §5.4](collab-04-shared-spaces.md)) gains one
step: for each tag in the moved Documents' front-matter that has a row in the source and **no row
in the destination**, copy the row to the destination. Never overwrite an existing destination row
— the space's colors belong to its members. Record copied tags on the transfer record so a resumed
transfer does not repeat the step. The move confirmation does not need to mention tags.

### 6.4 Leaving or losing access to a space

No special handling. The space's `tags` rows live in the space's local database and are removed
with it by the existing cleanup.

---

## 7) Data Flow

1. A Document is saved → its front-matter `tags` are parsed (reuse the front-matter parser in
   `markdownStore.js`) and kept in an in-memory index per database: canonical name → Document ids.
2. The sidebar and filter bar read that index plus the database's `tags` rows.
3. Setting a color writes one `tags` row in the selected database; it syncs like any CRR row,
   to the user's other devices (personal) or to every member (space).
4. An incoming sync refreshes the index for changed Documents and the colors for changed rows.

---

## 8) Decisions and alternatives

- **Colors per database (chosen)** vs **colors per person**. Per person would give one look across
  all of a user's Documents, but members of a space would see different colors for the same tag, so
  a color could not mean "urgent" to the team. Per database matches how globals and templates
  already behave in spaces. A per-person override can be added later without changing this schema.
- **No automatic rows** (§4.1) vs auto-create on first use: auto-creation produced a write per new
  tag on every member's client and needed a unique name to deduplicate.

---

## 9) Security Considerations

- Tag names: trimmed, max 50 characters, rendered as text only (Vue interpolation, never
  `v-html`).
- `color` must be a known palette key; an unknown value renders as `neutral`. In a space, rows come
  from other members' clients, so the renderer — not only the editor — enforces this.
- The space sync allowlist (§6.1) is the only path for `tags` rows into a space database.

---

## 10) Tests

- Unit: front-matter parsing (array, single string, missing, malformed, mixed case, duplicates).
- Unit: canonicalization and the per-database tag index.
- Unit: filter merging across personal and space databases, with sorting after the merge.
- Unit: palette verification script (contrast in both themes, distance from primary/accent).
- Backend: `tags` is a CRR in personal and space databases after `initializeContentDb`, including
  a database created by the previous client.
- Backend: space `/sync` accepts `tags` changes and still rejects an unknown `tags` column.
- Backend: concurrent writes to the same tag name from two sites converge to one row.
- Backend: a transfer copies a missing tag row and leaves an existing destination row unchanged.
- Browser: style a tag in a space on one device; a second member's device shows the new color.
