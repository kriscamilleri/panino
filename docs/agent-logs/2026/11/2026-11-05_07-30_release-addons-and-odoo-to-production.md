# Release: add-on framework, Odoo integration and Odoo overview to production

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-03 (pre-flight), deploy 2026-11-05 07:38 UTC
- Status: Deployed and verified; GitHub OAuth callback URL still to change by hand

## Objective

Kris asked to merge `develop` into `main` (which deploys) and to fix the GitHub OAuth callback
path for the add-on move (`/api/addons/github/callback`).

## Progress

- The callback path needed no server change: the API builds it from `PUBLIC_API_BASE_URL`, which
  is `https://panino.sh/api` in production. The value to change is the OAuth app's
  Authorization callback URL on github.com.
- Rehearsals before merging: `scripts/build-frontend.sh` on a clean `git archive` of `develop` in
  `node:22.14.0-bookworm-slim` (npm 10.9.2) passed, since `shared/package-lock.json` changed; the
  production API image built and started.
- Server SSH only accepted the password. Kris installed his key (`ssh-copy-id`); everything after
  that ran over the key, without loading the password.
- Read-only pre-flight on `<PROD_IP>`: checkout `main` at `9c4f198` (= `origin/main`), no tracked
  drift (only untracked `.env` backups, `backups/`, an old lockfile backup); Node 22.14.0 / npm
  10.9.2; spaces and live sessions on; `PUBLIC_API_BASE_URL` correct; no error lines in 24 h of API
  logs; **disk 94% full, 1.1 GB free**.
- Disk: `docker system df` showed 6.7 GB of build cache, which `deploy.sh` never prunes. With
  Kris's approval, `docker builder prune -f` (2026-11-05 07:38 UTC) brought the disk to 8.6 GB free.
  No images, containers, volumes or data were touched.
- Backup immediately before merging: `panino-databases-20261104T094849Z.tar.gz` in
  `~/backups/panino` (22 databases, checksum OK, manifest present). Staged with
  `stage-production-restore.mjs` into a scratch directory: validated, 3 spaces, 45 files.
- Merged PR #18 (`d5c008c`). Deploy workflow run 41988691545: tests and deploy succeeded. The API
  image now runs Node 24.22.2 (floating tag); `deploy.sh` removed the older dangling image and
  reported 7.1 GB free.

## Changes Made

- PR #18 merged to `main` (32 commits; see the PR description).
- Production: Docker build cache pruned (approved). No files on the server were edited.

## Tests

- CI on #18: lint, shared, frontend, backend, build all passed; the same on the `main` push.
- After deploy: server checkout `d5c008c`, container up, API log shows databases initialized and
  the service listening with no errors; `https://panino.sh/` 200; `/api/addons` 401 without a
  token; `/api/addons/github/callback` 302 (the new route answers).

## Open Items / Notes

- **GitHub OAuth app**: set the Authorization callback URL to
  `https://panino.sh/api/addons/github/callback` (github.com → Settings → Developer settings →
  OAuth Apps). Chrome site permissions blocked github.com for the agent. Until changed, new GitHub
  connections fail; existing daily backups keep running.
- `deploy.sh` should prune the build cache too (e.g. `docker builder prune -f --filter until=168h`),
  or the disk fills again within a few releases.
- Odoo turned on in production at Kris's request (2026-11-05 07:53 UTC): the server `.env` backed
  up to `.env.bak.20261105075320`, then `ODOO_INTEGRATION_ENABLED=true` and a 64-character
  `ODOO_CREDENTIAL_ENCRYPTION_KEY` appended from Kris's `.env.prd` (sent over SSH stdin, never
  printed); no other line changed. `docker compose up -d api-service` recreated the container; it
  started with no add-on config warning, and `offeredAddons()` in the container lists
  `github, odoo`. The key must never change: it encrypts users' stored Odoo API keys.
