# Repair production lockfile drift

Agent: Copilot CLI
Started: 2026-08-16 20:09 +02:00
Status: in progress

## Objective

Restore the production checkout so deployment can pull `main`, then prevent frontend dependency
installation from creating tracked lockfile drift.

## Progress

- Investigated the failed deployment read-only through the production checkout.
- Confirmed the only drift was `frontend/package-lock.json`: 42 removals of npm platform metadata
  for glibc and musl optional packages.
- Identified production Node `v22.14.0` and npm `10.9.2`; the drift occurred during the previous
  deployment's `npm install`.
- Confirmed the API container was healthy before repair.
- With explicit approval, backed up the production lockfile as
  `frontend/package-lock.json.backup-20260816T181005Z` and restored the tracked version.
- Replaced the mutable `npm install` in `deploy.sh` with `npm ci`.

## Changes Made

- Production checkout: restored the tracked frontend lockfile after creating a timestamped backup.
- Repository: deployment now uses `npm ci`, which installs exactly from the tracked lockfile
  without rewriting it.

## Tests

- `bash -n deploy.sh` — passed.
- `npm ci --dry-run --prefix frontend` — passed.

## Open Items / Notes

- Push the prevention fix and verify the resulting GitHub Actions deployment completes.
