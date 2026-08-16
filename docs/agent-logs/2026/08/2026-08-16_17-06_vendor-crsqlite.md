# Vendor CR-SQLite runtimes

- Agent: Copilot CLI
- Started: 2026-08-16 17:06 +02:00
- Status: Complete

## Objective

Replace the unmaintained `@vlcn.io/crsqlite` and `@vlcn.io/crsqlite-wasm` npm packages with
the provided native and browser runtime files, while preserving Panino's CR-SQLite behavior.

## Progress

- Created `feature/vendor-crsqlite` from current `origin/main`.
- Rewired backend extension resolution, Docker images, repair tooling, and tests.
- Rewired frontend imports and dependencies, regenerated `pnpm-lock.yaml`, and removed the
  stale frontend npm lockfile.
- Updated the DX-10 merge harness to load the same vendored extension in both arms.
- Verified the native extension, full test suites, frontend production bundle, browser WASM
  delivery, and merge behavior on synthetic and restored production data.

## Changes Made

- Backend now resolves `native/crsqlite.so`, with `CRSQLITE_EXT_PATH` as the first override.
- Removed the CR-SQLite npm dependency, install helper, and `patch-crsqlite.sh`.
- Frontend now imports `src/vendor/crsqlite-wasm/`; `async-mutex` remains an npm dependency.
- ESLint ignores generated vendored source while continuing to lint Panino's integration code.
- Frontend CI now installs from the canonical pnpm lockfile after the stale npm lockfile was
  removed. The frontend pins pnpm 10.11.0 so Corepack uses the lockfile's generating version
  consistently.
- Unsupported backend platforms fail with an actionable error unless `CRSQLITE_EXT_PATH`
  points to a compatible extension.
- Pinned Vitest 4.0.18 because the newer declared range resolves to Vitest 4.1, whose Vite 6+
  peer requirement is incompatible with this app's Vite 5 runtime.
- Updated durable sync documentation and the merge-verification harness.

## Tests

- `npm run test:fe`: 19 files, 352 tests passed.
- `npm run test:be`: 15 files, 177 tests passed in the Node 24 Docker image.
- `cd frontend && pnpm run build`: passed; emitted the vendored WASM asset.
- Node 24 Docker probe: SQLite 3.53.2; `crsql_db_version()` returned `0`.
- Targeted ESLint on changed source: zero errors, existing console warnings only.
- Full `npm run lint`: one pre-existing error in `DocumentDashboard.vue` (`Plus` unused) and
  existing warnings; vendored files introduced no lint errors.
- Synthetic two-arm merge verification: all seven steps passed; reports identical.
- Fresh 11 MB production snapshot: checksum passed, one database in the archive, all seven
  merge steps passed, and reports were identical between SQLite 3.45.3 and 3.53.2. The
  snapshot, extracted database, and working copies were deleted after the run.
- Browser production preview: page rendered with `crossOriginIsolated === true`; the
  1,846,951-byte WASM response used `application/wasm` and compiled successfully.

## Open Items / Notes

- The shared Vite dev server had stale optimized modules after switching its existing
  `node_modules` tree from npm to pnpm. Validation used a fresh production build and isolated
  Vite preview instead.
- Backend dependency audit still reports the repository's existing 21 advisories. This change
  removes CR-SQLite npm packages and adds only `async-mutex` 0.5.0.
