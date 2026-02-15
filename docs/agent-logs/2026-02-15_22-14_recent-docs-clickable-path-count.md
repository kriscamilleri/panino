# Recent documents: clickable rows, hierarchy path, formatted counts

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:14
**Status:** completed

## Objective
Format word count, show full folder hierarchy, and make each recent list item fully clickable to open the document.

## Progress
- [x] Add full folder hierarchy to recent-doc query
- [x] Format displayed word counts in UI
- [x] Make entire recent row clickable with keyboard support
- [x] Run frontend tests

## Changes Made
- `frontend/src/store/docStore.js` — Updated `getRecentDocuments()` to build and return full folder hierarchy using a recursive CTE (`Root / Child / ...`).
- `frontend/src/utils/recentDocuments.js` — Updated normalization to prefer `folderPath` while preserving fallback behavior.
- `frontend/src/components/FolderPreview.vue` — Made each recent row fully clickable (+ keyboard Enter/Space), and formatted word count with `Intl.NumberFormat`.
- `frontend/tests/unit/recentDocuments.test.js` — Updated test fixture/expectations for folder hierarchy mapping.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep changes scoped to recent docs data + list rendering.
