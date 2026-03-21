# Tag System — Spec

> Color-coded document tags defined in front-matter, visible in the sidebar.
> Status: Draft — 2026-03-21

---

## 1) Summary

Add a tagging system where tags are declared as values in a note's YAML front-matter. Tags are displayed as color-coded badges in the sidebar next to each document. Users can create and manage tag definitions (name + color) from a dedicated management UI. Tags are persisted, synced via CR-SQLite, and usable as search/filter criteria.

---

## 2) Goals

1. Allow users to assign one or more tags to any note via front-matter.
2. Display tags as colored badges/chips in the sidebar file list.
3. Provide a tag management UI to create, rename, recolor, and delete tag definitions.
4. Sync tag definitions and assignments across devices.
5. Enable filtering the sidebar by tag.

## Non-Goals

- No hierarchical/nested tags in v1.
- No auto-tagging or AI-suggested tags.
- No tag-based access control or sharing.

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

- `tags` is an array of strings.
- Tag names are case-insensitive for matching (stored lowercased in the definition table, displayed with original casing).
- Tags referenced in front-matter that have no definition yet get a default color (neutral gray) and auto-create a definition on first encounter.

---

## 4) Tag Definitions

Each tag has a user-defined display name and color.

### Table: `tags` (CRR-synced)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `name` | TEXT UNIQUE | Lowercase canonical name |
| `display_name` | TEXT | Original-casing display name |
| `color` | TEXT | Hex color code, e.g. `#e74c3c` |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

Add to `CRR_TABLES` in `db.js` and `DB_SCHEMA` in `syncStore.js`.

### Default Color Palette

Provide 8–10 preset colors for quick selection, plus a custom color picker:

`#e74c3c` (red), `#e67e22` (orange), `#f1c40f` (yellow), `#2ecc71` (green), `#1abc9c` (teal), `#3498db` (blue), `#9b59b6` (purple), `#e91e63` (pink), `#95a5a6` (gray), `#34495e` (dark)

---

## 5) UX & UI

### Sidebar Display

- Each note in the sidebar shows its tags as small colored dots or compact chips to the right of the title.
- If a note has more than 3 tags, show the first 3 and a `+N` overflow indicator.
- Clicking a tag chip in the sidebar filters to show only notes with that tag.

### Tag Filter Bar

- A filter row at the top of the sidebar (below the folder breadcrumb) shows active tag filters.
- Multiple tags can be selected (AND logic — note must have all selected tags).
- Clear button removes all tag filters.

### Tag Management

- Accessible via **Tools → Tags**.
- Modal (reuse existing modal pattern) showing:
  - List of all defined tags with color swatch, name, and note count.
  - Per-row actions: edit name, change color, delete.
  - "Add Tag" input row at top.
- Deleting a tag definition removes it from all notes' front-matter on next sync.

### Inline Tag Entry

- In the editor, front-matter `tags:` values get autocomplete suggestions from existing tag definitions.

---

## 6) Data Flow

1. User edits front-matter `tags` array → on save, parse tags.
2. For each tag name, look up definition by canonical name.
3. If no definition exists, create one with default gray color.
4. Sidebar re-renders with tag indicators.
5. Tag definitions sync across devices via CR-SQLite CRR.

---

## 7) Security Considerations

- Tag names sanitized — strip HTML, limit length (max 50 chars).
- Color values validated as hex codes.
