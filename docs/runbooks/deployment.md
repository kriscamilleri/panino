# Deployment runbook

## Before deploying

1. Confirm the branch has passed the CI checks: lint, shared, frontend, backend, and `build`.
   The `build` job builds the frontend bundle through the same script `deploy.sh` calls and
   builds the production API image, both from a clean checkout.
2. Confirm the server checkout is clean. The deploy workflow performs this check before
   running `git pull`.
3. Confirm the required GitHub secrets (`SSH_PRIVATE_KEY`, `SSH_USER`, `SSH_HOST`,
   `PROJECT_PATH`) are present.

## What `deploy.sh` does

From the repository root, `deploy.sh`:

1. Loads deployment configuration from `.env`.
2. Writes the frontend's production environment file and runs `scripts/build-frontend.sh`,
   which installs `shared/`, then `frontend/`, and builds. The frontend reaches `shared/`
   through a `file:` link, and npm does not install a linked directory's own dependencies,
   so `shared/` has to be installed first. If the build fails, nothing is published and the
   running site is unchanged.
3. Generates and, when running as root, installs the Nginx configuration.
4. Starts the production `api-service` container with Docker Compose.

The production compose file mounts `api-data` at `/app/backend/api-service/data` and
`uploads-data` at `/app/backend/api-service/uploads`. Those directories are runtime volumes
and must not be copied into image layers. Operator tooling must use these mounted paths;
`/app/data` and `/app/uploads` are not the production volumes.

## First deploy of the collaboration release

This release changes where the two volumes are mounted inside the container and adds
metadata. The volumes themselves (`api-data`, `uploads-data`) are the same, so the data
carries over. On its first start the new image:

- finds the databases at `/app/backend/api-service/data` instead of `/app/data`;
- creates `_spaces.db` (empty while `SHARED_SPACES_ENABLED` is false);
- switches `_users.db` to write-ahead logging, so it gains `-wal` and `-shm` files like
  every other database already has;
- adds columns to each user's `note_revisions` table the first time that user's database is
  opened.

Take a backup immediately before merging (see below). The backup script works against the
container that is running at that moment: it finds the data directory in either layout, and
an estate that has no shared spaces yet is archived as a complete backup with
`"spacesMetadata": false` in its manifest. Stage that archive once to prove it restores
before relying on it.

## Rolling back a release

Roll back by reverting the commit on `main` and letting the pipeline deploy it, so the
compose file, the frontend and the image all go back together.

Do **not** start the previous image under the current compose file. The previous image
reads `/app/data`; the current compose file mounts the volume elsewhere, so that image would
start on an empty directory inside the container. Every login would fail, new sign-ups would
create accounts that vanish when the container is replaced, and the real data would sit
untouched but unreachable. The image `deploy.sh` keeps as "previous build" is only usable
together with the compose file from the same commit.

Databases written by this release stay readable by the previous one: the added tables and
columns are ignored by it, and a database in write-ahead-logging mode opens normally. This
was checked locally by running the previous release against data the new one had migrated
and used.

## Collaboration feature flags

All collaboration gates default to false in Compose:

```text
CONTENT_MERGE_WRITEBACK_ENABLED=false
SHARED_SPACES_ENABLED=false
LIVE_SESSIONS_ENABLED=false
```

`CONTENT_MERGE_WRITEBACK_ENABLED` applies to every account, shared spaces or not. While it is
false, two devices that edit the same Document at the same time get a conflict to review, with
both versions kept. Setting it to `true` lets clients merge non-overlapping edits on their own;
overlapping edits still become a conflict. Each `/sync` response carries the current value, so
the change takes effect on the next sync without a client release, and setting it back to
`false` stops automatic merging the same way.

`FRONTEND_URL` and `PUBLIC_API_BASE_URL` must be set to the public origin. PDF export embeds a
Document's own images only from relative paths or from absolute links on one of the configured
origins; an absolute link on any other origin is treated as external.

