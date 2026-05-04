# Template Extensions — Dynamic Titles & Default Folders

> Extends `docs/specs/document-templates.md` (v2).
> Status: Draft — 2026-05-03
> Target: v1.1 (post initial template manager implementation)

---

## 1) Summary

Add two capabilities to the template system:

1. **Dynamic title patterns** — templates can define a title generation pattern so notes created from them get auto-generated titles (e.g., `Diary Entry {{today:dd-MM-yyyy}} {{now:HH:mm}}` → `Diary Entry 03-05-2026 14:30`).
2. **Default folder assignment** — each template can optionally specify a default folder; notes created from that template are placed there regardless of which folder is currently selected in the sidebar.

Both features are entirely optional and backward-compatible: templates without a title pattern fall back to using the template `name` as the note title (current behavior), and templates without a default folder use the sidebar's currently-selected folder (current behavior).

---

## 2) Problem

**Title generation:**
Currently, when a note is created from a template, its title is set to the template's `name` (e.g., "Meeting Notes"). Users who create daily journal entries or recurring documents want auto-generated titles with date/time stamps (e.g., "Diary Entry 03-05-2026 14:30"). The only workaround is to manually rename the note after creation.

**Default folder:**
Currently, notes from templates are always created in the sidebar's currently-selected folder (or root if none selected). Users who have a dedicated folder for a specific template type (e.g., all "Meeting Notes" go into a "Meetings" folder) must manually navigate to that folder before creating the note. A default folder per template eliminates this friction.

---

## 3) Goals

1. **Title patterns** — optional `title_pattern` column on `templates`; supports `{{today}}`, `{{today:format}}`, `{{now}}`, `{{now:format}}`, and `{{input:Label}}` variables. Resolved once at note-creation time.
2. **Date/time format specifiers** — extend `{{today}}` and `{{now}}` with optional `:format` suffix using common tokens (`dd`, `MM`, `yyyy`, `HH`, `mm`, `ss`).
3. **Default folder** — optional `default_folder_id` column on `templates`; if set, overrides the sidebar's current folder when creating a note from that template.
4. **UI: Template editor** — add Title Pattern field (with variable help text) and Default Folder dropdown to the template create/edit page.
5. **UI: Template picker** — resolves title pattern (using collected `{{input:Label}}` values or directly for static patterns); respects default folder.
6. **Backward compatibility** — existing templates continue to work exactly as before. Neither new column is required.
7. **Sync** — new columns synced via existing CR-SQLite CRR on the `templates` table; no new tables needed.

## Non-Goals

- No `{{title}}` variable that pulls the filename into the content body (content already has `title:` in YAML front-matter if desired).
- No "smart title" auto-suggestion from content first line.
- No folder auto-creation (if the `default_folder_id` folder has been deleted, fall back to current folder).
- No batch re-title of existing notes.

---

## 4) Data Model Changes

### 4.1 Schema Additions to `templates`

Two new columns added to the existing `templates` table:

```sql
-- New columns (added to existing CREATE TABLE):
title_pattern TEXT NOT NULL DEFAULT '',
default_folder_id TEXT
```

No new tables. No new indexes needed.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `title_pattern` | TEXT | `''` | Optional. If empty/whitespace-only, template `name` is used as note title (current behavior). Supports `{{today}}`, `{{today:format}}`, `{{now}}`, `{{now:format}}`, `{{input:Label}}`. |
| `default_folder_id` | TEXT | `NULL` | Optional. Foreign key to `folders.id` (not enforced via FK constraint — deleted folders handled gracefully). If `NULL`, the sidebar's `selectedFolderId` is used. |

### 4.2 Updated Full Schema

```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  title_pattern TEXT NOT NULL DEFAULT '',
  default_folder_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_updated
  ON templates(updated_at DESC);
```

### 4.3 Migration Strategy

#### Frontend: `syncStore.js` → `ensureTemplatesSchema()`

