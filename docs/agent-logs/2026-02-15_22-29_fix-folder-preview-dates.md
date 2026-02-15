# Fix folder preview dates

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:29
**Status:** completed

## Objective
Fix missing/unknown modified dates in Folder Preview file rows.

## Progress
- [x] Fix note date lookup in folder tree builder
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Corrected file-date lookup to use `syncStore.execute()` array results (`noteResult[0]`) instead of stale `rows._array` access; added `created_at` fallback when `updated_at` is absent.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep fix scoped to folder-preview date hydration.
