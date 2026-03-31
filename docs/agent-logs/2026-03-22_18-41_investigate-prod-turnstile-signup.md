# Investigate Prod Turnstile Signup

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 18:41
**Status:** completed

## Objective
Investigate why production signup on panino.sh fails Turnstile verification and determine the production-side root cause.

## Progress
- [x] Trace frontend signup and Turnstile token submission code
- [x] Trace backend signup Turnstile verification code
- [x] Inspect production server env and running backend container secret
- [x] Verify live production page behavior and deployed frontend artifact state
- [x] Apply and validate a production fix if the cause is confirmed

## Changes Made
- `docs/agent-logs/2026-03-22_18-41_investigate-prod-turnstile-signup.md` — created the required log for this production investigation.
- `deploy.sh` — switched deploy-time frontend env generation to `.env.production.local` so production injects `VITE_TURNSTILE_SITE_KEY` without mutating the tracked `frontend/.env.production` file on the server.
- `main` — cherry-picked and pushed the deploy fix as `dfbc02d47d6bb9fd171e87369aee5c58d33ea456`.

## Tests
- Verified frontend signup sends `cf-turnstile-response` only when the frontend has a Turnstile site key configured.
- Verified backend signup rejects with `Captcha verification failed` when `TURNSTILE_SECRET_KEY` is set and Cloudflare verification returns false.
- Verified production root `.env` and running backend container both contain the same masked `TURNSTILE_SECRET_KEY` suffix.
- Verified production `frontend/.env.production` on the server is locally modified and currently lacks `VITE_TURNSTILE_SITE_KEY`.
- Verified the live production signup page currently renders no Turnstile widget.
- Ran `bash -n deploy.sh` and confirmed deploy-time env generation now targets `.env.production.local` with `VITE_API_SERVICE_URL` and `VITE_TURNSTILE_SITE_KEY`.
- Monitored GitHub Actions deploy run `23408835222` for commit `dfbc02d47d6bb9fd171e87369aee5c58d33ea456` — completed successfully.
- Reloaded `https://panino.sh/#/signup` and confirmed the page now loads Turnstile, generates a `cf-turnstile-response` token, and signup no longer fails with `Captcha verification failed`.
- Submitted the production signup form using an existing email and got `409 User with this email already exists`, confirming captcha verification passed and the request reached normal application validation.

## Open Items / Notes
- Current evidence points to a frontend/backend mismatch in production: backend Turnstile verification is enabled, but the generated frontend production env on the server does not expose a Turnstile site key.
- Root cause confirmed: `main` was still generating the production frontend env into the tracked `frontend/.env.production` with obsolete keys, so the deployed frontend had no `VITE_TURNSTILE_SITE_KEY` while the backend still enforced `TURNSTILE_SECRET_KEY`.
- The deploy script now writes `.env.production.local`, which fixes Turnstile in production and avoids future pull conflicts caused by mutating a tracked env file on the server.