The `ensureTemplatesSchema()` function already handles the evolution pattern (matching `ensureGlobalsSchema()`). When the `templates` table already exists but lacks the new columns, add them via `ALTER TABLE`:

```javascript
// In ensureTemplatesSchema(), after verifying table exists:

// Add title_pattern column if missing (added in v1.1)
const hasTitlePattern = columns.some(c => c.name === 'title_pattern');
if (!hasTitlePattern) {
  await db.value.exec(
    "ALTER TABLE templates ADD COLUMN title_pattern TEXT NOT NULL DEFAULT ''"
  );
}

// Add default_folder_id column if missing (added in v1.1)
const hasDefaultFolder = columns.some(c => c.name === 'default_folder_id');
if (!hasDefaultFolder) {
  await db.value.exec(
    'ALTER TABLE templates ADD COLUMN default_folder_id TEXT'
  );
}
```

#### Backend: `db.js`

Update `BASE_SCHEMA` to include the new columns in the `CREATE TABLE IF NOT EXISTS templates` statement. Add `'templates'` is already in `CRR_TABLES` — no change needed there. CR-SQLite's `crsql_as_crr` automatically picks up new columns added via `ALTER TABLE` on the backend side, but since the backend creates fresh DBs from `BASE_SCHEMA`, simply updating the `CREATE TABLE` statement suffices.

#### Seeded default templates

The four bundled starter templates get sensible defaults:

| Template | `title_pattern` | `default_folder_id` |
|----------|----------------|---------------------|
| Meeting Notes | `''` (use name) | `NULL` |
| Project Brief | `''` (use name) | `NULL` |
| Journal Entry | `Journal Entry — {{today:dd-MM-yyyy}}` | `NULL` |
| Bug Report | `Bug Report: {{input:Bug Title}}` | `NULL` |

The Journal Entry template already has a front-matter `title: "Journal Entry - {{today}}"` in its content. The `title_pattern` adds a richer date format in the filename itself. Users can edit or clear it.

---

## 5) Template Variable System Extension

### 5.1 New Syntax: `{{today:format}}` and `{{now:format}}`

Extend the existing `{{today}}` and `{{now}}` variable syntax with an optional format specifier:

```
{{today}}            → 2026-05-03           (unchanged)
{{today:dd-MM-yyyy}} → 03-05-2026
{{today:MM/dd/yy}}   → 05/03/26
{{now}}              → 2026-05-03T14:30:00.000Z  (unchanged)
{{now:HH:mm}}        → 14:30
{{now:HH:mm:ss}}     → 14:30:00
{{now:yyyy-MM-dd HH:mm}} → 2026-05-03 14:30
```

### 5.2 Format Tokens

| Token | Meaning | Example output |
|-------|---------|----------------|
| `yyyy` | 4-digit year | `2026` |
| `yy` | 2-digit year | `26` |
| `MM` | 2-digit month (01–12) | `05` |
| `dd` | 2-digit day of month (01–31) | `03` |
| `HH` | 2-digit hour, 24h (00–23) | `14` |
| `mm` | 2-digit minute (00–59) | `30` |
| `ss` | 2-digit second (00–59) | `00` |

All tokens are case-sensitive. Unrecognized characters pass through unchanged (so literal text like `-`, `/`, ` `, `:` works naturally).

### 5.3 Resolution Order (updated)

1. `{{today:format}}` and `{{now:format}}` — resolved first (no user input needed).
2. `{{today}}` and `{{now}}` (without format) — resolved as before.
3. `{{input:Label}}` — resolved from user-provided values.

This ordering ensures that a `{{today:format}}` is not partially matched by the `{{today}}` regex. Implementation detail: match the format-suffix variants before the plain variants.

### 5.4 Updated Regex Patterns

