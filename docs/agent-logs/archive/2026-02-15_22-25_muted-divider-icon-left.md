# Replace item containers with muted dividers

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:25
**Status:** completed

## Objective
Use clean muted separator lines instead of container cards for list items, and place icon directly to the left of the title.

## Progress
- [x] Update shared FolderPreviewItem row layout/styling
- [x] Align list wrappers to divider style
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Replaced container-card row styling with clean row layout (`py-3`), positioned icon inline to the left of title, and kept recent-row click behavior.
- `frontend/src/components/FolderPreview.vue` — Updated both Recent and folder list wrappers to muted separators using `divide-y divide-gray-200`.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Apply through shared component so both Recent Documents and Folder Preview stay consistent.
