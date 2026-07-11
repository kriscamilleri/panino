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
- Docker-focused run passed: `tests/integration/sync.test.js` and `tests/unit/db.test.js` — 30/30 tests.
- Full Docker backend suite reached 151/152 tests; the sole failure is an unrelated pre-existing revision-capture expectation in `tests/integration/sync.revision.test.js` (`Base title` vs `Renamed via update only`).
- Live HTTP verification passed against the Docker API: login `200`, failing mixed sync batch `503 SYNC_CONNECTION_RESET`, subsequent retry sync `200` with clock `0`.
- Host Vitest remains blocked by the local `better-sqlite3` Node ABI mismatch (115 vs 137).

## Open Items / Notes
- The working tree contained substantial pre-existing changes in the affected backend/test files and unrelated untracked repair/spec artifacts; they were preserved rather than reverted.
- Full CR-SQLite regression tests should be rerun in the project’s production-compatible Node/Docker environment.
- Commit: `5886957 Fail closed after CR-SQLite merge failures`; test-contract updates are pending in the follow-up commit.
