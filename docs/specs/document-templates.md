# Template Manager — Spec v2

> Create, manage, and use reusable markdown templates; accessible from the Tools menu as a dedicated page.
> Status: Draft — 2026-05-03
> Replaces: v1 draft (same file, previous revision)

---

## 1) Summary

Add a template system that lets users create reusable document templates and instantiate new notes from them. The feature includes:

- A dedicated template management page accessible via **Tools → Templates** (mirroring the Images manager pattern: `AccountLayout` + table-based list).
- A "New from Template" action alongside the existing `+` new-file button in the document sidebar.
- Template variables that prompt the user at instantiation time: `{{input:Label}}`, `{{today}}`, `{{now}}`.
- CR-SQLite syncing so templates replicate across devices.
- Four bundled starter templates seeded on first use.

---

## 2) Problem

Users manually copy-paste recurring note structures (meeting notes, bug reports, journal entries, project briefs). There is no way to save, reuse, or share document structures.

Current gaps:
- No reusable document templates.
- No "new from template" flow when creating a note.
- No template management UI (list, edit, delete, duplicate).
- No template variable system for dynamic content.
- No starter templates for new users.

---

## 3) Goals

1. **Templates page** — dedicated management page under Tools, using `AccountLayout` (same as Images manager).
2. **New from Template** — secondary action alongside `+` new-file button in `Documents.vue` sidebar; opens a picker modal.
3. **Full CRUD** — create, edit, duplicate, delete templates with toast feedback.
4. **Template variables** — `{{input:Label}}` (user-prompted), `{{today}}` (YYYY-MM-DD), `{{now}}` (ISO 8601). Resolved **once** at note-creation time.
5. **Bundled starters** — four default templates seeded on first use when the `templates` table is empty.
6. **Sync** — templates stored in a new CRR-enabled `templates` table, synced via existing CR-SQLite protocol.
7. **Offline** — all template operations work fully offline (local DB reads/writes).

## Non-Goals (v1)

- No shared/community template library.
- No template categories, folders, or tags.
- No auto-applying templates to folders on creation.
- No template versioning or revision history.
- No image embedding within template content (images are note-level assets; the template editor uses a simple textarea, not the full image-capable `Editor.vue`).
- No default values in template variables (e.g. `{{input:Label:default}}`). Deferred to v1.1.
- No Ctrl+Shift+N keyboard shortcut for "New from Template". Deferred to v1.1.

---

## 4) UX & UI

### 4.1 Tools Menu Entry

Add **Templates** to the Tools submenu in `SubMenuBar.vue`, after **Images** and before **Variables**:

```
Tools
─────────────────
Dictate
Revisions
Print
─────────────────
Import
Export
Backup
Images
Templates      ← new
Variables
```

- Uses `BaseButton` with `FileText` icon from `lucide-vue-next`.
- `data-testid="submenu-tools-templates"`
- Navigates to `/templates`.
- **Not** disabled when offline — templates work fully offline.

### 4.2 New-from-Template Flow (Sidebar)

In `Documents.vue`, add a second action button next to the existing `+` new-file button:

```
[🔍 Search]  [+ File]  [+ Folder]  [📄 New from Template]
```

- **Icon**: `FileText` or `FilePlus2` from `lucide-vue-next`.
- **`data-testid`**: `documents-new-from-template-button`.
- On click, opens the **Template Picker Modal**.

#### Template Picker Modal (`TemplatePickerModal.vue`)

```
┌──────────────────────────────────────────────┐
│  New Note from Template                 [✕]  │
├──────────────────────────────────────────────┤
│                                              │
│  ○  Blank document                          │
│                                              │
│  ○  Meeting Notes                           │
│     Last edited 2 days ago                  │
│                                              │
│  ○  Project Brief                           │
│     Last edited 1 week ago                  │
│                                              │
│  ○  Journal Entry                           │
│     Last edited 3 days ago                  │
│                                              │
│  ○  Bug Report                              │
│     Last edited 5 days ago                  │
│                                              │
├──────────────────────────────────────────────┤
│                        [Cancel]  [Use Template] │
└──────────────────────────────────────────────┘
```

