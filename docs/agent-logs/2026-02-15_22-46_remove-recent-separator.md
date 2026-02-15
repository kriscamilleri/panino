# Remove separators from Recent Documents list

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:46
**Status:** completed

## Objective
Remove separator lines from the Recent Documents list while keeping folder preview separators unchanged.

## Progress
- [x] Remove `divide-y` separators from Recent Documents list container
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Removed `divide-y divide-gray-200` classes from the Recent Documents list container (`isRecentView` branch) while leaving folder-preview list separators intact.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Scope limited to recent list container classes in `FolderPreview.vue`.
