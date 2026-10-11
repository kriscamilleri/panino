# Merge and production deploy of the collaboration branch

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-11 18:35 (+02:00)
- Status: deployed; flags off; this log is committed on `docs/collab-deploy-log`, not on `main`

## Objective

Merge PR #9 (`feature/collab`) into `main` and deploy it, on the developer's instruction in this
conversation ("proceed with merging and triggering the deploy to production"). A push to `main`
runs the test workflow and then deploys.

## Before the merge

| Check | Result |
|---|---|
| CI on the PR head `6b8c962` | lint, shared, frontend, backend, build all pass |
| Production-copy drill | passed; see `2026-10-11_18-15_production-copy-drill.md` |
| Server checkout (read-only) | on `main` at `a26a051`, no tracked drift |
| Flags in the server's `.env` | none set; Compose defaults all three to `false` |
| Server disk | 5.8 GB free |
| API log before deploy, last 500 lines | no error lines |
| **The server's own frontend build** | passes |
| Backup immediately before merging | `panino-databases-20261011T163836Z.tar.gz`, checksum verified, staged and validated (13 files) |

The server builds the frontend with its host Node 22.14.0 and npm 10.9.2. CI's `build` job uses
Node 24.19.0 from `.nvmrc`, so CI passing did not show the server's `npm ci` would accept the
changed `frontend/package-lock.json` and the new `shared/package-lock.json`. I ran
`scripts/build-frontend.sh` on a clean `git archive` of the head in `node:22.14.0-bookworm-slim`
(same Node, same npm). It passed, and so did the real one.

## The deploy

Merged at 16:39:15Z as `d2f5ed5` (merge commit, checked against the PR head). Workflow run
38156359687: five test jobs and the deploy job all succeeded.

From the deploy log: fast-forward of 287 files; frontend built in 8.8 s and published; Nginx
configuration tested and reloaded; `api-service` recreated and started at 16:42:01Z; one older
image removed; 4.9 GB free afterwards.

## After the deploy (read-only)

| Check | Result |
|---|---|
| Server checkout | `main` at `d2f5ed5`, no tracked drift |
| Container | running, 0 restarts, not out of memory; 143 MiB |
| Volumes | the same two named volumes, now mounted at `/app/backend/api-service/data` and `/uploads`; the old paths do not exist in the container |
| Databases at the new mount | 14: the 12 user databases, `_users.db`, and the new `_spaces.db`; no space databases |
| Upload files at the new mount | 383, the number of image rows the drill counted |
| Flags inside the container | all three `false`; `NODE_ENV=production` |
| API log since start | start-up, both metadata databases initialised, listening, one client's WebSocket authenticated; no error lines |
| From outside | site 200, service worker 200, `/api/me` and `/api/spaces` 401 without a token |
| Served frontend | carries this release's id |

**Every user database has been opened and migrated by the new build in production: 12 of 12
carry the new schema marker**, counted read-only about two minutes after start. The revision
maintenance pass opens each database ten seconds after the API starts, so the migrations did not
wait for each account's first sync. The log has no error from any of them.

Not checked: a signed-in sync as a real account. I have no credentials for one and did not
create an account on production.

## Notes

- **The production image runs Node 24.21.0**, not the 24.19.0 that `.nvmrc` pins and CI tests.
  The Dockerfile's `node:24-*` tag floats, as `AGENTS.md` already warns. Same major version, so
  the native add-on's ABI matches; it was built in that image.
- **The server's host Node (22.14.0) is not the pinned one either.** It only builds the frontend.
  Worth pinning or building the frontend in a container, so CI builds what the server builds.
- Rollback, if needed: revert `d2f5ed5` on `main` and let the pipeline deploy it. Do not start
  the previous image under the current compose file (`docs/runbooks/deployment.md`).
- Production was read four times beyond the deploy itself: a pre-flight, and three checks
  afterwards. Nothing was written by me on the server; the deploy was done by the pipeline.

## Open Items

- This log is on a local branch. Pushing it to `main` would trigger another deploy.
- A person should open the app, edit a Document and watch it sync on a second device.
- On this machine, holding real user data: two archives in `~/backups/panino/`
  (`…20261011T161715Z`, `…20261011T163836Z`), `drill-20261011T161715Z/` and
  `predeploy-20261011T163836Z/`. The second archive is the rollback point for this deploy.
- Still open: rotating the production SSH password; one Document in one account that a full
  pull does not offer (drill log); the flags-on gates before either feature flag is enabled.