- Modal overlay with backdrop click-to-dismiss.
- "Blank document" is always first and pre-selected (creates an empty note — same as the `+` button).
- Each template row shows: **name** and **relative time** (e.g. "2 days ago").
- If the template has no `{{input:...}}` variables: clicking "Use Template" creates the note immediately in the current folder, resolves `{{today}}`/`{{now}}`, and navigates to it.
- If the template has `{{input:...}}` variables: clicking "Use Template" opens the **Template Variable Dialog** first.
- Loads templates from `templateStore` (which reads from local DB). Works offline.

#### Template Variable Dialog (`TemplateVariableDialog.vue`)

```
┌──────────────────────────────────────────────┐
│  Fill in Template Variables             [✕]  │
├──────────────────────────────────────────────┤
│                                              │
│  Meeting Title                               │
│  ┌──────────────────────────────────────────┐│
│  │ (enter title)                            ││
│  └──────────────────────────────────────────┘│
│                                              │
│  Attendees (comma-separated)                 │
│  ┌──────────────────────────────────────────┐│
│  │ (enter attendees)                        ││
│  └──────────────────────────────────────────┘│
│                                              │
│  Project Tag                                 │
│  ┌──────────────────────────────────────────┐│
│  │ (enter tag)                              ││
│  └──────────────────────────────────────────┘│
│                                              │
│  ... (one field per unique {{input:Label}})   │
│                                              │
├──────────────────────────────────────────────┤
│                        [Cancel]  [Create Note] │
└──────────────────────────────────────────────┘
```

- One text input per unique `{{input:Label}}` found in the template.
- Labels are displayed **above** each field (not pre-filled as the input value).
- Fields are empty by default; placeholder text is generic ("Enter value...").
- Dialog is scrollable (`max-h-[70vh] overflow-y-auto`) to handle templates with many variables.
- On submit: substitutes all `{{input:Label}}` → user values, `{{today}}` → current date, `{{now}}` → ISO datetime, creates the note in the current folder, and navigates to it.
- On cancel: returns to the picker modal.

**Determining the current folder:** Use `structureStore.selectedFolderId`. If `null`, the note is created at root. The template picker modal receives this as a prop or reads it from the store.

### 4.3 Template Management Page (`/templates`)

- Full-page view using `AccountLayout` (same as `/images`).
- Route: `/templates` (defined in `router.js` with `meta: { keepAlive: true }`).
- **Back** button in `AccountLayout` navigates to the editor (`/`).

#### List View (default)

