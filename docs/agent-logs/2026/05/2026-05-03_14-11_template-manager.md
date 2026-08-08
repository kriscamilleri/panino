# Template Manager Implementation

**Agent:** primary
**Started:** 2026-05-03 14:11 UTC
**Status:** completed ✅

## Objective
Implement the full Template Manager feature per `docs/specs/document-templates.md` — including backend schema, frontend store, utilities, UI pages, modals, and tests.

## Progress
- [x] Backend schema (db.js)
- [x] Frontend schema (syncStore.js)
- [x] templateVariables.js utility
- [x] templateStore.js Pinia store
- [x] Router changes
- [x] TemplateManagerPage.vue
- [x] TemplatePickerModal.vue
- [x] TemplateVariableDialog.vue
- [x] SubMenuBar integration
- [x] Documents.vue integration
- [x] SettingsPage integration
- [x] Tests (templateStore 33, templateVariables 32, subMenuBar 3 new)
- [x] MCP validation — all flows verified ✅

## Changes Made
- `backend/api-service/db.js` — Added `templates` table + index to `BASE_SCHEMA`, added `'templates'` to `CRR_TABLES`
- `frontend/src/store/syncStore.js` — Added `templates` to `DB_SCHEMA`, created `ensureTemplatesSchema()` with `seedDefaultTemplates()`, called from `initializeDB()`, added uuid import, exported `ensureTemplatesSchema`
- `frontend/src/utils/templateVariables.js` — New file: `resolveTemplateVariables()` and `extractInputLabels()` utilities
- `frontend/src/store/templateStore.js` — New file: Pinia store with CRUD operations
- `frontend/src/router.js` — Added `/templates` route with `keepAlive: true`
- `frontend/src/pages/TemplateManagerPage.vue` — New file: table list + inline editor
- `frontend/src/components/TemplatePickerModal.vue` — New file: template selection modal
- `frontend/src/components/TemplateVariableDialog.vue` — New file: variable input form dialog
- `frontend/src/components/SubMenuBar.vue` — Added Templates button to Tools menu
- `frontend/src/components/Documents.vue` — Added "New from Template" button + modal
- `frontend/src/pages/SettingsPage.vue` — Added "Manage Templates" button

## Tests
- Ran `npm test` in `frontend` — **all 202 tests pass** (14 test files)
- templateStore.test.js: 33 tests
- templateVariables.test.js: 32 tests
- subMenuBarToolsMenu.test.js: 6 tests (3 new)

## MCP Validation Results

### ✅ Seed templates
- 4 bundled templates seeded on first DB init: Meeting Notes, Project Brief, Journal Entry, Bug Report
- Verified in Template Picker Modal and Template Manager Page

### ✅ Template Picker Modal (`New from Template` in sidebar)
- "New from Template" button (FileText icon) appears in Documents.vue next to + File/Folder
- Modal shows all templates + "Blank document" option with radio buttons
- Relative time shown correctly (e.g. "2 minutes ago", "Just now")
- Blank document creates empty note (same as + button)

### ✅ Template Variable Dialog
- Opens when template has `{{input:...}}` variables
- Shows one input per unique label, labels ABOVE fields
- Meeting Notes: 8 input fields shown correctly with deduplication
- Test Template: single "Title" field
- Cancel returns to picker; Create Note resolves + navigates

### ✅ Variable Resolution
- `{{today}}` → `2026-05-03` (YYYY-MM-DD) ✓
- `{{now}}` → ISO 8601 ✓ (tested via unit tests)
- `{{input:Meeting Title}}` → "Q2 Planning" (user input) ✓
- Variables resolved ONCE at creation time ✓
- Front-matter + body variables all resolved ✓

### ✅ Template Manager Page (`/templates`, 1280px + 375px)
- AccountLayout with table: Name, Excerpt, Updated, Actions
- Create: inline editor, validates name, saves + shows toast
- Duplicate: "- Copy" suffix, new UUID, fresh timestamp
- Delete: window.confirm() dialog, removes row, shows toast
- Edit: opens editor pre-filled, saves update
- Cancel with unsaved changes: confirm dialog
- "Templates: N" count updates correctly

### ✅ SubMenuBar Integration
- Templates button appears between Images and Variables
- NOT disabled when offline (works offline)
- FileText icon, navigates to /templates

### ✅ Settings Page Integration
- "Manage Templates" button in Tools section, below "Manage Images"
- Navigates to /templates correctly

### ✅ Console (1280px and 375px)
- No template-related errors
- Only expected WebSocket/sync errors (no backend running)

### ✅ Lighthouse
- Accessibility: 100
- Best Practices: 100

## Open Items / Notes
- Known limitation: duplicate templates possible if two offline devices seed defaults then sync
- Full E2E with backend requires `docker compose -f docker-compose.dev.yml up`
