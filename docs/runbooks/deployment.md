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

## Stream a production database backup

Run the backup from a trusted local checkout:

```bash
./scripts/production-database-backup/backup-production-databases.sh
```

By default, the script reads the ignored `prd-server.env` file and writes
`~/backups/panino/panino-databases-<UTC timestamp>.tar.gz` plus a SHA-256 checksum.
Use `--env-file` or `--output-dir` to override either path. The preferred credential names
are `PANINO_PROD_HOST`, `PANINO_PROD_USER`, and `PANINO_PROD_PASSWORD`; the existing `IP`,
`UN`, and `P` names remain supported.

The API stays online. Inside the running container, SQLite's online backup API creates one
transactionally consistent database snapshot at a time in `/dev/shm`, streams it into the
gzip-compressed tar archive, and removes it immediately. No snapshot is written to remote
disk. The container's RAM-backed `/dev/shm` must have enough free capacity for the largest
database. If it does not, the command fails, removes the local `.part` archive, and reports
the required and available byte counts.

During the run, stderr shows each database's snapshot stage, snapshot size, transfer progress
in 10% increments, and completion. Per-user filenames are deliberately replaced with labels
such as `user database 2/12`; the authentication database is identified separately.

Before relying on an archive, verify it locally:

```bash
cd ~/backups/panino
sha256sum -c panino-databases-<UTC timestamp>.tar.gz.sha256
tar -tzf panino-databases-<UTC timestamp>.tar.gz
```

Do not extract an archive over the production volume. Restore into a separate directory,
validate the databases, and follow the production change approval and backup rules before
replacing any live data.

**Shared spaces are not yet covered by this backup.** When shared spaces are enabled, a space
adds `data/spaces/{spaceId}.db` and `uploads/spaces/` — the current backup enumerates only flat
`*.db` files in `/app/data`, so it captures `_spaces.db` but not the space content databases or
uploads, and its flat tar layout cannot represent the `spaces/` subdirectory. This gap is latent
while `SHARED_SPACES_ENABLED=false`; it must be closed before the flag is enabled in production.
See the atomic backup/restore contract in
[`docs/specs/proposed/collab-04-phase-0-design-artifacts.md`](../specs/proposed/collab-04-phase-0-design-artifacts.md) §5.

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