```javascript
// In templateVariables.js

// Match {{today:format}} — format group is optional
const TODAY_REGEX = /\{\{today(?::([^}]*))?\}\}/g;

// Match {{now:format}} — format group is optional
const NOW_REGEX = /\{\{now(?::([^}]*))?\}\}/g;

// Match {{input:Label}} — unchanged
const INPUT_REGEX = /\{\{input:([^}]+)\}\}/g;
```

### 5.5 `formatDate()` Utility

New helper in `templateVariables.js`:

```javascript
/**
 * Format a Date object using simple pattern tokens.
 * Supports: yyyy, yy, MM, dd, HH, mm, ss
 * Unrecognized characters pass through unchanged.
 * @param {Date} date
 * @param {string} format
 * @returns {string}
 */
export function formatDate(date, format) {
  const pad = (n) => String(n).padStart(2, '0');
  const tokens = {
    'yyyy': date.getFullYear(),
    'yy':   String(date.getFullYear()).slice(-2),
    'MM':   pad(date.getMonth() + 1),
    'dd':   pad(date.getDate()),
    'HH':   pad(date.getHours()),
    'mm':   pad(date.getMinutes()),
    'ss':   pad(date.getSeconds()),
  };

  let result = format;
  // Replace longer tokens first to avoid partial matches
  const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const token of sortedKeys) {
    result = result.replace(new RegExp(token, 'g'), tokens[token]);
  }
  return result;
}
```

### 5.6 Updated `resolveTemplateVariables()` Signature

The function stays the same; internally it uses the updated regexes and calls `formatDate` when a format suffix is present:

```javascript
export function resolveTemplateVariables(content, inputValues = {}) {
  let result = content;

  // {{today:format}} and {{now:format}} first
  result = result.replace(TODAY_REGEX, (_, format) => {
    const d = new Date();
    return format ? formatDate(d, format) : d.toISOString().slice(0, 10);
  });
  result = result.replace(NOW_REGEX, (_, format) => {
    const d = new Date();
    return format ? formatDate(d, format) : d.toISOString();
  });

  // {{input:Label}} — unchanged
  for (const [label, value] of Object.entries(inputValues)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{input:${escaped}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}
```

### 5.7 Title Resolution

Resolving a title pattern works the same as resolving content — it calls `resolveTemplateVariables(titlePattern, inputValues)`. The only difference is that the result becomes the note's `title` property instead of being embedded in `content`.

If the resolved title is empty or whitespace-only (all variables resolved to empty strings), fall back to the template `name`.

---

## 6) UX & UI

### 6.1 Template Editor — New Fields

The template create/edit page (`TemplateManagerPage.vue`, editor view) gains two new form fields between "Name" and "Content":

```
┌──────────────────────────────────────────┐
│  Name                                    │
│  ┌──────────────────────────────────────┐│
│  │ Journal Entry                        ││
│  └──────────────────────────────────────┘│
│                                          │
│  Title Pattern              (optional)   │
│  ┌──────────────────────────────────────┐│
│  │ Journal Entry — {{today:dd-MM-yyyy}} ││
│  └──────────────────────────────────────┘│
│  ℹ️ Available: {{today}}, {{today:format}},│
│    {{now}}, {{now:format}}, {{input:Label}}│
│    Format tokens: dd MM yyyy yy HH mm ss  │
│                                          │
│  Default Folder            (optional)    │
│  ┌──────────────────────────────────────┐│
│  │ [Meetings                    ▾]  [✕] ││
│  └──────────────────────────────────────┘│
│                                          │
│  Content                                 │
│  ┌──────────────────────────────────────┐│
│  │ ...                                  ││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
```

- **Title Pattern** — text input, `maxlength="500"`, placeholder: `Defaults to template name`. The help text below the input is a small muted paragraph listing available variables and format tokens. `data-testid="template-editor-title-pattern"`.
- **Default Folder** — a `<select>` dropdown listing all folders in a flat, indented hierarchy (similar to the move-to-folder dialog elsewhere in the app). First option is "— Use current folder —" (value empty string). A small `[✕]` clear button appears when a folder is selected. `data-testid="template-editor-default-folder"`.

