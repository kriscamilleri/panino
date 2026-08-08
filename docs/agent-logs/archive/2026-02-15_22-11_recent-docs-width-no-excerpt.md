# Refine recent documents list width and content

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:11
**Status:** completed

## Objective
Make recent document list items less wide and remove excerpt display from list rows.

## Progress
- [x] Constrain recent-list row width
- [x] Remove excerpt rendering from recent rows
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreview.vue` — Added `max-w-3xl` to the recent-documents list container so cards no longer span excessively wide layouts.
- `frontend/src/components/FolderPreview.vue` — Removed excerpt rendering block from recent-document list rows.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep all changes scoped to `FolderPreview` list rendering.