```
┌──────────────────────────────────────────────────────────────────┐
│  Templates                                             [Back]    │
├──────────────────────────────────────────────────────────────────┤
│  Templates: 4                                          [+ New]   │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Name           │ Excerpt              │ Updated    │ Actions ││
│  ├──────────────────────────────────────────────────────────────┤│
│  │ Meeting Notes  │ # Meeting Notes\nDa… │ 2026-05-01 │ Ed Dup D││
│  │ Project Brief  │ # Project Brief\n…   │ 2026-04-28 │ Ed Dup D││
│  │ Journal Entry  │ # Journal Entry — …  │ 2026-04-30 │ Ed Dup D││
│  │ Bug Report     │ # Bug Report: …      │ 2026-04-25 │ Ed Dup D││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

- **Table layout** matching the Images manager style.
- Columns: **Name**, **Excerpt** (first line of content, truncated to ~80 chars), **Updated** (formatted via `toLocaleString()`), **Actions**.
- Action buttons (compact icon-only or icon+text `BaseButton`):
  - **Edit** (`Pencil` icon) — navigates to editor view for that template.
  - **Duplicate** (`Copy` icon) — clones with "- Copy" suffix, shows success toast.
  - **Delete** (`Trash2` icon) — shows confirmation dialog, then deletes and shows toast.
- **+ New** button opens the editor view with empty fields.
- Empty state: "No templates yet. Create one to get started."
- Loading state: "Loading templates..."

#### Editor View (create / edit)

- The page switches to an inline form within `AccountLayout` (not a separate route — use a `v-if` toggle or `currentView` ref).
- Components:
  - **Name input**: `<input>` with `maxlength="200"`, required, `data-testid="template-editor-name"`.
  - **Content textarea**: `<textarea>` for markdown content, monospaced font, sizable (min 20rem height), `data-testid="template-editor-content"`.
  - **Live preview** (optional, below textarea): renders the markdown via the same pipeline as note preview, so the user can see how template variables will look (they appear as literal text like `{{input:Meeting Title}}` in the preview — this is expected).
  - **Save button**: validates name is non-empty, writes to DB via `templateStore`, shows success toast, returns to list view.
  - **Cancel button**: returns to list view without saving. If editing an existing template, confirms before discarding unsaved changes.

**Why a textarea instead of `Editor.vue`?** `Editor.vue` is tightly coupled to `docStore.selectedFile` and the note editing lifecycle (including image upload, revision capture, etc.). Templates don't need images (Non-Goal), don't need revisions, and shouldn't interfere with the active document state. A standalone textarea + preview is simpler and avoids coupling.

---

## 5) Data Model

### 5.1 New Table: `templates` (CRR-synced)

```sql
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_updated
  ON templates(updated_at DESC);
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUIDv4 |
| `name` | TEXT | Display name, max 200 chars (enforced in UI via `maxlength`) |
| `content` | TEXT | Full markdown including optional YAML front-matter |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

No `user_id` column — templates follow the same pattern as `settings` and `globals`. Each user has their own database, so per-user isolation is already handled at the DB level.

### 5.2 Schema Registration

#### Frontend: `syncStore.js`

1. Add `CREATE TABLE IF NOT EXISTS templates (...)` + index to `DB_SCHEMA` (ensures fresh DBs get the table).
2. Create a new `ensureTemplatesSchema()` function (modeled on `ensureGlobalsSchema()`) that:
   - Checks if `templates` table exists via `PRAGMA table_info`.
   - Creates it (with index) if missing.
   - Calls `SELECT crsql_as_crr('templates')`.
   - Calls `seedDefaultTemplates()` if the table was just created or is empty.
3. Call `await ensureTemplatesSchema()` from `initializeDB()` after `ensureGlobalsSchema()`.

This pattern handles both fresh databases and upgrades from older versions that lack the `templates` table.

#### Backend: `db.js`

1. Add `CREATE TABLE IF NOT EXISTS templates (...)` + index to `BASE_SCHEMA`.
2. Add `'templates'` to the `CRR_TABLES` array.

The existing `ensureCrr()` function iterates `CRR_TABLES` and calls `crsql_as_crr` for each, so no further changes needed.

---

## 6) Template Variables

Template variables are placeholders resolved **once** when a note is created from a template. The resulting note contains literal substituted values — variables are **not** re-evaluated when the note is viewed or edited later.

For dynamic values that update each time a note is viewed, use **Global Variables** (see `docs/specs/global-variables.md`), which operate at preview/render time via the `{{ Variable Name }}` syntax.

### 6.1 Variable Types

| Variable | Resolved To | Example |
|----------|-------------|---------|
| `{{today}}` | Current date (YYYY-MM-DD) | `2026-05-03` |
| `{{now}}` | Current ISO 8601 datetime | `2026-05-03T13:00:00.000Z` |
| `{{input:Label}}` | User-provided value from the variable dialog | Whatever the user types |

### 6.2 Resolution Order

1. Scan template `content` for `{{input:Label}}` occurrences. Collect unique labels.
2. If any `{{input:...}}` found → show **Template Variable Dialog**.
3. On dialog submit:
   - Replace each `{{input:Label}}` with the user-entered value (plain text, no markdown rendering).
   - Replace all `{{today}}` with `new Date().toISOString().slice(0, 10)`.
   - Replace all `{{now}}` with `new Date().toISOString()`.