Enabling `SHARED_SPACES_ENABLED` adds these optional limits (defaults in brackets):
`SPACE_INVITES_PER_HOUR` (20 per owner), `SPACE_PENDING_INVITE_LIMIT` (50 per space),
`SPACE_OWNER_LIMIT` (20), `SPACE_MEMBER_LIMIT` (100), `SPACE_IMAGE_QUOTA_BYTES` (1 GiB per space)
and `DB_CONNECTION_CACHE_LIMIT` (200 open content databases). Invitations and "verify my email"
messages are sent through the same SMTP account as password resets, so `SMTP_*` and `FRONTEND_URL`
must be correct first: with mail not working, an account can still join a space through an
invitation link its owner copies to it, but cannot verify its address.

Live sessions also require shared spaces. Enable them only after a full backup and the isolated
two-account checks in `live-session-recovery.md`. Turning off the live flag rejects new sessions;
sessions already held by the process remain eligible to reconnect and save while they drain.
Recovery rows are never deleted just because the flag is off.

## Odoo integration

Off by default in Compose (`docs/specs/active/odoo-integration.md`):

```text
ODOO_INTEGRATION_ENABLED=false
ODOO_CREDENTIAL_ENCRYPTION_KEY=
ODOO_ALLOWED_PRIVATE_HOSTS=
```

The routes answer 404 unless the flag is `true` **and** `ODOO_CREDENTIAL_ENCRYPTION_KEY` is at
least 32 characters; with the flag on and the key missing, the API logs a warning at start and
the integration stays off. Generate the key once (`openssl rand -base64 48`) and keep it with the
other server secrets: users' Odoo API keys are encrypted with it, so changing or losing it means
every user has to enter their Odoo key again (the app asks them to). Unlike GitHub backup, there
is no fallback to `JWT_SECRET`.

The server only connects to Odoo over https at public addresses. A self-hosted Odoo on a private
network needs its hostname in `ODOO_ALLOWED_PRIVATE_HOSTS` (comma-separated); listed hosts may
also use plain http. Leave it empty unless such a server exists.

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

During the run, stderr shows each database or space upload's snapshot/transfer progress and
completion. Per-user and per-space identifiers are deliberately replaced with ordinal labels;
the authentication and shared-space metadata databases are identified by role.

The archive contains a versioned, hashed path manifest and preserves the production layout:
`data/_spaces.db`, every `data/spaces/<spaceId>.db`, `uploads/spaces/<spaceId>/`, personal
databases, and `data/_users.db`. SQLite files use the online backup API. Space uploads are
streamed as regular files; if a file changes while it is read, or a symlink/non-UUID space
root is encountered, the backup fails and its partial local artifact is removed.

**Personal images are not in the archive.** Only the shared-space part of the uploads volume
is. Everything else under the uploads volume has no backup from this tool, on this release
or any earlier one; back that volume up separately if the images matter.

Always copy databases with this tool, never with `cp`. Every database uses write-ahead
logging, so recent commits can live in the `-wal` file beside it; a plain copy of the `.db`
file alone can be missing them.

Before relying on an archive, verify it locally:

```bash
cd ~/backups/panino
sha256sum -c panino-databases-<UTC timestamp>.tar.gz.sha256
tar -tzf panino-databases-<UTC timestamp>.tar.gz
```

Do not extract an archive over the production volume. Stage and validate it with:

```bash
node scripts/production-database-backup/stage-production-restore.mjs \
  --archive ~/backups/panino/panino-databases-<UTC timestamp>.tar.gz \
  --staging-dir /srv/panino-restore/<UTC timestamp>
```

The command verifies the companion SHA-256 file before extraction; rejects absolute,
traversing, duplicate, unmanifested, and unsupported paths; checks every manifest digest;
runs `PRAGMA integrity_check` on every database; runs `assertSpacesInvariants()` against the
staged auth and space metadata databases; verifies every shared image row has matching bytes;
and requires the metadata space ids, space database files, and upload roots to agree. A selected `--only`/`--exclude` diagnostic archive is not a
full restore and is rejected. On failure, the temporary staging tree is removed; live data is
never touched.

## Restore maintenance window

