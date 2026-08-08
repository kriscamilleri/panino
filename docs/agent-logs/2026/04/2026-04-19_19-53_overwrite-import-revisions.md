# Overwrite Import Revisions

**Agent:** GitHub Copilot
**Started:** 2026-04-19 19:53
**Status:** completed

## Objective
Change imports to update matching notes in place, create a revision before overwriting when the environment can guarantee it, restrict imported content to folders and markdown notes under 1 MB, remove deduplication from the import flow, and report skipped items.

## Progress
- [x] Review revision architecture and offline constraints
- [x] Review all import modes and current destructive behavior
- [x] Define a shared upsert strategy for imports
- [x] Update import utilities for new limits and matching rules
- [x] Refactor import store to use overwrite-in-place across all import modes
- [x] Update import modal warnings and messaging
- [x] Update tests and spec
- [x] Run frontend validation and browser verification

## Changes Made
- `frontend/src/store/importExportStore.js` — replaced destructive and dedupe-based import logic with shared overwrite-in-place upsert logic for JSON, StackEdit, markdown-file, directory, and ZIP imports; added guaranteed pre-overwrite revision capture when online/sync is available; added skipped-item reporting.
- `frontend/src/utils/importUtils.js` — changed imports to `.md`-only matching, reduced per-note limit to 1 MB, and added UTF-8 byte-size calculation helper.
- `frontend/src/components/ImportModal.vue` — updated import copy, removed ZIP metadata restore controls, added unsafe-overwrite confirmation flow, and surfaced skipped-item summaries.
- `frontend/tests/unit/importUtils.test.js` — updated utility coverage for `.md`-only behavior, 1 MB limit, and byte-size handling.
- `frontend/tests/unit/markdownImport.test.js` — updated import-logic expectations to remove dedupe assumptions and reflect the new file constraints.
- `docs/specs/markdown-import.md` — added a superseding implementation note documenting the new overwrite/revision/skip rules.
- `docs/agent-logs/2026-04-19_19-53_overwrite-import-revisions.md` — created and completed this implementation log.

## Tests
- Ran `cd frontend && npm test -- tests/unit/importUtils.test.js tests/unit/markdownImport.test.js` — passed (88/88).
- Ran `cd frontend && npm test` — passed (133/133).
- Ran `cd frontend && npm run build` — passed.
- Browser smoke check via MCP on `http://localhost:5173` — import modal opened successfully, updated copy rendered, and the ZIP metadata toggle was no longer present.

## Open Items / Notes
- Revisions are backend-only, so guaranteed pre-overwrite capture requires authenticated online sync.
- Matching existing notes can only be done reliably by folder path plus note title; the schema does not store original source file paths.
- The browser smoke test verified the modal surface only. It did not execute a full file-import interaction with a real uploaded fixture.

## 2026-04-19 20:16 Follow-up

**Status:** completed

### Objective
Fix the Panino ZIP export/import round-trip so bundled images load correctly after re-import.

### Progress
- [x] Trace the ZIP export contract for `_images/` and `_panino_metadata.json`
- [x] Restore bundled image import for Panino ZIP re-imports only
- [x] Add store-level regression coverage for image URL remapping

### Changes Made
- `frontend/src/store/importExportStore.js` — restored bundled `_images/` upload for Panino ZIP imports, remapped imported markdown image URLs to the new uploaded image ids, and kept generic non-markdown ZIP assets skipped.
- `frontend/src/components/ImportModal.vue` — clarified that Panino ZIP exports restore bundled images.
- `frontend/tests/unit/importExportStore.test.js` — added regression coverage for Panino ZIP image round-tripping through import.
- `docs/specs/markdown-import.md` — documented the ZIP image-restore exception so the implementation contract is explicit.

### Tests
- Ran `cd frontend && npx vitest run tests/unit/importExportStore.test.js tests/unit/markdownImport.test.js tests/unit/importUtils.test.js` — passed (89/89).
- Ran `cd frontend && npm test` — passed (134/134).
- Ran `cd frontend && npm run build` — passed.
- Browser check via MCP on `http://localhost:5173` — import modal now shows that Panino ZIP exports restore bundled images.

### Open Items / Notes
- Generic relative markdown image imports such as `![](./img.png)` remain out of scope; only Panino-exported ZIP bundles are restored.

## 2026-04-19 20:25 Follow-up

**Status:** completed

### Objective
Refresh the page after imports that change the document tree or note contents so the UI resets against the updated workspace state.

### Progress
- [x] Update the import modal success path to trigger a page refresh after successful imports with actual note/folder changes
- [x] Validate the import-related frontend tests still pass

### Changes Made
- `frontend/src/components/ImportModal.vue` — added a post-import reload for successful imports that create folders, create notes, or update existing notes, while leaving no-op imports in place.

### Tests
- Ran `cd frontend && npx vitest run tests/unit/importExportStore.test.js tests/unit/markdownImport.test.js` — passed (18/18).

### Open Items / Notes
- This follow-up did not run a live browser import flow; the change is limited to the modal success handler.