4. If no `{{input:...}}` found → skip dialog, resolve only `{{today}}` and `{{now}}`.
5. Create the note with the resolved content via `structureStore.createFile()`.

### 6.3 Regex Patterns

```javascript
// Detect input variables and extract labels
const INPUT_REGEX = /\{\{input:([^}]+)\}\}/g;

// Detect built-in variables (for replacement)
const TODAY_REGEX = /\{\{today\}\}/g;
const NOW_REGEX = /\{\{now\}\}/g;
```

### 6.4 Interaction with Existing Variable Pipeline

The existing `markdownStore.applyMetadataVariables()` resolves `{{ Variable Name }}` placeholders at **preview/render time** using front-matter metadata and global variables. Template variables (`{{input:...}}`, `{{today}}`, `{{now}}`) are resolved **at creation time** before the note is saved. These are separate passes:

1. **Creation time** (templateStore): `{{input:Label}}` → user input, `{{today}}` → date, `{{now}}` → datetime.
2. **Preview time** (markdownStore): `{{ Variable Name }}` → front-matter or global variable value.

If a user manually types `{{today}}` in a note body (not from a template), it will not be auto-resolved — it will be treated as a literal. This is intentional.

---

## 7) Bundled Starter Templates

Seeded once when the `templates` table is empty (checked inside `ensureTemplatesSchema()` after table creation + CRR registration).

### 7.1 Meeting Notes

```markdown
---
title: "{{input:Meeting Title}}"
date: "{{today}}"
attendees: "{{input:Attendees (comma-separated)}}"
tags:
  - "meeting"
  - "{{input:Project Tag}}"
---

# {{input:Meeting Title}}

**Date:** {{today}}
**Attendees:** {{input:Attendees (comma-separated)}}

## Agenda

1. {{input:Agenda Item 1}}
2. {{input:Agenda Item 2}}

## Notes

- {{input:Key discussion point}}

## Action Items

- [ ] {{input:Action item}} — Assigned to: {{input:Owner}}
```

### 7.2 Project Brief

```markdown
---
title: "{{input:Project Name}} - Project Brief"
author: "{{input:Author}}"
date: "{{today}}"
status: "draft"
tags:
  - "project"
  - "{{input:Department}}"
---

# {{input:Project Name}}

**Objective:** {{input:Project Objective}}

## Scope

{{input:Describe the scope of the project}}

## Timeline

- Start: {{today}}
- Target: {{input:Target completion date}}

## Stakeholders

- {{input:Stakeholder name and role}}
```

### 7.3 Journal Entry

```markdown
---
title: "Journal Entry - {{today}}"
date: "{{today}}"
mood: "{{input:Mood}}"
tags:
  - "journal"
---

# Journal Entry — {{today}}

**Mood:** {{input:Mood}}

{{input:What happened today?}}
```

### 7.4 Bug Report

```markdown
---
title: "Bug: {{input:Bug Title}}"
date: "{{today}}"
severity: "{{input:Severity (low/medium/high/critical)}}"
tags:
  - "bug"
  - "{{input:Component}}"
---

# Bug Report: {{input:Bug Title}}

**Severity:** {{input:Severity (low/medium/high/critical)}}
**Component:** {{input:Component}}

## Steps to Reproduce

1. {{input:Step 1}}
2. {{input:Step 2}}
3. {{input:Step 3}}

## Expected Behavior

{{input:What should happen?}}

## Actual Behavior

{{input:What actually happens?}}

## Environment

- {{input:Browser/OS/Device details}}

## Additional Context

{{input:Any logs, screenshots, or notes}}
```

### 7.5 Seeding Logic