A restore changes production state and requires explicit approval in the current incident,
a fresh timestamped backup, and an agent log. Keep `SHARED_SPACES_ENABLED=false` until the
drill and application release are approved.

1. Run the staging command above on the target host and record its reported snapshot time,
   entry count, and space count. Never edit the staged set after validation.
2. Resolve the exact `api-data` and `uploads-data` mountpoints with read-only Docker Compose
   inspection. Do not assume a host path and do not operate on a broad directory or unresolved
   variable.
3. Stop `api-service` so no database, membership, or upload can change. Take a second backup
   and verify its checksum; this is the rollback point.
4. Install the staged set as one maintenance operation:
   - **Data volume:** move everything in it aside under a timestamped rollback name,
     including every `-wal` and `-shm` file, then copy in the staged `data/` tree. A `-wal`
     file left beside a database it does not belong to can corrupt that database.
   - **Uploads volume:** replace only its `spaces/` directory with the staged
     `uploads/spaces/` tree, keeping the previous `spaces/` under a rollback name. Leave the
     rest of the volume exactly as it is: those are personal images, they are not in the
     archive, and replacing the volume would remove them.
   Never restore `_spaces.db`, a space database, or a space upload directory individually.
5. Before admitting traffic, check the installed set against the manifest it came from:

   ```bash
   node scripts/production-database-backup/stage-production-restore.mjs \
     --verify-installed /srv/panino-restore/<UTC timestamp>/panino-backup-manifest.json \
     --data-dir <api-data mountpoint> \
     --uploads-dir <uploads-data mountpoint>
   ```

   It reads only. It requires every database and shared-space upload to be present and
   byte-identical to the backup, nothing extra in their place, no write-ahead log with
   content beside a database, and the same integrity and invariant checks as staging.
   Personal uploads are ignored. If it fails, keep the API stopped and put the complete
   rollback set back. (`--verify-dir` rechecks a staging directory, not the volumes.)
6. Start `api-service` only after the whole set passes. With the shared-spaces flag still
   disabled, verify personal login/sync first; then perform the separately approved,
   flag-enabled two-account space drill and confirm membership, content, and images all load.
7. Retain both the source archive and rollback set until the recovery is signed off.

Images uploaded after the backup stay on disk but the restored databases do not list them;
Documents restored from the backup that reference images deleted since will show them as
missing. Neither is repaired by the restore.

Because SQLite online backup is per database, the archive is a bounded sequence rather than a
cross-file filesystem snapshot. Traffic gating makes restore admission all-or-nothing;
membership versions force client refresh, and CR-SQLite converges slightly stale complete
content after service resumes. See the fixed contract in
[`docs/specs/proposed/collab-04-phase-0-design-artifacts.md`](../specs/proposed/collab-04-phase-0-design-artifacts.md) §5.

## Rehearse a release on a copy of production

Before a release that changes how databases are opened or migrated, run the new image against a
copy of the real estate. Nothing here writes to production; the only production access is the
backup itself.

1. Take a fresh backup and stage it with the commands above. Staging is the first check: it is
   the restore tool run on real data.
2. Copy the staged `data/*.db` files into a working directory. Never run anything against the
   staged set itself; it stays as validated.
3. Run the new image on the working copy with **no network (`--network none`) and a `JWT_SECRET`
   that is not production's**. This is not optional. A `/sync` from an account that has GitHub
   backup configured starts that account's daily backup. With production's secret and a network,
   a rehearsal would push real users' Documents to their repositories; with neither, the attempt
   fails at decrypting the stored token and goes nowhere. Set `IMAGE_PRUNE_DISABLED=1` too: the
   archive holds no personal images, so the copy's image rows have no files.
4. Check that every database opens (`getDb` migrates and fails closed), that the API serves
   `/me` and a full `/sync` pull for every account, and that the flag-gated routes answer 404.
5. Start the previous release's image on the same working copy and repeat the pull. The counts
   must match: that is the rollback.
6. Compare each library's Documents, folders and images with the staged backup. They must be
   identical; only schema is allowed to differ.

The copy holds real user data. Report counts, never ids or text, and say where the copy was left.

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
