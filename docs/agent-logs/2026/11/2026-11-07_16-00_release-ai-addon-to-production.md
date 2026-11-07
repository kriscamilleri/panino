# Release: API keys, v1 API and the AI agents add-on to production

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-07 16:00 UTC, deploy 16:09–16:14 UTC
- Status: Deployed, add-on on in production and verified over HTTPS; claude.ai connection not yet tried

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
- Turning the add-on on. The first attempt, a single command that appended and restarted, was
  blocked by the agent's permission classifier and did not run. Then Kris approved adding to
  `.env` without modifying or deleting anything (16:16 UTC):
  - `.env` was copied to `.env.bak.20261107161622`.
  - Three lines were appended: a blank line, a comment, and `AI_ADDON_ENABLED=true`. `diff`
    shows no other change.
  - The first restart attempt was blocked by the classifier. Kris then asked for it, and
    `docker compose up -d api-service` recreated the container at about 16:19 UTC.
  - In the container, `AI_ADDON_ENABLED`, `SHARED_SPACES_ENABLED`, `LIVE_SESSIONS_ENABLED` and
    `ODOO_INTEGRATION_ENABLED` are all `true`.
  - The log shows the API listening. The only warning is the existing GitHub key notice.

## Changes Made

- PR #19 merged to `main`.
- Production `.env`: `AI_ADDON_ENABLED=true` appended (backup `.env.bak.20261107161622`).
- Production: API container recreated to load it.

## Tests

- After deploy: server checkout `c83d304`, container up and listening, no error lines.
- `https://panino.sh/` returns 200, and `/api/addons` returns 401 without a token.
- `/.well-known/oauth-authorization-server` returns 404 JSON from Express. So the new nginx
  location reaches the API, and the API refuses because the add-on is not offered (other
  `/.well-known/` paths return the SPA's 200).
- Disk afterwards: 5.5 GB free.
- After the add-on was on:
  - `/.well-known/oauth-authorization-server` returns 200 with issuer `https://panino.sh` and the
    endpoints under `/api/addons/ai/oauth/`, S256, and Client ID Metadata Documents.
  - `/.well-known/oauth-protected-resource/api/addons/ai/v1/mcp` returns 200.
  - An unauthenticated MCP `initialize` returns 401, with `WWW-Authenticate: Bearer
    resource_metadata=…` pointing at that document. An empty POST returns the JSON-RPC 400 error.

## Open Items / Notes

- After that, connect claude.ai (Settings → Connectors → custom connector,
  `https://panino.sh/api/addons/ai/v1/mcp`). This is the first end-to-end check against a real
  client.
- `develop` does not have the merge commit `c83d304` from `main`.
