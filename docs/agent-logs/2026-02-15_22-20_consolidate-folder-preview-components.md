# Consolidate Folder Preview components

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:20
**Status:** completed

## Objective
Consolidate duplicated Recent Documents and Folder Preview item rendering into a shared component pattern.

## Progress
- [x] Refactor `FolderPreviewItem` to support recent + folder variants
- [x] Replace recent list inline markup with shared item component
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Consolidated rendering logic for both Recent Documents file rows and regular folder-preview rows via `variant` prop (`recent` vs default).
- `frontend/src/components/FolderPreview.vue` — Replaced duplicated recent-row markup with `FolderPreviewItem` usage, and removed now-unused local formatting/navigation code.
- `frontend/src/utils/recentDocuments.js` — Added `type: 'file'` to normalized recent rows so shared component behavior can be applied consistently.
- `frontend/tests/unit/recentDocuments.test.js` — Updated expectations for normalized recent row shape.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep behavior unchanged while removing duplicated item markup/formatting logic.
