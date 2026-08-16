# Frontend npm standardization

- Agent: Copilot CLI
- Started: 2026-08-16 17:30 +02:00
- Status: Complete with pre-existing test failure

## Objective

Make npm the sole frontend package manager so local development, CI, and deployment use the
same committed lockfile.

## Progress

| # | Persona | Journey | Acceptance Criteria |
|---|---|---|---|
| U1 | Developer | Install frontend dependencies locally or in CI | `npm ci` succeeds from `frontend/package-lock.json` using Node 24.19.0. |
| U2 | Deployer | Build the production frontend | `npm run build` emits the application bundle and vendored CR-SQLite WASM asset. |

The first lockfile-generation attempt against the existing pnpm-linked `node_modules` failed
inside npm Arborist. Generating in an empty directory using the pinned Node 24.19.0 image
succeeded, confirming this was an incompatible local install tree rather than a manifest issue.

## Changes Made

- Replaced `frontend/pnpm-lock.yaml` with a Node 24.19.0-generated
  `frontend/package-lock.json`.
- Removed the frontend `packageManager` pnpm declaration and obsolete pnpm ignore entries.
- Changed frontend CI from pnpm/Corepack to cached `npm ci` and `npm test`.
- Retained lockfile exclusions from AI-context inputs while allowing npm lockfiles to be
  tracked and included by normal tooling.

## Tests

- Clean Node 24.19.0 Docker environment: `npm ci --no-audit --no-fund` passed.
- Clean Node 24.19.0 Docker environment: `npm run build` passed and emitted
  `dist/assets/crsqlite-DaI5sLh7.wasm` (1,846,951 bytes).
- `npx vitest run --exclude tests/unit/docStoreDocuments.test.js`: 18 files, 339 tests passed.
- Full `npm test`: 352 tests passed and one pre-existing failure remained in
  `docStoreDocuments.test.js`; its assertion still expects "note id" while the current
  implementation, changed by the document-terminology refactor, correctly says
  "document id".

## Open Items / Notes

- The existing `docStoreDocuments.test.js` terminology assertion should be updated in its
  owning document-terminology change before the full frontend CI job can be green.
