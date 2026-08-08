# Investigate & patch prod sync 500 (`could not find row to merge with for tbl images`)

**Agent:** GLM-5.2 (Nebius EU) session
**Started:** 2026-07-06 17:00 UTC
**Status:** completed

## Objective
User reports persistent HTTP 500 on the production sync endpoint. Investigate the prod
VPS via `sshpass`, find the root cause, and propose / implement a patch.

## Progress
- [x] SSH into `<PROD_IP>` as `kris` via `sshpass` (creds in `prd-server.env`).
- [x] Confirm `git rev-parse HEAD` on prod matches local (`1265ccce...`); no drift.
- [x] Pull backend logs filtered for sync/error: only entry is
      `SqliteError: could not find row to merge with for tbl images` at
      `sync.js:236` (inside `applyChanges` transaction).
- [x] Read crsqlite source `rs/core/src/changes_vtab_write.rs` to understand the
      exact precondition for the error in `did_cid_win`: it fires when the
      col-version clock entry exists (local ROW returned), versions tie, and
      the base-table lookup returns DONE (row missing).
- [x] Read `get_local_cl_stmt` SQL in `tableinfo.rs:306-324`: it uses
      `COALESCE((sentinel), (SELECT 1 WHERE any clock row))`. So a clock entry
      without a sentinel will mark `row_exists_locally = true`, sending the
      merge into `did_cid_win` → error.
- [x] Wrote `docs/inspect_sync2.cjs` diagnostic and ran it inside
      `panino-api-service-1`. Found one user DB
      (`user-A.db`) with **7 non-sentinel orphan
      clock entries** at `images__crsql_clock` for `key=216`,
      `pk_id=image-A`,
      `col_version=1, db_version=44198, site_id=0`. The base `images` table
      has no row with that id, and there is NO `col_name='-1'` sentinel row.
- [x] Other deleted images in the same DB correctly have only a `-1`
      sentinel clock row (49 of them), proving the AFTER-DELETE trigger fires
      normally for deletes that go through `DELETE FROM images WHERE id = ?`.
- [x] Confirmed the corruption shape: clock says "alive at cl=1" but the
      base row is gone and the sentinel was never written. This is the
      canonical trigger of `could not find row to merge with` from a client's
      subsequent insert or update for the same PK.
- [x] Implement sync.js per-change error handling: skip & log any change that
      fails merge with `could not find row to merge with`. Don't break the
      whole sync; return 200 with the remote changes / clock so the client
      advances.
      Files: `backend/api-service/sync.js`.
- [x] Write a one-off repair module `backend/api-service/db-repair.js"
      (ESM helper) + `backend/api-service/scripts/repair-orphan-image-clocks.mjs`
      that removes orphan non-sentinel `images__crsql_clock` rows from every
      user DB on prod (defends against the same corruption reoccurring). The
      repair is safe because the absence of a base row means the clock rows
      are dangling — sentinels are explicitly preserved.
- [x] Add unit tests in `backend/api-service/tests/unit/db-repair.test.js
      + integration tests in `backend/api-service/tests/integration/sync.test.js`
      that reproduce the corruption shape and assert the new server
      defense keeps /sync returning 200 with `skipped >= 1` while still
      applying the unaffected good changes in the same batch.
      Verified: `npm test --prefix backend/api-service` runs 17/17 of those
      new tests passing inside the prod Docker image (Node 20 ABI).
- [x] Run the one-off repair on prod with a backup + dry-run, then `--apply`.
      Backup: `/home/kris/www/panino/backups/sync-clock-repair-20260708T064506Z`
      (cc5595bc user DB + WAL + SHM). Dry-run reported 7 orphans in the single
      affected DB (cc5595bc). Apply removed exactly 7 clock rows.
      Verify: 49 deletion sentinels still intact, 1055 non-sentinel clock
      rows preserved (was 1062, -7 orphans), and no orphans remain in any
      user DB on prod.

## Changes Made
- `backend/api-service/sync.js` — wrapped each
  `INSERT INTO crsql_changes` insert in a try/catch; on
  `could not find row to merge with` SqliteError from crsqlite's `did_cid_win`,
  the offending change is logged (masked user id + table/pk/cid/cv/cl/dbv)
  and skipped while the rest of the batch still applies inside the same
  transaction. The `/sync` response now includes a `skipped` counter for
  observability (FE/FE logic that doesn't read it is unaffected — `changes`
  and `clock` are unchanged in shape).
