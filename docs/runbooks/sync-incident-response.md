# Sync incident response

Use this runbook for repeated `/sync` failures, especially
`could not find row to merge with` errors. Default to read-only inspection.

## 1. Capture the incident

Record the UTC time, affected user alias, request error category, and whether the server
connection was invalidated. Do not record JWTs, credential values, full user UUIDs, or raw
image contents.

## 2. Back up before repair

On the server, stop writes or otherwise coordinate a maintenance window. Copy the affected
database and matching `-wal`/`-shm` files to a timestamped backup directory. Verify the copy
before applying any repair.

The production database directory is normally `/app/data` inside the API container. Use the
container's matching Node/CR-SQLite runtime when inspecting CRR support tables.

## 3. Dry-run the orphan detector

From `backend/api-service/`:

```bash
DB_DIR=/app/data node scripts/repair-orphan-image-clocks.mjs
DB_DIR=/app/data node scripts/repair-orphan-image-clocks.mjs --user <user-id>
```

The dry-run reports non-sentinel clock rows whose mapped base image is missing and whose key
has no `-1` deletion sentinel. It does not mutate the database.

## 4. Apply only after review

After the backup and dry-run output are reviewed:

```bash
DB_DIR=/app/data node scripts/repair-orphan-image-clocks.mjs --apply
DB_DIR=/app/data node scripts/repair-orphan-image-clocks.mjs --apply --user <user-id>
```

The helper deletes only the orphan non-sentinel rows inside a transaction. It preserves
healthy image clock rows and normal deletion sentinels. Never add `--apply` to an incident
command without an identified backup.

## 5. Verify

Run the dry-run again. It should report zero orphan rows. Verify that:

- normal `-1` sentinel rows are still present;
- healthy base images and their clock rows remain;
- the API has restarted or invalidated all handles opened before repair;
- the affected client can advance its sync clock;
- logs show no repeated merge errors or unexpected skipped changes.

## 6. Escalate

If the sync bit is non-zero on a live handle, invalidate that per-user connection and reopen
it through the normal application path. Do not perform ordinary CRR deletes through a
connection that has not passed the health check. Preserve the backup and incident log for
promotion into `docs/architecture/crsqlite-sync.md` if a new durable failure mode is found.
