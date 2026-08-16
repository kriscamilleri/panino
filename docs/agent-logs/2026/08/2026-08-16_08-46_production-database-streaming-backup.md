# Production database streaming backup

- Agent: Copilot CLI
- Started: 2026-08-16 08:46 CEST
- Status: Complete

## Objective

Add an operator-run Bash command that connects to the production server over SSH and streams
consistent snapshots of all auth and per-user SQLite databases directly to the local machine,
without API downtime or remote disk consumption.

## Progress

- Confirmed production stores `_users.db` and per-user `.db` files in the `api-data` Docker
  volume mounted at `/app/data`.
- Rejected a live tar of WAL-mode files because it would not provide a consistent snapshot.
- Prototyped SQLite serialization, then rejected it after a WAL-focused test showed that its
  output was not a portable standalone database.
- Switched to SQLite's online backup API with one temporary snapshot at a time in the
  container's RAM-backed `/dev/shm`.
- Added gzip/tar validation, atomic local publication, checksum generation, and failure
  cleanup.
- Added per-database snapshot, size, transfer percentage, and completion indicators on stderr.
  User database filenames are replaced by ordinal labels.
- Grouped the Bash entry point, Node producer, and operator README under
  `scripts/production-database-backup/`.
- Removed the production checkout path default from public code. The ignored operator
  environment file must now provide `PANINO_REMOTE_APP_DIR`.
- Added the brief `production-database-backup` project skill for approved execution and local
  verification.
- Completed an independent code review and fixed its finding: checksum failure could
  previously leave a final-named archive.

## Changes Made

- Added `scripts/production-database-backup/backup-production-databases.sh` as the local SSH
  orchestrator.
- Added `scripts/production-database-backup/stream-database-backup.mjs` to create online snapshots,
  frame a ustar archive, gzip it, and stream it to stdout.
- Added backend unit coverage for filtering, empty inputs, tar contents, restoration, and a
  committed change still resident in WAL.
- Documented operation, verification, capacity constraints, and restore safety in the
  deployment runbook and shipped spec.

## Tests

- `npm test --prefix backend/api-service -- --run tests/unit/stream-database-backup.test.js`
  - Passed after progress work: 1 file, 4 tests.
- `npm run test:be`
  - Passed in the canonical Node 24 Docker image: 15 files, 155 tests.
- `npm run lint`
  - Passed with 0 errors and 41 pre-existing warnings.
- `bash -n scripts/production-database-backup/backup-production-databases.sh`
  - Passed.
- Command-level smoke test
  - Streamed the producer through stdin, validated with `gzip -t`, listed and extracted with
    GNU tar, queried the restored database, and confirmed temporary snapshot cleanup.
  - Repeated with progress enabled; confirmed all stages appeared on stderr, the archive
    remained valid, and a fixture user database filename did not appear in progress output.
  - Repeated after relocating the producer; confirmed stdin execution still resolves the API
    container's `better-sqlite3` dependency and emits a valid archive.
- `git diff --check`
  - Passed.
- Production execution: `./scripts/production-database-backup/backup-production-databases.sh`
  - Completed at 2026-08-16 06:56 UTC.
  - Streamed 13 databases into a 10,357,443-byte local archive.
  - `sha256sum -c` passed; gzip/tar inventory reported 13 database entries.
  - Archive and checksum permissions are both `0600`; no local `.part` artifact remained.

## Open Items / Notes

- `/dev/shm` must have enough free capacity for the largest individual database. The producer
  checks this before each snapshot and fails with required and available byte counts.
- Uploaded image binaries are outside this database-only backup's scope.
