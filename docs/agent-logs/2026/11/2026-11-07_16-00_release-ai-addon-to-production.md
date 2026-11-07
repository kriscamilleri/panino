# Release: API keys, v1 API and the AI agents add-on to production

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-07 16:00 UTC, deploy 16:09–16:14 UTC
- Status: Deployed and verified; the add-on is not yet turned on in production

## Objective

Kris asked to merge `develop` into `main` (which deploys) and to make the AI agents add-on
available so a Claude account can connect to a Panino account.

## Progress

- Rehearsal: `scripts/build-frontend.sh` on a clean `git archive` of `origin/develop` in
  `node:22.14.0-bookworm-slim` passed. No lockfile changed in this release.
- Read-only server pre-flight on `<PROD_IP>`:
  - Checkout is `main` at `d5c008c`, with no tracked drift.
  - Node 22.14.0 / npm 10.9.2.
  - Spaces and live sessions are on.
  - `PUBLIC_API_BASE_URL` and `FRONTEND_URL` are correct.
  - 7.0 GB free, with 0.8 GB of build cache.
  - No error lines in 24 h of API logs.
- Backup immediately before merging: `panino-databases-20261107T160453Z.tar.gz` (22 databases,
  checksum OK). Staged with `stage-production-restore.mjs`: validated, 3 spaces, 45 files.
- PR #19 (`develop` → `main`): every CI check passed. Merged as `c83d304`. Deploy run
  42389860535 passed tests and deploy. `deploy.sh` installed the nginx config, `nginx -t` passed,
  and nginx reloaded.
- Turning the add-on on (backing up `.env`, appending `AI_ADDON_ENABLED=true`, then
  `docker compose up -d api-service`) was blocked by the agent's permission classifier. It was not
  run, and no server file was changed.

## Changes Made

- PR #19 merged to `main`.
- Production: no files edited by hand.

## Tests

- After deploy: server checkout `c83d304`, container up and listening, no error lines.
- `https://panino.sh/` returns 200, and `/api/addons` returns 401 without a token.
- `/.well-known/oauth-authorization-server` returns 404 JSON from Express. So the new nginx
  location reaches the API, and the API refuses because the add-on is not offered (other
  `/.well-known/` paths return the SPA's 200).
- Disk afterwards: 5.5 GB free.

## Open Items / Notes

- **To turn the add-on on**, on the server in `/home/kris/www/panino`:
  1. Back up `.env`.
  2. Append `AI_ADDON_ENABLED=true`.
  3. Run `docker compose up -d api-service`. This restarts the API, which interrupts live sessions.
  4. Check: `/.well-known/oauth-authorization-server` returns 200 JSON.
  5. Check: the add-on appears in Settings → Add-ons.
- After that, connect claude.ai (Settings → Connectors → custom connector,
  `https://panino.sh/api/addons/ai/v1/mcp`). This is the first end-to-end check against a real
  client.
- `develop` does not have the merge commit `c83d304` from `main`.
