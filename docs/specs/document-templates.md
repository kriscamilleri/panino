# Document Templates — Spec

> Create notes from predefined templates; manage templates from a dedicated page.
> Status: Draft — 2026-03-21

---

## 1) Summary

Add a template system that lets users create reusable document templates and instantiate new notes from them. The existing "new file" button remains unchanged. A second action — "New from Template" — presents a template picker. A dedicated template management page (accessible via Tools) allows creating, editing, previewing, and deleting templates.

---

## 2) Goals

1. Provide a "New from Template" action alongside the existing "new file" button.
2. Templates are full markdown documents (including optional front-matter).
3. Dedicated template management page under Tools.
4. Templates synced across devices via CR-SQLite.
5. Support template variables that prompt the user on creation (e.g. `{{input:Project Name}}`).

## Non-Goals

- No shared/community template library in v1.
- No template categories or folders in v1.
- No auto-applying templates to folders.

---

## 3) UX & UI

### New File Actions

In the sidebar, alongside the existing `+` (new file) button:

- **`+` button** — creates a blank note (unchanged).
- **Template icon button** (or dropdown from `+`) — opens template picker modal.

### Template Picker Modal

- Grid or list of available templates.
- Each template shows: name, short description (first line of content), and a preview snippet.
- Clicking a template creates a new note pre-filled with the template content in the current folder.
- "Blank" is always the first option (equivalent to the regular `+` button).
- If the template contains `{{input:...}}` placeholders, a form dialog appears first to collect values.

### Template Management Page

- Accessible via **Tools → Templates**.
- Full-page view (similar route pattern to other Tools pages) with:
  - List of all templates with name, description, last-modified date.
  - **Create Template** button — opens the standard editor with a new template document.
  - **Edit** — opens the template in the editor.
  - **Duplicate** — clones the template.
  - **Delete** — removes with confirmation.
  - **Preview** — renders the template markdown in the preview pane.

### Template Editor

- Uses the same markdown editor as notes.
- Templates are stored separately from notes (different table), so they don't appear in the regular file list.
- Front-matter in templates is preserved and copied into the new note.

---

## 4) Template Variables

Templates can include input placeholders that prompt the user when creating a note:

```markdown
---
title: "{{input:Document Title}}"
author: "{{input:Author Name}}"
date: "{{today}}"
tags:
  - "{{input:Primary Tag}}"
---

# {{input:Document Title}}

Created by {{input:Author Name}} on {{today}}.
```

### Built-in Variables

| Variable | Replaced With |
|----------|--------------|
| `{{today}}` | Current date (`YYYY-MM-DD`) |
| `{{now}}` | Current datetime (ISO 8601) |
| `{{input:Label}}` | User-prompted value (label shown in form) |

---

## 5) Data Model

### Table: `templates` (CRR-synced)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `name` | TEXT | Template display name |
| `content` | TEXT | Full markdown content including front-matter |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

Add to `CRR_TABLES` in `db.js` and `DB_SCHEMA` in `syncStore.js`.

---

## 6) Bundled Starter Templates

Ship a small set of default templates on first use (inserted if `templates` table is empty):

1. **Meeting Notes** — front-matter with date/attendees, sections for agenda/notes/action items.
2. **Project Brief** — title, objective, scope, timeline, stakeholders.
3. **Journal Entry** — date, mood tag, free-form body.
4. **Bug Report** — title, steps to reproduce, expected/actual behavior, severity tag.

These can be edited or deleted by the user.

---

## 7) Security Considerations

- Template content sanitized on render (same DOMPurify path as notes).
- `{{input:...}}` values sanitized before insertion.
- Template names limited to 200 chars; content size follows same limits as notes.
