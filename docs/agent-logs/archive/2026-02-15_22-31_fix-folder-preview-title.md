# Fix folder preview title for nested folders

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:31
**Status:** completed

## Objective
Show the correct folder name in Folder Preview title for nested folders (e.g., `Test 2`).

## Progress
- [x] Load folder title directly from DB by selected folder id
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Replaced root-only folder name lookup with DB query (`SELECT name FROM folders WHERE id = ?`) in a reactive `watchEffect`, ensuring nested folder titles render correctly.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep scope limited to folder title resolution in `FolderPreview.vue`.