```javascript
async function seedDefaultTemplates() {
  const rows = await db.value.execO('SELECT COUNT(*) AS cnt FROM templates');
  if (rows[0]?.cnt > 0) return;  // Already seeded

  const now = new Date().toISOString();
  const defaults = [
    { name: 'Meeting Notes',  content: '...' },
    { name: 'Project Brief',  content: '...' },
    { name: 'Journal Entry',  content: '...' },
    { name: 'Bug Report',     content: '...' },
  ];

  for (const tpl of defaults) {
    await db.value.exec(
      `INSERT INTO templates (id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), tpl.name, tpl.content, now, now]
    );
  }
}
```

- Called from `ensureTemplatesSchema()` after confirming the table exists and is empty.
- Uses `db.value.exec` directly (write operation) following the `structureStore` pattern. Alternatively, `syncStore.execute()` works too (returns `[]` for writes).

**Known limitation:** If two devices seed defaults while offline and later sync, CR-SQLite conflict resolution may produce duplicate templates (different UUIDs, same names). Users can delete duplicates manually. A future version could use deterministic UUIDs (v5, namespaced to template name) to prevent this.

---

## 8) API Contract

No new backend API routes. Templates are stored in the local CR-SQLite database and synced via the existing `POST /sync` endpoint.

- **Create / Update / Delete** — local DB operations (`INSERT`, `UPDATE`, `DELETE`), synced automatically via CR-SQLite.
- **Read** — local DB queries (`SELECT`).
- Templates work fully offline.
- No additional auth middleware or file storage needed.

### 8.1 Frontend CRUD Operations

```javascript
// List templates (ordered by updated_at DESC)
const rows = await syncStore.execute(
  'SELECT id, name, content, created_at, updated_at FROM templates ORDER BY updated_at DESC'
);

// Get single template
const [template] = await syncStore.execute(
  'SELECT id, name, content, created_at, updated_at FROM templates WHERE id = ?',
  [templateId]
);

// Create template
const id = uuidv4();
const now = new Date().toISOString();
await syncStore.execute(
  'INSERT INTO templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  [id, name, content, now, now]
);

// Update template
await syncStore.execute(
  'UPDATE templates SET name = ?, content = ?, updated_at = ? WHERE id = ?',
  [name, content, new Date().toISOString(), templateId]
);

// Delete template
await syncStore.execute('DELETE FROM templates WHERE id = ?', [templateId]);
```

Note: `syncStore.execute()` wraps `execO()`, which works for both reads and writes. This follows the `globalVariablesStore` pattern (simpler). Alternatively, use `syncStore.db.value.exec()` for writes — either works.

---

## 9) Frontend Store & Utilities

### 9.1 `templateStore.js` (`frontend/src/store/templateStore.js`)

```javascript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useSyncStore } from './syncStore';
import { useUiStore } from './uiStore';
import { v4 as uuidv4 } from 'uuid';

