# Apply folder-path truncation treatment in folder preview

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:16
**Status:** completed

## Objective
Apply truncated/muted folder hierarchy display with tooltip in Folder Preview recent list rows.

## Progress
- [x] Update folder path rendering style in Folder Preview
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Updated recent-row folder hierarchy rendering to be muted + truncated with responsive max width and full path tooltip (`title`).

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep change scoped to `FolderPreview` UI styling/markup.
