# Fix export image reference regex + add frontend tests

**Agent:** GitHub Copilot (Claude Opus 4.6)
**Started:** 2026-02-15 19:10
**Status:** completed

## Objective
Verify and fix the export/import implementation that includes images, settings, and globals.

## Progress
- [x] Reviewed existing export/import code (already implemented with v2 format)
- [x] Found bug in `replaceImageReferences` regex — `\[` in JS template literal string produces `[` not `\[`, breaking the regex match
- [x] Fixed the regex escaping in `exportUtils.js`
- [x] Added vitest to frontend devDependencies
- [x] Created `frontend/vitest.config.js`
- [x] Created test suite `frontend/tests/unit/exportUtils.test.js` with 9 tests
- [x] Added `test` and `test:watch` scripts to `frontend/package.json`
- [x] All 9 tests pass

## Changes Made
- `frontend/src/utils/exportUtils.js` — Fixed regex: `!\[` → `!\\[` and `\]` → `\\]` so the pattern correctly matches markdown image references like `![alt](/api/images/uuid)`
- `frontend/package.json` — Added vitest devDependency, added `test` and `test:watch` scripts
- `frontend/vitest.config.js` — New vitest config for frontend
- `frontend/tests/unit/exportUtils.test.js` — 9 tests covering `replaceImageReferences` and `base64ToBlob`

## Tests
- Ran `pnpm test` in `frontend/` — all 9 tests passed

## Open Items / Notes
- The v2 export/import implementation (images, settings, globals) was already in place in `importExportStore.js`, `exportUtils.js`, and `ExportModal.vue`
- The regex bug meant that image URL remapping during import was silently failing (no images got their references updated)