export const useTemplateStore = defineStore('templateStore', () => {
  const syncStore = useSyncStore();
  const uiStore = useUiStore();

  const templates = ref([]);
  const isLoading = ref(false);
  const error = ref('');

  async function loadTemplates() {
    isLoading.value = true;
    error.value = '';
    try {
      const rows = await syncStore.execute(
        'SELECT id, name, content, created_at, updated_at FROM templates ORDER BY updated_at DESC'
      );
      templates.value = rows.map(r => ({
        id: r.id,
        name: r.name,
        content: r.content,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      error.value = err.message;
    } finally {
      isLoading.value = false;
    }
  }

  async function createTemplate(name, content) {
    const id = uuidv4();
    const now = new Date().toISOString();
    try {
      await syncStore.execute(
        'INSERT INTO templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, name, content, now, now]
      );
      await loadTemplates();
      uiStore.addToast('Template created.', 'success');
      return id;
    } catch (err) {
      uiStore.addToast('Failed to create template.', 'error');
      throw err;
    }
  }

  async function updateTemplate(id, name, content) {
    const now = new Date().toISOString();
    try {
      await syncStore.execute(
        'UPDATE templates SET name = ?, content = ?, updated_at = ? WHERE id = ?',
        [name, content, now, id]
      );
      await loadTemplates();
      uiStore.addToast('Template updated.', 'success');
    } catch (err) {
      uiStore.addToast('Failed to update template.', 'error');
      throw err;
    }
  }

  async function duplicateTemplate(id) {
    const [original] = await syncStore.execute(
      'SELECT name, content FROM templates WHERE id = ?', [id]
    );
    if (!original) throw new Error('Template not found');

    const newId = uuidv4();
    const now = new Date().toISOString();
    const newName = `${original.name} - Copy`;
    try {
      await syncStore.execute(
        'INSERT INTO templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [newId, newName, original.content, now, now]
      );
      await loadTemplates();
      uiStore.addToast('Template duplicated.', 'success');
      return newId;
    } catch (err) {
      uiStore.addToast('Failed to duplicate template.', 'error');
      throw err;
    }
  }

  async function deleteTemplate(id) {
    try {
      await syncStore.execute('DELETE FROM templates WHERE id = ?', [id]);
      await loadTemplates();
      uiStore.addToast('Template deleted.', 'success');
    } catch (err) {
      uiStore.addToast('Failed to delete template.', 'error');
      throw err;
    }
  }

  return {
    templates, isLoading, error,
    loadTemplates, createTemplate, updateTemplate,
    duplicateTemplate, deleteTemplate,
  };
});
```

### 9.2 `templateVariables.js` (`frontend/src/utils/templateVariables.js`)

```javascript
/**
 * Resolve template variables in content.
 * @param {string} content - Raw template markdown
 * @param {Object<string,string>} inputValues - Map of label → user-entered value
 * @returns {string} Content with all variables substituted
 */
export function resolveTemplateVariables(content, inputValues = {}) {
  let result = content;

  // Replace {{today}} with current date (YYYY-MM-DD)
  result = result.replace(/\{\{today\}\}/g,
    new Date().toISOString().slice(0, 10));

  // Replace {{now}} with current ISO 8601 datetime
  result = result.replace(/\{\{now\}\}/g,
    new Date().toISOString());

  // Replace {{input:Label}} with user-provided values
  for (const [label, value] of Object.entries(inputValues)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{input:${escaped}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Extract unique input variable labels from template content.
 * @param {string} content - Raw template markdown
 * @returns {string[]} Unique, deduplicated labels in order of first appearance
 */
export function extractInputLabels(content) {
  const regex = /\{\{input:([^}]+)\}\}/g;
  const labels = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    labels.push(match[1]);
  }
  return [...new Set(labels)];
}
```

---

## 10) Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/TemplateManagerPage.vue` | Template list + inline editor (table layout, AccountLayout) |
| `frontend/src/components/TemplatePickerModal.vue` | Modal for selecting a template when creating a new note |
| `frontend/src/components/TemplateVariableDialog.vue` | Form dialog for filling in `{{input:...}}` variables |
| `frontend/src/store/templateStore.js` | Pinia store for template CRUD operations |
| `frontend/src/utils/templateVariables.js` | `resolveTemplateVariables()` and `extractInputLabels()` utilities |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/router.js` | Add `/templates` route → `TemplateManagerPage` (with `keepAlive`) |
| `frontend/src/components/SubMenuBar.vue` | Add Templates `BaseButton` to Tools menu (after Images, before Variables); import `FileText` icon; add `goToTemplates()` function |
| `frontend/src/components/Documents.vue` | Add "New from Template" button alongside `+`; import and wire `TemplatePickerModal` |
| `frontend/src/store/syncStore.js` | Add `templates` table + index to `DB_SCHEMA`; add `ensureTemplatesSchema()` function; call it from `initializeDB()` |
| `backend/api-service/db.js` | Add `templates` table + index to `BASE_SCHEMA`; add `'templates'` to `CRR_TABLES` |
| `frontend/src/pages/SettingsPage.vue` | Add "Manage Templates" `BaseButton` under Tools section |

---

## 11) Router Changes

In `frontend/src/router.js`:

```javascript
import TemplateManagerPage from '@/pages/TemplateManagerPage.vue';

// In routes array:
{
  path: '/templates',
  name: 'templates',
  component: TemplateManagerPage,
  meta: { keepAlive: true }
},
```

The `keepAlive: true` meta preserves the page state when navigating away and back.

---

## 12) SubMenuBar Integration

In `SubMenuBar.vue`, inside the Tools menu (`v-else-if="ui.showFileMenu"`), after the Images button and before the Variables button:

```html
<BaseButton
    @click="goToTemplates"
    data-testid="submenu-tools-templates"
>
    <FileText class="w-4 h-4" /><span>Templates</span>
</BaseButton>
```

```javascript
// Import
import { ..., FileText, ... } from 'lucide-vue-next';

// Function
function goToTemplates() {
    router.push('/templates');
}
```

No `:disabled` attribute — templates work offline.

---

## 13) Template Picker Integration (Documents.vue)

In `Documents.vue`, add a fourth button in the header button group (alongside search toggle, new file, new folder):

```html
<BaseButton
    @click="showTemplatePicker = true"
    title="New from Template"
    data-testid="documents-new-from-template-button"
>
    <FileText class="w-4 h-4" />
</BaseButton>
```

At the bottom of the template, include the modal:

```html
<TemplatePickerModal
    v-if="showTemplatePicker"
    :current-folder-id="structureStore.selectedFolderId"
    @close="showTemplatePicker = false"
    @created="onNoteCreatedFromTemplate"
/>
```

Wire up:
- `import TemplatePickerModal from '@/components/TemplatePickerModal.vue'`
- `import { useStructureStore } from '@/store/structureStore'`
- `const structureStore = useStructureStore()`
- `const showTemplatePicker = ref(false)`
- `function onNoteCreatedFromTemplate(noteId) { showTemplatePicker.value = false; router.push({ name: 'doc', params: { fileId: noteId } }); }`

---

## 14) Security Considerations

- **Sanitization**: Template content is markdown; when rendered in preview (in the template editor) it goes through the same DOMPurify + markdown-it pipeline as note content.
- **Variable injection**: User-supplied `{{input:Label}}` values are plain text inserted into a markdown string. They go through the standard markdown rendering pipeline (including sanitization). No HTML injection risk.
- **Name limits**: Template name capped at 200 chars via `maxlength` attribute on the input.
- **Content size**: Enforced at UI level (textarea), no explicit DB limit beyond SQLite defaults.
- **Auth**: All template operations use the local DB. No user ID is passed. Sync handles ownership via CR-SQLite's `site_id` mechanism.
- **No new API surface**: No backend routes added. Zero additional attack surface.

---

## 15) Implementation Plan

1. **Backend schema** — Add `templates` table + index to `BASE_SCHEMA`, add `'templates'` to `CRR_TABLES` in `db.js`. (1 file, ~10 lines)
2. **Frontend schema** — Add `templates` to `DB_SCHEMA`, create `ensureTemplatesSchema()` with seeding, call from `initializeDB()`. (1 file, ~40 lines)
3. **Utilities** — Create `frontend/src/utils/templateVariables.js`. (1 file, ~35 lines)
4. **Pinia store** — Create `frontend/src/store/templateStore.js`. (1 file, ~90 lines)
5. **Router** — Add `/templates` route in `frontend/src/router.js`. (1 file, ~7 lines)
6. **Template manager page** — Create `frontend/src/pages/TemplateManagerPage.vue` with table list + inline editor. (1 file, ~200 lines)
7. **Template picker modal** — Create `frontend/src/components/TemplatePickerModal.vue`. (1 file, ~120 lines)
8. **Template variable dialog** — Create `frontend/src/components/TemplateVariableDialog.vue`. (1 file, ~100 lines)
9. **SubMenuBar** — Add Templates button. (1 file, ~8 lines)
10. **Documents.vue** — Add "New from Template" button + wire modal. (1 file, ~20 lines)
11. **Settings page** — Add "Manage Templates" link. (1 file, ~5 lines)
12. **Tests** — Add unit tests (see §16).
13. **Chrome DevTools MCP validation** — Verify full flow end-to-end at 1280px and 375px.

---

## 16) Test Matrix

### 16.1 Template Store (`frontend/tests/unit/templateStore.test.js`)

1. `loadTemplates` returns all templates sorted by `updated_at DESC`.
2. `createTemplate` inserts row with correct UUID, timestamps, name, content; calls `uiStore.addToast`.
3. `updateTemplate` updates name, content, and `updated_at`; calls toast.
4. `duplicateTemplate` creates copy with "- Copy" suffix, different UUID, fresh timestamps; calls toast.
5. `deleteTemplate` removes row by ID; calls toast.
6. Error paths: each operation handles DB errors gracefully and surfaces via `error` ref.

### 16.2 Template Variables (`frontend/tests/unit/templateVariables.test.js`)

1. `extractInputLabels` — extracts unique labels from content with `{{input:Label}}` placeholders.
2. `extractInputLabels` (none) — returns empty array when no placeholders present.
3. `resolveTemplateVariables` — replaces `{{today}}` with current date (YYYY-MM-DD).
4. `resolveTemplateVariables` — replaces `{{now}}` with ISO 8601 string.
5. `resolveTemplateVariables` — replaces `{{input:Label}}` with provided value.
6. `resolveTemplateVariables` (multiple) — handles multiple occurrences of the same label.
7. `resolveTemplateVariables` (mixed) — handles all three variable types in one pass.
8. `resolveTemplateVariables` (regex-special chars in label) — labels with regex metacharacters don't break replacement.

### 16.3 Template Manager Page

1. List displays all templates with name, excerpt, and date.
2. Empty state shows helpful message.
3. Create: opens editor, saving inserts a row, returns to list, shows toast.
4. Edit: opens editor pre-filled with existing data, saving updates the row.
5. Cancel create/edit: returns to list without changes.
6. Duplicate: clones with "- Copy" suffix, shows toast.
7. Delete: confirmation dialog appears; on confirm, row removed, toast shown.
8. Delete cancellation: dialog dismissal does not delete.

### 16.4 Template Picker Modal

1. Modal opens from Documents.vue button; shows all templates + "Blank document" option.
2. Blank document selection creates an empty note in the current folder.
3. Template without `{{input:...}}` variables: creates note immediately with `{{today}}`/`{{now}}` resolved.
4. Template with `{{input:...}}` variables: opens variable dialog before creating note.
5. Variable dialog submission: resolves all variables, creates note, navigates to it.
6. Variable dialog cancellation: returns to picker modal, no note created.
7. Current folder is respected: note is created in `selectedFolderId` folder (or root if null).

### 16.5 SubMenuBar Tools Menu (`frontend/tests/unit/subMenuBarToolsMenu.test.js`)

1. Templates button present with `data-testid="submenu-tools-templates"`.
2. Ordering: Templates appears after Images (`submenu-tools-images`) and before Variables (`submenu-tools-variables`).
3. Templates button is NOT disabled when offline (no `:disabled` attribute).

### 16.6 Schema & Sync

1. `templates` table exists after DB init (verified via `PRAGMA table_info`).
2. Default templates seeded when table is empty on first init.
3. No duplicate seeding when table already has rows.
4. `crsql_as_crr('templates')` is called.
5. `'templates'` is in `CRR_TABLES` array on both frontend and backend.
6. Index `idx_templates_updated` exists.
7. `ensureTemplatesSchema()` handles upgrades from older DBs that lack the `templates` table.

---

## 17) Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Editor component for templates? | **Simple `<textarea>` + optional preview.** Not `Editor.vue` — avoids coupling with docStore, image upload, and revision capture. |
| New-from-Template: split button or separate icon? | **Separate icon button** next to `+` in `Documents.vue` header. Simple and unambiguous. |
| Variable default values (`{{input:Label:default}}`)? | **Deferred to v1.1.** |
| Keyboard shortcut (`Ctrl+Shift+N`)? | **Deferred to v1.1.** |
| Delete confirmation: `window.confirm()` or custom dialog? | **Custom `ConfirmDialog.vue` component** — reusable across the app. Styled consistently with the design system. |
| Template content: allow images? | **No.** Templates are plain markdown text. Images can be added after note creation. |
