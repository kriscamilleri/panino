# Make entire preview rows clickable

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:38
**Status:** completed

## Objective
Make the whole list item clickable in Folder Preview and Recent Documents rows.

## Progress
- [x] Make full row clickable for file and folder items
- [x] Preserve keyboard accessibility
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Made the entire row clickable and keyboard-focusable (`role="button"`, `tabindex="0"`) for all item types.
- `frontend/src/components/FolderPreviewItem.vue` — Row click now opens folders for folder rows and documents for file rows; removed title-specific click handlers/anchor to avoid duplicate interactions.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep existing navigation destinations unchanged.
