# Production Database Streaming Backup

> Stream consistent snapshots of every production SQLite database to an operator's machine.
> Status: shipped
> Created: 2026-08-16
> Last updated: 2026-08-16
> Shipped: 2026-08-16 (see `docs/agent-logs/2026/08/2026-08-16_08-46_production-database-streaming-backup.md`)
> Implementation: `scripts/production-database-backup/`, `backend/api-service/tests/unit/stream-database-backup.test.js`

## Summary

Provide an operator command that backs up the auth database and every per-user database
without API downtime or remote disk consumption. The resulting local artifact is a
gzip-compressed tar archive with a SHA-256 checksum.

## User journey

| Persona | Journey | Acceptance criteria |
|---|---|---|
| Production operator | Run one local command using machine-local SSH credentials | Every production `.db` present at discovery time is included in a validated local archive |
| Production operator | Back up while users continue using Panino | Each database is a transactionally consistent online snapshot that includes committed WAL changes |
| Production operator | Recover from an SSH, snapshot, or validation failure | No completed-looking local archive remains and no remote snapshot file remains |

## Goals

- Keep `api-service` online throughout the backup.
- Use SQLite's online backup API rather than copying live WAL-mode files.
- Stream archive bytes over SSH without writing a backup to remote disk.
- Hold at most one snapshot at a time in the container's RAM-backed `/dev/shm`.
- Report snapshot and transfer progress for each database without displaying user database
  filenames.
- Validate gzip and tar structure before atomically publishing the local archive.
- Keep SSH credentials in the existing ignored environment file.

## Non-goals

- Uploaded image files are not included.
- Snapshots of separate databases are not globally atomic with one another.
- The script does not upload, rotate, encrypt, or restore backups.
- The script does not increase the container's `/dev/shm` allocation.

## Security and failure handling

- Archive files and their parent creation context use a restrictive `umask`.
- SSH host keys use `accept-new`, never unconditional host-key bypass.
- Passwords are passed to `sshpass` through `SSHPASS`, not command-line arguments.
- Only regular files ending in `.db` are archived; generated tar entry names cannot contain
  path separators.
- A `.part` file is removed on transfer or validation failure and renamed only after gzip and
  archive-content checks pass.
- The remote temporary snapshot directory is removed in a `finally` block.
- If `/dev/shm` cannot fit the next database, the stream fails with explicit capacity details.

## Verification

- Unit coverage confirms file filtering, stable ordering, empty-directory failure, valid tar
  framing, restoration of a committed row that still resides in a source WAL, all progress
  stages, and suppression of user database filenames.
- A command-level smoke test feeds the producer through Node stdin, validates the gzip with
  system tools, extracts it with GNU tar, queries the restored database, and verifies that
  progress is written separately to stderr.
