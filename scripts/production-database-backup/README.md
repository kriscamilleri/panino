# Production database backup

Streams transactionally consistent snapshots of every production SQLite database directly
to the local machine. The API remains online, and no backup is written to remote disk.

## Run

From the repository root:

```bash
./scripts/production-database-backup/backup-production-databases.sh
```

The default output is:

```text
~/backups/panino/panino-databases-<UTC timestamp>.tar.gz
~/backups/panino/panino-databases-<UTC timestamp>.tar.gz.sha256
```

Use a different credential file or destination with:

```bash
./scripts/production-database-backup/backup-production-databases.sh \
  --env-file /path/to/production.env \
  --output-dir /path/to/backups
```

## Requirements

- Bash, OpenSSH, gzip, tar, awk, and sha256sum on the local machine.
- `sshpass` when password authentication is configured.
- Docker Compose and a running `api-service` container on production.
- Enough free space in the container's RAM-backed `/dev/shm` for the largest database.

The ignored environment file defaults to `prd-server.env` at the repository root:

```bash
PANINO_PROD_HOST=production-host
PANINO_PROD_USER=production-user
PANINO_PROD_PASSWORD=production-password
PANINO_REMOTE_APP_DIR=/private/production/checkout
```

Legacy `IP`, `UN`, and `P` names are also accepted. Optional settings are
`PANINO_PROD_PORT`, `PANINO_PROD_ENV_FILE`, and `PANINO_BACKUP_DIR`.

## How it works

1. The Bash script opens a non-interactive SSH connection to production.
2. It pipes `stream-database-backup.mjs` into Node inside the running API container.
3. The Node producer uses SQLite's online backup API to snapshot one database at a time into
   `/dev/shm`.
4. The producer writes a gzip-compressed tar stream to stdout and progress to stderr.
5. SSH carries stdout directly into a local `.part` file.
6. The Bash script validates the archive, writes its checksum, and atomically publishes both
   final files.

Per-user database filenames are hidden from progress output. The temporary snapshot and local
partial files are removed if any stage fails.

## Verify

```bash
cd ~/backups/panino
sha256sum -c panino-databases-<UTC timestamp>.tar.gz.sha256
tar -tzf panino-databases-<UTC timestamp>.tar.gz
```

Do not extract directly over the production data volume. Restore into a separate directory
and validate the databases before any approved production recovery.
