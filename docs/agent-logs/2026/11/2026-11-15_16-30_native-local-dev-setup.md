# Local dev stack without Docker, and how to document it

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-15, 16:30
- Status: Done on `docs/native-local-dev`; committed, not pushed (no GitHub credentials in the agent environment)

## Objective

Get the app running locally, prove a signed-in test account with a screenshot, then record the
steps in the README and `AGENTS.md`.

## Progress

1. **Docker could not be used.** `dockerd` started, then exited: `failed to create NAT chain
   DOCKER: iptables ... Permission denied (you must be root)`. The container lacks the network
   capability, so `docker compose -f docker-compose.dev.yml up` is not an option here.
2. **Ran natively instead.**
   - Installed Node 24.19.0 (from `.nvmrc`) to `~/.local/node` from the nodejs.org tarball.
   - Ran `npm ci` in `shared/` (`--omit=dev`), `backend/api-service/` (then `npm run
     native:setup`) and `frontend/`.
3. **Started both servers.** Backend: `node index.js` with the dev-compose defaults set inline.
   Frontend: `npx vite` with `VITE_TURNSTILE_SITE_KEY=` empty.
4. **Signed in with Puppeteer.**
   - Puppeteer's Chrome first failed on a missing `libnspr4.so`. Installing the Chrome
     libraries from the backend Dockerfile with `apt-get` fixed it.
   - First navigation went to `/signup`, which redirected to `/signup#/login?redirect=/`
     because routing is hash-based. Switched to `/#/signup`.
   - Signed up a throwaway account, then signed in from a fresh browser context. It landed on
     `/#/` showing the account name and "Sync On".

## Changes Made

- `README.md`: new "Without Docker (native)" and "Signing in locally" subsections under
  Developer Guide → Development.
- `AGENTS.md` §3: what agents should do when the Docker daemon cannot start.

## Tests

- After sign-in, `localStorage` held `jwt_token` plus the CR-SQLite clock and push-cursor keys
  for the new user.
- The backend log showed `WebSocket client connected and authenticated` and `Received 24 changes`.
- The only browser console error was a 404 for `/favicon.ico`.

## Open Items / Notes

- The backend does not read the root `.env` in a native run, so Turnstile, GitHub OAuth and SMTP
  are off unless set inline.
- `/favicon.ico` returns 404 from the Vite dev server; harmless.
