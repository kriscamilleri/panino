# Develop vs Main Deployment Review

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-21 19:52
**Status:** completed

## Objective
Assess whether `develop` is safe to merge into `main` and deploy to production, with specific attention to `deploy.sh`, infrastructure changes, and database/schema migration risk.

## Progress
- [x] Read repository-level and layer-specific agent instructions
- [x] Inventory `main..develop` commits and changed files
- [x] Audit production deployment and runtime configuration changes
- [x] Audit schema changes and implicit migration requirements
- [x] Review high-risk backend and frontend feature additions
- [x] Run targeted validation commands
- [x] Produce merge/deploy recommendation with findings

## Changes Made
- `docs/agent-logs/2026-03-21_19-52_develop-vs-main-deploy-review.md` — created review log for this deployment safety assessment.
- `backend/api-service/sync.js` — prevented sync-time revision snapshot creation when the referenced note is not yet present in the backend base table, avoiding foreign-key failures on valid sync payloads.
- `backend/api-service/tests/integration/sync.revision.test.js` — added regression coverage proving sync succeeds and skips revision capture for note mutations that have no base-table row yet.

## Tests
- Ran `npm test` in `frontend` — passed (32/32).
- Ran `npm run build` in `frontend` — passed.
- Ran `docker compose -f docker-compose.yml config` — rendered successfully, with warnings when env vars are unset.
- Ran `npm test` in `backend/api-service` on host — not a valid signal due missing local `better-sqlite3` native binding.
- Built and ran `backend/api-service/Dockerfile.test` — backend suite now passes (136/136) after fixing the sync/revision regression.

## Open Items / Notes
- Previous deployment blocker resolved: sync now skips revision capture until the base `notes` row exists, so incoming note mutations no longer fail with `FOREIGN KEY constraint failed`.
- `deploy.sh` is unchanged by this branch. Schema additions are additive and created lazily via `db.js`; no explicit migration step is required for them.
- GitHub backup requires `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to be configured if the feature is meant to work in production. Without them, the rest of the app still runs.