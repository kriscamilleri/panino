# Add inner padding to preview list items

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:27
**Status:** completed

## Objective
Add internal padding to Folder Preview / Recent Documents list items.

## Progress
- [x] Add horizontal padding to shared list item row
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Added internal horizontal spacing (`px-3`) while preserving existing vertical spacing and interactions.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Change should apply to both recent and folder preview via shared component.
