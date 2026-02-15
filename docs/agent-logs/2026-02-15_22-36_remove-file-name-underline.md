# Remove underline from file names

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:36
**Status:** completed

## Objective
Remove underline styling from file names in folder preview and recent document rows.

## Progress
- [x] Remove underline class from shared file title styles
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Removed `underline` class from both recent and non-recent file title styles.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep all navigation behavior unchanged.