### 6.2 Template List View — Additional Columns

The template list table gains two optional indicator columns:

```
| Name          | Excerpt          | Title Pattern       | Folder    | Updated | Actions |
|---------------|------------------|---------------------|-----------|---------|---------|
| Journal Entry | # Journal Entr…  | … — {{today:dd-M…}} | —         | 2h ago  | …       |
| Bug Report    | # Bug Report: …  | Bug Report: {{in…}} | Bugs/     | 1d ago  | …       |
```

- **Title Pattern** column: shows truncated pattern text, or "—" if empty.
- **Folder** column: shows folder name (or path like `Projects/Bugs/`) if set, or "—" if none.

These columns are informational and help users understand at a glance how each template behaves. If the table feels too crowded at 375px width, these columns can stack or hide behind a responsive breakpoint.

### 6.3 Template Picker Modal — Behavior Changes

The `TemplatePickerModal.vue` logic changes:

**Before (current):**
1. User picks a template → if it has `{{input:...}}` vars, show variable dialog; otherwise resolve + create immediately.
2. Note title = `template.name`.
3. Note folder = `currentFolderId` prop.

**After (with extensions):**
1. User picks a template → resolve the title pattern:
   - If the title pattern contains `{{input:Label}}` variables, show the variable dialog (same as current flow).
   - If the title pattern has NO `{{input:...}}` variables, resolve `{{today}}`/`{{now}}` variants directly in the title pattern → proceed to creation.
2. Note title = resolved `title_pattern`, or `template.name` if pattern is empty/resolves to empty.
3. Note folder = `template.default_folder_id` if set, otherwise `currentFolderId` prop (current behavior).

**Key detail:** The "has input variables" check must now scan BOTH `template.content` AND `template.title_pattern` for `{{input:Label}}` placeholders. If either has input variables, the variable dialog must appear.

**Variable dialog:** The labels presented to the user are the union of input labels from both content and title pattern (deduplicated). There is no visual distinction between "this label is for the title" vs "this label is for the content" — that's an implementation detail the user shouldn't need to worry about.

### 6.4 Variable Dialog — No Visual Changes

The `TemplateVariableDialog.vue` component does not change. It already collects values for all `{{input:Label}}` labels and passes them back. The caller (`TemplatePickerModal`) is responsible for resolving both the title pattern and the content using the same values map.

---

## 7) Implementation Details

### 7.1 Updated `resolveTemplateVariables()` and `extractInputLabels()`

`extractInputLabels()` must also scan an optional second argument (`titlePattern`) so the picker modal can get the union of labels from both content and title pattern:

```javascript
/**
 * Extract unique input variable labels from one or more template strings.
 * @param {string} content - Raw template markdown
 * @param {string} [titlePattern=''] - Optional title pattern
 * @returns {string[]} Unique, deduplicated labels in order of first appearance
 */
export function extractInputLabels(content, titlePattern = '') {
  const regex = /\{\{input:([^}]+)\}\}/g;
  const labels = [];
  let match;
  const combined = `${content}\n${titlePattern}`;
  while ((match = regex.exec(combined)) !== null) {
    labels.push(match[1]);
  }
  return [...new Set(labels)];
}
```

### 7.2 Template Picker Modal — Updated Logic

