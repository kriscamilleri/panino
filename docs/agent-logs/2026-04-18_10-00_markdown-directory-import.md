# Markdown & Directory Import

**Agent:** GitHub Copilot (Claude Opus 4.6)
**Started:** 2026-04-18 10:00
**Status:** completed

## Objective
Implement markdown file, directory, and ZIP archive import as specified in `docs/specs/markdown-import.md`.

## Progress
- [x] Create feature branch `feature/markdown-directory-import`
- [x] Create agent log
- [x] Phase 1: Pure utility functions (`frontend/src/utils/importUtils.js`)
- [x] Phase 1: Unit tests (`frontend/tests/unit/importUtils.test.js`) — 68 tests
- [x] Phase 2: Store layer import functions (`importExportStore.js`)
- [x] Phase 2: Expose in `docStore.js`
- [x] Phase 2: Store layer unit tests (`frontend/tests/unit/markdownImport.test.js`) — 17 tests
- [x] Phase 3: ImportModal UI redesign
- [x] Run all tests — 130/130 pass, 0 regressions
- [x] Security review — all items pass (fixed S2/S3/S8 front-matter title sanitization)
- [x] Commit and push to feature branch

## Changes Made
- `frontend/src/utils/importUtils.js` — NEW: Pure utility functions (sanitizePathSegments, extractTitleFromFrontMatter, titleFromFilename, deduplicateName, isMarkdownFile, isHiddenSegment, buildFolderTree, validateImportLimits, IMPORT_LIMITS)
- `frontend/src/store/importExportStore.js` — Added importMarkdownFiles, importMarkdownDirectory, importZipArchive functions
- `frontend/src/store/docStore.js` — Exposed 3 new import functions
- `frontend/src/components/ImportModal.vue` — Complete redesign: format selector cards, separate modes for markdown/directory/zip/json, progress bar, drag-and-drop
- `frontend/tests/unit/importUtils.test.js` — NEW: 68 unit tests for utility functions
- `frontend/tests/unit/markdownImport.test.js` — NEW: 17 unit tests for store-level import logic

## Tests
- Ran `npx vitest run` in `frontend` — all 130 tests pass across 11 test files
- No regressions in existing tests

## Security Review
- [x] S1: sanitizePathSegments strips `..`, `.`, empty, drive letters, leading slashes
- [x] S2: Null bytes and control chars stripped (including front-matter titles)
- [x] S3: Unicode NFC normalization (including front-matter titles)
- [x] S4: Import limits enforced (10k files, 500 MB, 50 MB/file, 1k dirs)
- [x] S5: Front-matter regex only scans first 4 KB
- [x] S6: All SQL INSERTs use parameterized queries
- [x] S7: ZIP iteration uses Object.keys(), not for...in
- [x] S8: Folder names and note titles truncated to 500 chars
- [x] S9: XSS content stored raw, DOMPurify sanitizes at render
- [x] S10: Path traversal in ZIP entries stripped
- [x] No new dependencies
- [x] No secrets/tokens in code
