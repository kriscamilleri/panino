# Remove separators from Folder Preview list

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:47
**Status:** completed

## Objective
Remove separator lines from Folder Preview list rows to match the recent-documents separator removal.

## Progress
- [x] Remove top-level folder preview separators
- [x] Remove nested folder preview separators
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Removed top-level folder preview separator classes (`divide-y divide-gray-200`).
- `frontend/src/components/FolderPreviewItem.vue` — Removed nested child list separator classes (`divide-y divide-gray-200`).

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep recent list behavior unchanged from previous update.