```javascript
// In TemplatePickerModal.vue → handleUseTemplate()

async function handleUseTemplate() {
  if (selectedTemplateId.value === '__blank__') {
    const result = await structureStore.createFile('Untitled', props.currentFolderId);
    emit('created', result.id);
    return;
  }

  const tpl = templateStore.templates.find(t => t.id === selectedTemplateId.value);
  if (!tpl) return;

  // Scan BOTH content and title_pattern for input variables
  const inputLabels = extractInputLabels(tpl.content, tpl.title_pattern || '');

  if (inputLabels.length === 0) {
    // No input variables — resolve and create immediately
    const folderId = tpl.default_folder_id || props.currentFolderId;
    await createNoteFromTemplate(tpl, {}, folderId);
  } else {
    // Has input variables — show dialog
    activeTemplate.value = tpl;
    showVariableDialog.value = true;
  }
}

async function createNoteFromTemplate(tpl, inputValues, folderId) {
  const titlePattern = tpl.title_pattern?.trim();
  let noteTitle = tpl.name;

  if (titlePattern) {
    const resolved = resolveTemplateVariables(titlePattern, inputValues).trim();
    if (resolved) noteTitle = resolved;
  }

  const resolvedContent = resolveTemplateVariables(tpl.content, inputValues);
  const result = await structureStore.createFile(noteTitle, folderId);
  await structureStore.updateFileContent(result.id, resolvedContent);
  emit('created', result.id);
}

async function onVariablesApplied(inputValues) {
  showVariableDialog.value = false;
  if (!activeTemplate.value) return;

  const tpl = activeTemplate.value;
  const folderId = tpl.default_folder_id || props.currentFolderId;
  await createNoteFromTemplate(tpl, inputValues, folderId);
  activeTemplate.value = null;
}
```

### 7.3 Template Store — Updated CRUD

The `templateStore.js` functions must handle the two new columns:

**`loadTemplates()`** — add columns to SELECT:
```javascript
const rows = await syncStore.execute(
  'SELECT id, name, content, title_pattern, default_folder_id, created_at, updated_at FROM templates ORDER BY updated_at DESC'
);
templates.value = rows.map(r => ({
  id: r.id,
  name: r.name,
  content: r.content,
  titlePattern: r.title_pattern || '',
  defaultFolderId: r.default_folder_id || null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
}));
```

**`createTemplate()`** — add columns to INSERT:
```javascript
await syncStore.execute(
  'INSERT INTO templates (id, name, content, title_pattern, default_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [id, name, content, titlePattern || '', defaultFolderId || null, now, now]
);
```

**`updateTemplate()`** — add columns to UPDATE:
```javascript
await syncStore.execute(
  'UPDATE templates SET name = ?, content = ?, title_pattern = ?, default_folder_id = ?, updated_at = ? WHERE id = ?',
  [name, content, titlePattern || '', defaultFolderId || null, now, id]
);
```

**`duplicateTemplate()`** — copy new columns:
```javascript
await syncStore.execute(
  'INSERT INTO templates (id, name, content, title_pattern, default_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [newId, newName, orig.content, orig.title_pattern || '', orig.default_folder_id || null, now, now]
);
```

The store function signatures change:

```javascript
async function createTemplate(name, content, titlePattern = '', defaultFolderId = null)
async function updateTemplate(id, name, content, titlePattern = '', defaultFolderId = null)
```

All callers (primarily `TemplateManagerPage.vue`) must pass the new arguments.

### 7.4 Template Manager Page — Updated Editor

The `TemplateManagerPage.vue` form gains two new reactive fields:

```javascript
const form = reactive({
  name: '',
  titlePattern: '',
  defaultFolderId: null,
  content: '',
});
```

And two new form controls in the editor view (see §6.1 mockup).

The folder dropdown is populated from the structure store:

```javascript
import { useStructureStore } from '@/store/structureStore';
const structureStore = useStructureStore();

// Build a flat list of folders with indentation for the dropdown
const folderOptions = computed(() => {
  const options = [{ id: '', name: '— Use current folder —' }];
  // Walk the folder tree; include all folders with depth-based indentation
  function walk(items, depth = 0) {
    for (const item of items) {
      if (item.type === 'folder') {
        const prefix = '  '.repeat(depth);
        options.push({ id: item.id, name: prefix + item.name });
        const children = structureStore.getChildren(item.id);
        walk(children, depth + 1);
      }
    }
  }
  walk(structureStore.rootItems);
  return options;
});
```

