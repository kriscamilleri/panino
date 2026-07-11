# CR-SQLite connection-state recovery

**Agent:** GPT-5.6 Luna
**Started:** 2026-07-11 00:00
**Status:** completed

## Objective
Implement connection invalidation and fail-closed sync recovery after CR-SQLite merge errors, with maintenance health guards and regression tests.

## Progress
- [x] Read project and backend agent guidance and inspect affected paths
- [x] Implement database invalidation and health-check helpers
- [x] Make sync fail closed and invalidate poisoned connections
- [x] Guard image and backup CRR mutations
- [x] Add regression tests
- [x] Run backend validation and commit progress

## Changes Made
- `backend/api-service/db.js` — added exact-handle user connection invalidation, clean reopen health checks, and initialization cleanup.
- `backend/api-service/sync.js` — removed silent merge skipping; failed CR-SQLite mutations roll back, invalidate the connection, and return `503 SYNC_CONNECTION_RESET`.
- `backend/api-service/image.js` — guarded image uploads/deletes/pruning and added masked structured deletion events.
- `backend/api-service/backup.js` — guarded missing-image metadata cleanup and added structured cleanup events.
- `backend/api-service/tests/unit/db.test.js` and `tests/integration/sync.test.js` — added invalidation and fail-closed batch coverage.

## Tests
- `node --check` passed for the four changed backend modules.
- Focused Vitest run is blocked by the environment: installed `better-sqlite3` binary targets Node module ABI 115 while the current Node requires ABI 137. Sync helper tests that do not load SQLite passed (15 tests).

## Open Items / Notes
- The working tree contained substantial pre-existing changes in the affected backend/test files and unrelated untracked repair/spec artifacts; they were preserved rather than reverted.
- Full CR-SQLite regression tests should be rerun in the project’s production-compatible Node/Docker environment.
- Commit: `5886957 Fail closed after CR-SQLite merge failures`.
