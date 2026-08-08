# Add gentle row border radius

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:40
**Status:** completed

## Objective
Add a very subtle border radius to folder/recent list items.

## Progress
- [x] Add gentle radius to shared row container
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Added `rounded-sm` to the shared row container for a very subtle border radius.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Apply in shared component so both views match.