### 7.5 Deleted Folder Handling

If a template's `default_folder_id` points to a folder that has been deleted:

1. The folder dropdown in the editor will not show deleted folders (they're gone from the tree), but the stored `default_folder_id` value remains in the DB.
2. At note-creation time in `TemplatePickerModal`, validate the folder exists before using it. If the folder doesn't exist, fall back to `currentFolderId`:

```javascript
function resolveTargetFolder(tpl) {
  if (tpl.default_folder_id) {
    // Check folder still exists in the local tree
    const exists = /* walk tree, check IDs */;
    if (exists) return tpl.default_folder_id;
  }
  return props.currentFolderId;
}
```

A simpler approach: query the DB directly — `SELECT COUNT(*) FROM folders WHERE id = ?`. Since CR-SQLite syncs deletions, this is reliable.

---

## 8) Files to Modify

### Modified Files (no new files needed)

| File | Changes |
|------|---------|
| `frontend/src/utils/templateVariables.js` | Add `formatDate()`, update `TODAY_REGEX`/`NOW_REGEX` with format suffix support, update `resolveTemplateVariables()`, update `extractInputLabels()` to accept optional `titlePattern` arg |
| `frontend/src/store/templateStore.js` | Add `titlePattern`/`defaultFolderId` to all CRUD functions and mapping |
| `frontend/src/store/syncStore.js` | Update `DB_SCHEMA` (new columns in CREATE TABLE), update `ensureTemplatesSchema()` with migration ALTER TABLEs, update `seedDefaultTemplates()` with title_pattern defaults |
| `frontend/src/components/TemplatePickerModal.vue` | Update `handleUseTemplate()` and `onVariablesApplied()` to resolve title pattern and respect default folder; add `createNoteFromTemplate()` helper; scan title_pattern for input labels |
| `frontend/src/pages/TemplateManagerPage.vue` | Add Title Pattern and Default Folder fields to editor form; add columns to list view; build folder dropdown from structure store |
| `backend/api-service/db.js` | Update `BASE_SCHEMA` CREATE TABLE templates with new columns |
| `frontend/tests/unit/templateVariables.test.js` | Add tests for `formatDate()`, `{{today:format}}`, `{{now:format}}`, title pattern extraction |
| `frontend/tests/unit/templateStore.test.js` | Update INSERT/UPDATE/SELECT tests for new columns |
| `docs/specs/document-templates.md` | Add cross-reference to this extension spec under Non-Goals / Future |

### No New Files

All changes are modifications to existing files. The two new features are narrow enough to fit within the existing component and store structure.

---

## 9) Router Changes

None. The template manager remains at `/templates`.

---

## 10) Security Considerations

- **Title pattern injection**: Title patterns go through the same `resolveTemplateVariables()` pipeline. User-supplied `{{input:Label}}` values are plain text. The resulting title is stored as the `notes.title` value, which is always rendered as plain text (not HTML) throughout the app. No XSS risk.
- **Folder traversal**: The `default_folder_id` references a folder UUID. In the unlikely event of a tampered UUID, the worst case is the note ends up at root (folder not found fallback). No path traversal or unauthorized access.
- **No new API surface**: All changes are frontend-only. The backend schema update is additive and backward-compatible (new columns with defaults).

---

## 11) Test Matrix Additions

### 11.1 Template Variables (`templateVariables.test.js`)

| # | Test |
|---|------|
| 1 | `formatDate` renders `dd-MM-yyyy` correctly |
| 2 | `formatDate` renders `HH:mm` correctly |
| 3 | `formatDate` renders `yyyy-MM-dd HH:mm:ss` correctly |
| 4 | `formatDate` passes through unrecognized characters unchanged |
| 5 | `formatDate` handles single-digit month/day correctly (padding) |
| 6 | `{{today:dd-MM-yyyy}}` resolves to `03-05-2026` (for known date) |
| 7 | `{{today:MM/dd/yy}}` resolves with 2-digit year |
| 8 | `{{now:HH:mm}}` resolves to current time in 24h format |
| 9 | `{{now:HH:mm:ss}}` includes seconds |
| 10 | `{{today}}` without format still works as before |
| 11 | `{{now}}` without format still works as before |
| 12 | Mixed format and non-format variables in same string |
| 13 | `extractInputLabels` with title pattern argument returns union of labels |
| 14 | `extractInputLabels` with empty title pattern returns only content labels (backward compat) |
| 15 | `resolveTemplateVariables` resolves title_pattern-style string with format variables |

### 11.2 Template Store (`templateStore.test.js`)

| # | Test |
|---|------|
| 1 | `loadTemplates` maps `title_pattern` and `default_folder_id` columns |
| 2 | `createTemplate` accepts and INSERTs `titlePattern` and `defaultFolderId` |
| 3 | `updateTemplate` accepts and UPDATEs `titlePattern` and `defaultFolderId` |
| 4 | `duplicateTemplate` copies `title_pattern` and `default_folder_id` from source |

### 11.3 Template Creation Flow

| # | Test |
|---|------|
| 1 | Template with empty `title_pattern` uses `name` as note title (unchanged behavior) |
| 2 | Template with `title_pattern: "Diary {{today:dd-MM-yyyy}}"` creates note with formatted date title |
| 3 | Template with `title_pattern` containing `{{input:Label}}` prompts variable dialog for title labels |
| 4 | Template with `title_pattern` containing both `{{today:format}}` and `{{input:Label}}` resolves all correctly |
| 5 | Template with `default_folder_id` creates note in that folder regardless of `currentFolderId` |
| 6 | Template with deleted `default_folder_id` falls back to `currentFolderId` |
| 7 | Template with `default_folder_id = NULL` uses `currentFolderId` (unchanged behavior) |

### 11.4 Template Manager Page

| # | Test |
|---|------|
| 1 | Editor shows Title Pattern field with help text |
| 2 | Editor shows Default Folder dropdown populated from folder tree |
| 3 | Default Folder dropdown has "— Use current folder —" as first option |
| 4 | Saving template persists `title_pattern` and `default_folder_id` |
| 5 | Editing existing template pre-fills Title Pattern and Default Folder |
| 6 | List view shows Title Pattern and Folder columns (or "—" when empty) |

---

## 12) Implementation Order

1. **`templateVariables.js`** — add `formatDate()`, update regexes, update `resolveTemplateVariables()`, update `extractInputLabels()`
2. **`syncStore.js`** — update `DB_SCHEMA`, `ensureTemplatesSchema()` migration, `seedDefaultTemplates()` defaults
3. **`templateStore.js`** — update all CRUD functions for new columns
4. **`db.js` (backend)** — update `BASE_SCHEMA`
5. **`TemplateManagerPage.vue`** — add editor fields, list columns
6. **`TemplatePickerModal.vue`** — update creation logic
7. **Tests** — update and add per test matrix
8. **Chrome DevTools MCP validation** — verify at 1280px and 375px

---

## 13) Open Questions

| Question | Proposed Answer |
|----------|-----------------|
| Should format tokens be configurable/extensible? | **No.** The 7 tokens cover 99% of use cases. Keep it simple. |
| Should the title pattern support `{{title}}` to reference the template name? | **No.** If a user wants the template name in the pattern, they type it literally. The fallback already handles "use the template name." |
| Should default folder override be override-able at pick time (e.g., checkbox "Use current folder instead")? | **Deferred.** If users request it, add a small toggle in the picker modal later. For v1.1, the template setting is authoritative. |
| What happens if the resolved title exceeds a max length? | Titles are stored in `notes.title TEXT` (no DB limit). For UI display, filenames are truncated by existing CSS (`truncate`). No explicit enforcement — same as manually-entered titles. |
