# Deploy develop → main

**Agent:** DeepSeek V4 Pro
**Started:** 2026-05-23
**Status:** completed

## Objective
Deploy current develop changes to production via merge to main.

## Progress
- [x] Assessed git state — develop is 5 commits ahead of main, clean working tree
- [x] Reviewed CI/CD workflow — push to main triggers VPS deploy via SSH
- [x] Run backend tests — unit (auth, sync) pass; db/integration fail due to Node 24 native module mismatch (expected, prod uses Node 20 in Docker)
- [x] Run frontend tests — all 220 pass
- [x] Merge develop → main (fast-forward, 45 files, +8618/−1396)
- [x] Push main to trigger CI deployment
- [x] Fix: templates table NOT NULL columns lacked DEFAULTs — CR-SQLite rejects `crsql_as_crr` on such tables
- [x] Push fix to develop → main → deploy
- [ ] Monitor CI status at https://github.com/kriscamilleri/panino/actions

## Changes Made
- `frontend/src/store/syncStore.js` — Added `DEFAULT ''` to `name`, `DEFAULT (datetime('now'))` to `created_at`/`updated_at` in `DB_SCHEMA` and both paths of `ensureTemplatesSchema()`; added migration block for existing databases with old schema
- `backend/api-service/db.js` — Same DEFAULT fixes in `BASE_SCHEMA`; added `ensureTemplatesSchema()` function with migration logic; called from `getUserDb()` and `getTestDb()` before `ensureCrr()`
- `da73502` feat: template extensions — dynamic titles, default folders, inline variables, sidebar refresh
- `955ecab` chore: gitignore prd-server.env, remove stale screenshot
- `7674c67` feat: duplicate file, collapse all submenus, refresh recents after sync
- `1f870e3` Merge branch 'feature/file-templates' into develop
- `3455b74` feat: implement Template Manager with variable resolution and CR-SQLite sync

## Open Items / Notes
- CI only triggers on `main` — no separate develop/staging pipeline
