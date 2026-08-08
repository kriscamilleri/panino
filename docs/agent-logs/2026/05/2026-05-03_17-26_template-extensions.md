# Template Extensions — Dynamic Titles & Default Folders

**Agent:** claude-agent
**Started:** 2026-05-03 17:26
**Status:** in-progress

## Objective
Implement the `docs/specs/document-templates-extensions.md` spec: add `title_pattern` and `default_folder_id` columns to templates, date/time format specifiers for template variables, and updated UI.

## Progress
- [x] Read spec and all existing source files
- [ ] `templateVariables.js` — add `formatDate()`, update regexes, update `resolveTemplateVariables()`, update `extractInputLabels()`
- [ ] `syncStore.js` — update `DB_SCHEMA`, `ensureTemplatesSchema()` migration, `seedDefaultTemplates()` defaults
- [ ] `templateStore.js` — update all CRUD functions for new columns
- [ ] `db.js` (backend) — update `BASE_SCHEMA`
- [ ] `TemplateManagerPage.vue` — add editor fields, list columns
- [ ] `TemplatePickerModal.vue` — update creation logic
- [ ] Tests — update `templateVariables.test.js` and `templateStore.test.js`
- [ ] Chrome DevTools MCP validation — verify at 1280px and 375px

## Changes Made

## Tests

## Open Items / Notes
