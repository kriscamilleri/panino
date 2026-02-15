# Increase row border radius slightly

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 22:41
**Status:** completed

## Objective
Make preview list rows a little rounder.

## Progress
- [x] Increase shared row radius from `rounded-sm` to `rounded-md`
- [x] Run frontend tests

## Changes Made
- `frontend/src/components/FolderPreviewItem.vue` — Changed row container radius from `rounded-sm` to `rounded-md`.

## Tests
- Ran `pnpm test` in `frontend` — passed (`2` files, `12` tests).

## Open Items / Notes
- Keep all other row styling unchanged.
