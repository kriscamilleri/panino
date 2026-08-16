# Document Terminology Consolidation

Agent: Copilot CLI
Start: 2026-08-16 16:41 +02:00
Status: Complete

## Objective

Consolidate Panino's product-facing terminology on **Document**, replacing user-facing uses
of “file” and “note” in the UI and maintained documentation.

## Progress

- Audited UI labels, modals, toasts, status text, PWA metadata, and maintained documentation.
- Retained “file” where it accurately describes a physical import/export or configuration file.
- Retained compatibility-critical implementation identifiers, including the `notes` table,
  `/notes` routes, `type: 'file'`, and existing test IDs.
- Added a terminology regression test covering creation, sync, import/export, and backup copy.

## Changes Made

- Updated document creation, search, template, tree, sync, backup, import/export, image-use,
  authentication, legal, and PWA copy.
- Updated the README and contributor guidance, including a rule that defines the boundary
  between product terminology and technical identifiers.
- Updated affected dashboard expectations and added focused terminology assertions.

## Tests

- `cd frontend && npx vitest run tests/unit/documentTerminology.test.js tests/unit/documentDashboard.test.js tests/unit/templatePickerModal.test.js tests/unit/githubBackupProgress.test.js tests/unit/importExportStore.test.js`
  - Passed: 65 tests in 5 files.
- `npm run lint`
  - Passed with zero errors and 40 pre-existing warnings.
- Browser inspection at `http://localhost:5173/#/`
  - Confirmed the page title is `panino ~ pretty neat documents` and the rendered controls
    include Documents, New Document, Recent Documents, Search recent documents, and
    Show pinned documents only.
  - Further interaction was blocked when the shared development server reloaded with existing
    Vite WebSocket, module MIME-type, and Pinia initialization errors.

## Open Items / Notes

- Historical agent logs and shipped specifications were intentionally preserved as historical
  records. Maintained documentation now defines the Document convention for future work.
