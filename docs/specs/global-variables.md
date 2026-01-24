# Global Variables (Frontend) – Spec

## Summary
Add a global variables feature to Panino’s frontend so users can define variables that are available across all documents. Global variables are managed from a new **Tools → Variables** modal (reusing the Export modal layout). Local document front‑matter variables continue to work and **override** any global variable with the same name. Global variables are persisted in the database and synced via existing CR‑SQLite replication.

## Goals
- Provide a **Variables** modal under Tools.
- Allow users to **add, edit, and delete** global variables (key/value pairs).
- Make global variables available in **preview** and **PDF output** for all documents.
- Ensure **local front‑matter variables take precedence** over globals.
- Persist globals in the DB and **sync** them across devices.

## Non‑Goals
- No backend changes beyond existing sync (reuse current sync tables).
- No variable templating beyond simple `{{ Variable Name }}` replacement.
- No variable type system (all values are treated as strings).

## UX & UI
### Entry Point
- Add a new button **Variables** under the Tools section.

### Modal
- Reuse the Export modal layout for styling/behavior (overlay, close button, backdrop).
- Modal title: “Global Variables”.
- Content:
  - **Input group**: “Name” and “Value” fields with **Add** button.
  - **List** of existing variables (name + value) with per‑row **Edit** and **Delete** actions.
  - Optional inline validation/error text.

### Validation Rules
- Name is **required**.
- Name is **case‑insensitive** for matching (normalize to a canonical key).
- Names must be trimmed; collapse internal whitespace to single spaces.
- Disallow empty names or names consisting only of whitespace.
- Value can be empty but should be stored as an empty string.

## Variable Resolution
- Variable placeholders use the existing syntax: `{{ Variable Name }}`.
- Resolution precedence:
  1. **Local front‑matter** variables (from the document’s `---` block)
  2. **Global variables** (from the DB)
  3. If no match, leave placeholder unchanged
- Globals must apply to both **preview** and **print/PDF**.

## Data Model
Add a CR‑SQLite table for global variables.

### Table: `globals`
- `key` TEXT PRIMARY KEY
- `value` TEXT NOT NULL
- `updated_at` TEXT NOT NULL (ISO)

Notes:
- Use `crsql_as_crr('globals')` to enable sync.
- `key` should store the **normalized** name to keep uniqueness stable across case/spacing differences.
- Store a `display_key` optional column if we want to preserve original casing (optional).

## Storage & Sync
- Use existing `syncStore.execute` for CRUD operations.
- Globals replicate automatically through the existing CR‑SQLite sync flow.
- On load, read globals once and keep in a Pinia store; update on changes.

## Implementation Plan (Frontend)
1. **Store**
   - Add a new Pinia store `globalVariablesStore` (or extend existing store) to:
     - Load globals from DB on init.
     - Create/update/delete globals.
     - Expose `globalVariables` map and helper `getGlobalValue(name)`.

2. **Markdown Replacement**
   - Update variable replacement to merge globals into the variable map.
   - Ensure local front‑matter overrides global values.

3. **UI**
   - Add a **Variables** button under Tools.
   - Create `VariablesModal.vue` (or reuse existing modal component) using Export modal layout.
   - Wire CRUD to the store and refresh list reactively.

4. **DB Schema**
   - Update frontend DB schema (syncStore) to include `globals` table.
   - Update backend schema (`backend/api-service/db.js`) to match.

## Error Handling
- Use `uiStore.addToast()` for success/error messages.
- Show inline validation errors in the modal for invalid names.

## Acceptance Criteria
- Users can open Tools → Variables and manage global variables.
- Globals appear in preview and PDF for all documents.
- Local front‑matter variables override globals with the same name.
- Globals are persisted and sync between devices.
- Variable block `---` is never displayed in preview or PDF.

## Open Questions
- Should we preserve original casing for display (e.g., store `display_key`)?
- Do we need ordering for variables in the UI?
- Should we allow import/export of globals?
