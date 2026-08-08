# Review: Document Templates Spec

**Agent:** DeepSeek V4 Pro
**Started:** 2026-05-03 13:16
**Status:** completed

## Objective
Review `docs/specs/document-templates.md` for gaps, inconsistencies (within doc and wrt codebase), and opportunities for improvement.

## Progress
- [x] Read full spec (803 lines)
- [x] Cross-referenced frontend schema (syncStore.js, DB_SCHEMA, ensureGlobalsSchema pattern)
- [x] Cross-referenced backend schema (db.js, BASE_SCHEMA, CRR_TABLES, ensureCrr)
- [x] Cross-referenced router.js (existing routes)
- [x] Cross-referenced SubMenuBar.vue (Tools menu pattern)
- [x] Cross-referenced Documents.vue (new-file flow, current folder)
- [x] Cross-referenced structureStore.js (createFile, selectedFolderId)
- [x] Cross-referenced markdownStore.js (applyMetadataVariables, variable resolution)
- [x] Cross-referenced globalVariablesStore.js (DB write pattern, toast pattern)
- [x] Cross-referenced imageManagerStore.js (alternate pattern)
- [x] Cross-referenced AccountLayout.vue
- [x] Cross-referenced SettingsPage.vue (Tools section pattern)
- [x] Cross-referenced existing test structure
- [x] Compiled review

## Changes Made
- `docs/agent-logs/2026-05-03_13-16_review-document-templates-spec.md` — this log
- `docs/specs/document-templates.md` — complete rewrite as v2, addressing all identified gaps

## Summary of v2 Changes

### Critical fixes from v1 review (19 items)
1. **Schema migration**: Added `ensureTemplatesSchema()` pattern (matching `ensureGlobalsSchema`) for safe upgrades.
2. **Variable pipeline**: Documented separation between creation-time template variables and preview-time `{{ Var }}` pipeline.
3. **DB writes**: Documented both `syncStore.execute()` and `syncStore.db.value.exec()` patterns.
4. **Toast feedback**: Added `uiStore.addToast()` to all store methods with try/catch error handling.
5. **Current folder**: Explicitly specified `structureStore.selectedFolderId` for template instantiation.
6. **CRR pattern**: Follows `globals` pattern (ensure function) rather than direct DB_SCHEMA CRR registration.
7. **Modified file**: Changed `SidebarWithResizer.vue` → `Documents.vue` for new-from-template button.
8. **Variable dialog UX**: Labels above fields (not pre-filled values), scrollable dialog.
9. **Editor choice**: Decided on `<textarea>` + preview instead of reusing `Editor.vue`.
10. **Delete confirmation**: Specified custom `ConfirmDialog.vue` component.
11. **Index**: Added `idx_templates_updated` index.
12. **Sync collision**: Documented known limitation of offline seeding.
13. **Keyboard shortcut**: Explicitly deferred to v1.1.
14. **Duplicate naming**: Noted in spec for consideration.
15. **Scrollable dialog**: Added `max-h-[70vh] overflow-y-auto`.
16. **Test consolidation**: Extend `subMenuBarToolsMenu.test.js` instead of new file.
17. **Frozen dates**: Documented that template vars are resolved once at creation.
18. **Backend verification**: Confirmed `ensureCrr()` handles new table via CRR_TABLES.
19. **Icon import**: Verified `FileText` exists in lucide-vue-next.
