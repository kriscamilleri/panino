# Investigate Prod Turnstile Signup

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 18:41
**Status:** in-progress

## Objective
Investigate why production signup on panino.sh fails Turnstile verification and determine the production-side root cause.

## Progress
- [x] Trace frontend signup and Turnstile token submission code
- [x] Trace backend signup Turnstile verification code
- [x] Inspect production server env and running backend container secret
- [x] Verify live production page behavior and deployed frontend artifact state
- [ ] Apply and validate a production fix if the cause is confirmed

## Changes Made
- `docs/agent-logs/2026-03-22_18-41_investigate-prod-turnstile-signup.md` — created the required log for this production investigation.
- `deploy.sh` — switched deploy-time frontend env generation to `.env.production.local` so production injects `VITE_TURNSTILE_SITE_KEY` without mutating the tracked `frontend/.env.production` file on the server.

## Tests
- Verified frontend signup sends `cf-turnstile-response` only when the frontend has a Turnstile site key configured.
- Verified backend signup rejects with `Captcha verification failed` when `TURNSTILE_SECRET_KEY` is set and Cloudflare verification returns false.
- Verified production root `.env` and running backend container both contain the same masked `TURNSTILE_SECRET_KEY` suffix.
- Verified production `frontend/.env.production` on the server is locally modified and currently lacks `VITE_TURNSTILE_SITE_KEY`.
- Verified the live production signup page currently renders no Turnstile widget.

## Open Items / Notes
- Current evidence points to a frontend/backend mismatch in production: backend Turnstile verification is enabled, but the generated frontend production env on the server does not expose a Turnstile site key.
- The repo version on `main` still deploys the frontend without `VITE_TURNSTILE_SITE_KEY`; pushing the deploy-script fix to `main` and redeploying should restore the widget in production.