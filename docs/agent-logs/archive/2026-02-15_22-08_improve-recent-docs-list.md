# Improve recent documents list display

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:08
**Status:** completed

## Objective
Improve the Recent Documents list presentation and enrich the metadata shown for each recent note.

## Progress
- [x] Locate recent documents rendering and data source
- [x] Expand recent-document query fields and mapping
- [x] Update Recent Documents UI layout and empty state
- [x] Add unit tests for recent document mapping behavior
- [x] Run frontend unit tests
- [x] Validate updated frontend flow with Chrome DevTools MCP

## Changes Made
- `frontend/src/store/docStore.js` — Updated `getRecentDocuments()` query to include `title`, `content`, dates, and folder name via `LEFT JOIN`; normalized rows before returning.
- `frontend/src/utils/recentDocuments.js` — Added recent-document normalization utility (title/folder fallbacks, excerpt generation, word counting).
- `frontend/src/components/FolderPreview.vue` — Improved Recent Documents list layout, added folder + word count metadata, relative-time display with absolute timestamp tooltip, excerpt line, and empty-state message.
- `frontend/tests/unit/recentDocuments.test.js` — Added unit tests for recent-document normalization and edge cases.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).
- MCP validation: loaded app at `http://localhost:5173/#/`, confirmed updated Recent Documents list content and structure, console clean, and network requests successful.

## Open Items / Notes
- Attempted MCP viewport resize checks for 1280px/375px, but Chrome MCP returned `Protocol error (Browser.setContentsSize): Restore window to normal state before setting content size`; desktop flow verification completed successfully.