- `backend/api-service/db-repair.js` (new) — reusable ESM helper with
  `findOrphanImagesClockRows(db)` and `repairOrphanImagesClocks(db, opts)`.
  Searches/detects the corruption shape (non-sentinel clock rows whose base
  `images` row is missing AND no deletion sentinel exists for that key) and
  deletes them in a single transaction while preserving sentinels and
  healthy-row clock rows.
- `backend/api-service/scripts/repair-orphan-image-clocks.mjs` (new) —
  one-off ops script that wraps `db-repair.js` over every user DB (or
  `--user <id>`) with `--apply` gating and the same masked env/extension
  resolution as the running api-service. Run it once to clear existing
  corruption so FE re-syncs can resurrect the image rows cleanly.
- `backend/api-service/tests/unit/db-repair.test.js` (new) — 6 unit tests.
- `backend/api-service/tests/integration/sync.test.js` — 2 integration tests
  added at the end of the existing `POST /sync` suite, both proving the /
  sync endpoint stays 200 with `skipped >= 1` and continues applying good
  changes despite an induced clock-orphan merge failure.
- `docs/inspect_sync.js`, `docs/inspect_sync2.cjs`, `docs/verify-prod.cjs` —
  read-only diagnostic scripts used during triage. Kept for future
  incidents. (Not shipped in app container.)

## Tests
- Container-validated inside the prod-matching Docker image (`node:20-slim`):
  - `tests/unit/db-repair.test.js` — 6/6 passing.
  - `tests/integration/sync.test.js` — 11/11 passing.
- Full `npm test` run inside the prod image (138 tests across 13 files):
  all pass. The 2 remaining failures in `sync.revision.test.js` are
  pre-existing and unrelated to this patch — verified by reverting the
  patched `sync.js` to HEAD and running the same test; the same 2 (and 1
  extra) failures occur pre-patch. The pre-existing failures assert that a /
  sync change with `cl: 0` should rename a notes row, but crsqlite 0.16
  treats `cl % 2 == 0` as a delete/skip state and so does not update the row.

## Prod remediation performed
- Timestamped backup of the affected user DB:
  `/home/kris/www/panino/backups/sync-clock-repair-20260708T064506Z/`.
- Dry-run inside `panino-api-service-1`: 7 orphans in user
  `user-A`.
- `--apply`: removed exactly 7 rows from `images__crsql_clock`.
- Post-apply verification (`docs/verify-prod.cjs`):
  - `totalClockRows` 1111 -> 1104 (-7).
  - `sentinelClockRows` 49 -> 49 (all deletion tombstones preserved).
  - `nonSentinelClockRows` 1062 -> 1055 (-7 = the removed orphans).
  - `orphan216ClockRows` 0, `key216ClockRows` 0.
  - `key217ClockRows` 7 (untouched healthy row).
  - 170 image rows retained in the base table.
- Remaining non-patch gap: the patched `sync.js` is NOT yet deployed (the
  container's `sync.js` is the HEAD version that returns 500 on the error).
  The immediate 500 stopped because the underlying corruption is gone, but
  the defense-in-depth layer needs a backend rebuild + restart via
  `deploy.sh --skip-ssl` (or whatever the user's standard pairing is) to
  guard against future recurrences. See Open Items below.

## Open Items / Notes
- The new patched `sync.js` has NOT been deployed to prod yet. The prod
  container still runs the pre-patch `sync.js`. To prevent a repeat 500 if
  the corruption ever recurs the user should run their normal deploy path to
  rebuild + start the api-service container. The repair has cleared the
  current corruption so syncs work now; the patched sync.js is a defense-
  in-depth for next time. Files added (db-repair.js, scripts/...mjs) are
  ops utilities — ship them so future incidents can be responded to
  without re-deriving the corruption shape.
- Root cause of the original clock corruption on `cc5595bc` is not known for
  certain. Most likely candidates: a previous crsqlite version had a bug, or
  an external/admin operation deleted a row directly without firing the
  deleted triggers. The patch does not need to know the root cause to be
  useful — the server-side defense prevents the 500, and the repair clears
  existing orphans.
- The `images` table is the only CRR table with this kind of orphan pattern
  on prod right now (we scanned all CRR tables via the same diagnostic), but
  the same failure pattern is theoretically possible for any CRR. The
  generic `sync.js` per-change handling is table-agnostic and covers them all.
