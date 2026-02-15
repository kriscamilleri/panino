# Match hover background in folder preview

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:37
**Status:** completed

## Objective
Apply the same hover background effect in folder preview rows as recent documents.

## Progress
- [x] Apply `hover:bg-gray-50` to non-recent folder preview rows
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Updated `fileRowClasses` so non-recent rows also include `hover:bg-gray-50`, matching recent-document hover background behavior.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep click/focus behavior unchanged.
