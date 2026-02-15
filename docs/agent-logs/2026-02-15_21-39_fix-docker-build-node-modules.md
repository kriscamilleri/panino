# Fix Docker build node_modules conflict

**Agent:** GitHub Copilot (GPT-5.3-Codex)
**Started:** 2026-02-15 21:39
**Status:** completed

## Objective
Resolve Docker compose build failure caused by COPY conflict between host and container dependency layouts.

## Progress
- [x] Identify root cause from build output and Dockerfile
- [x] Add dockerignore rules to exclude host dependencies
- [x] Re-run compose build to verify fix
- [x] Document result

## Changes Made
- `backend/api-service/.dockerignore` — added `node_modules` and common noise files so host dependencies are excluded from Docker context.
- `frontend/.dockerignore` — added `node_modules` and common noise files so frontend context stays clean and deterministic.

## Tests
- Ran `docker compose -f docker-compose.dev.yml build api-service frontend` from project root.
- Result: both images built successfully; previous `COPY . .` conflict is resolved.

## Open Items / Notes
- Compose still emits warnings about missing `VITE_TURNSTILE_SITE_KEY` and obsolete `version` key; these are unrelated to the build failure.
