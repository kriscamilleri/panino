# Deployment runbook

## Before deploying

1. Confirm the branch has passed the frontend and backend CI checks.
2. Confirm the server checkout is clean. The deploy workflow performs this check before
   running `git pull`.
3. Confirm the required GitHub secrets (`SSH_PRIVATE_KEY`, `SSH_USER`, `SSH_HOST`,
   `PROJECT_PATH`) are present.

## What `deploy.sh` does

From the repository root, `deploy.sh`:

1. Loads deployment configuration from `.env`.
2. Builds the frontend and writes its production environment file.
3. Generates and, when running as root, installs the Nginx configuration.
4. Starts the production `api-service` container with Docker Compose.

The production compose file mounts `api-data` at `/app/data` and `uploads-data` at
`/app/uploads`. Those directories are runtime volumes and must not be copied into image
layers.

## Routing

- `/` serves the built frontend from Nginx.
- `/api/*` proxies to the backend with the `/api` prefix stripped.
- `/ws/*` proxies WebSocket upgrades to the backend.

## Failure handling

If the server checkout is dirty, stop and inspect the named files before changing anything.
Do not discard server changes automatically. If a deploy fails after the pre-flight check,
inspect the workflow output and the server's Docker/Nginx logs before retrying.

For production debugging or a manual recovery, load the `prod-server-debug` skill and follow
its read-only-first rule.
