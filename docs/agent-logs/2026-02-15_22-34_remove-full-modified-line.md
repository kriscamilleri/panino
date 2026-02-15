# Remove full modified date line under file titles

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:34
**Status:** completed

## Objective
Stop showing the full `Last Modified` date line under file titles in folder preview rows.

## Progress
- [x] Remove under-title full-date row from shared preview item component
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Removed the non-recent secondary `Last Modified: ...` line from under file titles.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep relative date on the right side unchanged.
