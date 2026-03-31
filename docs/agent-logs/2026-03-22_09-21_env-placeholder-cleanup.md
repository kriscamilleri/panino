# Env Placeholder Cleanup

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 09:21
**Status:** completed

## Objective
Replace stale local env files with placeholder values for the variables the app actually uses, and remove obsolete keys.

## Progress
- [x] Inventory actual env variable usage from code and compose files
- [x] Update root `.env` placeholders and remove obsolete keys
- [x] Update `frontend/.env` placeholders and remove obsolete keys
- [x] Align README env documentation with the real config split
- [x] Validate resulting files for obvious issues
- [x] Update deploy-time frontend env generation to remove obsolete keys

## Changes Made
- `/.env` — replaced stale values with placeholders for the actual root env contract, removed obsolete CouchDB keys, and retained `VITE_TURNSTILE_SITE_KEY` because `docker-compose.dev.yml` interpolates it.
- `frontend/.env` — replaced obsolete `VITE_COUCHDB_*` keys with the actual frontend dev keys used by Vite.
- `README.md` — corrected the environment variable documentation to match the real root/frontend split and removed obsolete env examples.
- `deploy.sh` and `frontend/.env.production` — replaced obsolete production frontend env keys with the actual Vite env contract used by the app.

## Follow-up 2026-03-22 09:24
- Restored the original `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` values in `/.env` after the placeholder cleanup replaced them.

## Follow-up 2026-03-22 09:25
- Restored the original local `FRONTEND_URL` and `PUBLIC_API_BASE_URL` values in `/.env` after the placeholder cleanup replaced them with production-style placeholders.

## Tests
- Rendered `docker compose -f docker-compose.dev.yml config` after cleanup.
- Checked `.env`, `frontend/.env`, and `README.md` for editor errors — none found.

## Open Items / Notes
- Root `.env` currently contains obsolete CouchDB variables.
- `frontend/.env` currently contains obsolete `VITE_COUCHDB_*` variables.