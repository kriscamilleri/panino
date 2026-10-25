# Named Styles — Saved Preview and Print Styles with Folder and Template Defaults

> Status: active
> Created: 2026-10-25
> Last updated: 2026-10-25
> Shipped: —
> Implementation: —

---

## 1) Summary

Today a library has exactly one set of preview styles and one set of print styles, stored as
`settings` rows `previewStyles` and `printStyles`. This feature adds **named styles**: saved,
reusable, renameable sets of preview or print styles. A folder or a template can name a default
preview style and a default print style, and a Document can name its own in front matter.

## 2) Problem

A user who prints letters, invoices and reports from the same library has to re-edit the single
print style before each kind of export, and the preview style cannot differ between, say, a
journal and a reference manual. Nothing can be saved and recalled by name.

## 3) Goals

1. Create, rename, edit and delete named styles of two kinds: **preview** and **print**.
2. Named styles belong to a library — the personal library or a Space — like templates, so a
   Space folder or template can point at a style every member can see.
3. A folder can set a default preview style and a default print style. Subfolders inherit; the
   nearest folder with a default wins.
4. A template can set a default preview style and a default print style. A Document created from
   it gets `preview-style:` / `print-style:` front matter keys naming them.
5. A Document can name its styles directly in front matter, which overrides any folder default.
6. The live preview, the print preview page, and the phone Export sheet render with the resolved
   style.
7. The existing single styles remain as the library **Default** and keep working unchanged.

## Non-Goals

- No style inheritance between named styles (a named style is a full set, not a diff).
- No per-Document hidden style column; front matter is the per-Document mechanism.
- No import/export of named styles in the JSON/ZIP backup in this change (the existing backup
  already omits templates; tracked as a follow-up).

## 4) User Journeys

| # | Persona | Journey | Acceptance Criteria |
|---|---------|---------|---------------------|
| U1 | Writer | Opens Print styles, edits, clicks **Save as new style**, names it "Letter" | "Letter" appears in the style selector; later edits change "Letter", not Default |
| U2 | Writer | Selects "Letter" in the selector, renames it to "Formal letter" | The name changes everywhere it is listed; folder/template defaults still point at it |
| U3 | Writer | Deletes "Formal letter" | It disappears; folders/templates that used it fall back to Default; no error |
| U4 | Writer | Folder menu → **Document styles** → print style "Report" | Every Document in that folder and its subfolders prints with "Report" |
| U5 | Writer | Sets template "Invoice" default print style "Invoice", creates a Document from it | The new Document has `print-style: Invoice` in front matter and prints with it, wherever it is filed |
| U6 | Writer | Types `preview-style: Manual` in a Document's front matter | The live preview switches to "Manual" immediately (including an unsaved draft) |
| U7 | Space member | Another member sets a Space folder's default print style | After sync, this member's print of a Document in that folder uses the same style |
| U8 | Writer | Names a style that does not exist in front matter | Rendering falls back to the folder default, then Default; no error |
| U10 | Writer | Document menu → **Document styles**, picks "Manual" for preview | The dialog showed where the current style came from; the Document gains `preview-style: Manual` and previews with it; choosing Automatic removes the line |
| U9 | Phone user | Exports a PDF from the phone Export sheet | The PDF uses the resolved print style |

## 5) Design

### 5.1 Resolution order

For a given kind (`preview` or `print`) and a Document:

1. The Document's front matter key (`preview-style` / `print-style`), matched by name,
   case-insensitively, against named styles of that kind in the Document's library.
2. The nearest folder in the Document's folder trail (its own folder first, then each ancestor)
   that has an assignment of that kind pointing at an existing named style.
3. The library Default — the existing personal `previewStyles` / `printStyles` settings.

A name or assignment that points at a missing style is skipped, never an error. A Document
created from a template carries the template's choice in its front matter (step 1); templates are
not consulted at render time.

The style editor pages render with the style being **edited**, and on open they select the style
that resolves for the current Document, so what is shown is what will print.

### 5.2 Data model

Two new CRR tables, in both the browser `DB_SCHEMA` and backend `BASE_SCHEMA`, registered in
`CRR_TABLES`, and allowlisted for Space sync (`SPACE_CHANGE_ALLOWLIST` on the server,
`SPACE_OUTGOING_COLUMNS` in the browser). No column is added to an existing CRR, so no
`crsql_begin_alter` migration is needed.

```sql
CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY NOT NULL,          -- UUID
  kind TEXT NOT NULL DEFAULT 'preview',  -- 'preview' | 'print'
  name TEXT NOT NULL DEFAULT '',
  styles TEXT NOT NULL DEFAULT '{}',     -- JSON object, same shape as the settings value
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS style_assignments (
  id TEXT PRIMARY KEY NOT NULL,          -- '<target_type>:<target_id>:<kind>'
  target_type TEXT NOT NULL DEFAULT '',  -- 'folder' | 'template'
  target_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  preset_id TEXT,                        -- NULL = no default
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`style_assignments.id` is deterministic rather than a fresh UUID so that two devices assigning the
same folder converge on one row (last writer wins per column) instead of creating two competing
rows. Clearing a default sets `preset_id` to NULL rather than deleting the row, which avoids a
delete/re-insert cycle on the same key.

Deleting a named style clears every assignment pointing at it in the same transaction. Deleting a
folder or template leaves its assignment rows behind; they are inert and cost a few bytes.

`CONTENT_SCHEMA_VERSION` is **not** raised: an older backend opens a database with the extra tables
without harm, and raising it would make a rolled-back build refuse to start.

### 5.3 Front matter

Keys are `preview-style` and `print-style`. The value is the style's name; surrounding single or
double quotes are stripped. The existing front matter parser already treats unknown keys as
metadata variables, so the keys are inert outside style resolution. When a template with defaults
creates a Document, the keys are inserted into the content's front matter block, or a new block is
prepended when the content has none; an existing key of the same name is replaced.

### 5.4 Style values

A named style stores a full styles object. On load it is merged over the kind's built-in defaults
so a style saved before a new setting existed still gets that setting. Only keys present in the
defaults are kept, and values are coerced to strings (booleans for `enablePageNumbers`).

### 5.5 UI

- **Style editor pages** (`/styles`, `/print-styles`): a selector above the fields — "Default"
  plus the library's named styles of that kind — and **Save as new style**, **Rename**,
  **Delete**. Edits go to the selected style. A hint shows the front matter line that selects it.
- **Folder menu** (desktop tree): **Document styles** opens a dialog with a preview-style and a
  print-style select ("None" = inherit).
- **Template manager**: two selects, "Default preview style" and "Default print style".
- **Document styles dialog** (Document menu in the desktop tree; phone Document menu): for each
  kind, the style in use and where it comes from (this Document, a named folder, or Default),
  and a select of "Automatic" plus the library's styles. Choosing a style writes the front
  matter line; Automatic removes it. An open Document is changed through the editor, so drafts
  and live sessions stay in step; an unknown name is left alone unless replaced.

### 5.6 Rollout and compatibility

A client that has not reloaded since the deploy has no `style_presets` table and fails to apply a
pull that contains rows for it, so its sync stops until it reloads. The service worker checks for
an update every minute and reloads on activation, so the window is about a minute for an open tab
and zero for a closed one. The pull is retried and loses nothing. This was the case for
`templates` too.

## 6) Security Review

| Threat | Mitigation |
|---|---|
| SQL injection through style names or ids | All queries parameterized |
| CSS/HTML injection via style values | Same trust as today: values are the user's own CSS, applied to their own preview; print header/footer HTML is still DOMPurify-sanitized in `buildPdfRequest`; rendered Document HTML is still sanitized |
| A Space member injecting style CSS other members render | Same as a Space member editing a shared Document today: preview style values go into `style` attributes and a `<style>` element in the member's own app. Rendered Document HTML is sanitized. Print CSS goes to the server renderer, which keeps its SSRF checks for external images |
| Space sync touching unexpected tables/columns | Both new tables are added to the server allowlist column by column; anything else is still rejected whole |
| Oversized style payload | Names capped at 80 characters; styles JSON capped at 200 KB on save |

## 7) Edge Cases

- Duplicate names within a kind are refused (case-insensitive); the same name may exist as both a
  preview and a print style.
- Two devices rename the same style concurrently: last writer wins; no duplicate rows.
- A Document moved between folders re-resolves on the next render.
- A Document in a Space whose front matter names a style that exists only in the personal library
  falls back (names resolve within the Document's own library).
- A folder default that points at a deleted style is ignored.

## 8) Tests

- Unit: `frontend/tests/unit/stylePresets.test.js` — name validation, assignment ids, style
  parsing/merging, resolution order, front matter read/write.
- Store: `frontend/tests/unit/stylePresetStore.test.js` — CRUD, delete clears assignments,
  resolution with folder trail.
- Sync contract: `frontend/tests/unit/syncRegistry.test.js` (outgoing projection) and backend
  `tests/integration/sync.spaces.test.js` (allowlist accepts the new tables) plus
  `tests/unit/db.test.js` (tables exist and are CRRs).
- Browser: create/rename/delete, folder default, template default, front matter override, at
  1280px and 375px.
