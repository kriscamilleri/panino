# Repair the `images` CRR after a bare ALTER

- Agent: Claude Code (Opus 5)
- Start: 2026-08-16 16:15
- Branch: `fix/images-crr-alter` (off `main`)
- Status: complete, awaiting review

## Objective

`ensureImagesSchema` adds `size_bytes` and `sha256` to `images` with a bare `ALTER TABLE`
followed by `crsql_as_crr`. `images` is already a CRR, so that leaves CR-SQLite's generated
triggers bound to the old column count and every subsequent write to the table fails. Fix the
migration on both layers and repair databases already in that state.

## Background

Found while implementing the Recent Documents redesign, which added a `pinned` column to
`notes` and copied this same pattern. The first pin write failed with:

```text
SQLiteError: expected 17 values, got 15
```

`notes` was fixed on that branch (PR #7). This branch applies the same fix to `images`, which
has had the defect since `size_bytes` / `sha256` were introduced.

## Who is affected

Only databases that existed **before** those columns were added — a fresh database gets them
from `BASE_SCHEMA` / `DB_SCHEMA` before the table is registered as a CRR, so its triggers are
correct. An older per-user database has had stale `images` triggers ever since it was
migrated, so any `UPDATE`/`INSERT` on `images` through the CRR triggers raises
`expected N values, got M`.

## Progress

Confirmed the mechanism with a direct probe against the pinned CR-SQLite 0.16.3 extension in
the api-service image:

| Path | Result |
|---|---|
| `ALTER` + `crsql_as_crr` | `as_crr` reports ok; next `UPDATE` fails `expected 9 values, got 7` |
| `crsql_begin_alter` + `ALTER` + `crsql_commit_alter` | `UPDATE` succeeds; the new column appears in `crsql_changes` |

Both `ensureImagesSchema` implementations now:

1. read `images__crsql_utrig` from `sqlite_master` to decide whether the table is a CRR on
   this connection — `crsql_begin_alter` must not be called on a non-CRR or on a handle
   without the extension;
2. wrap the `ALTER`s in `crsql_begin_alter` / `crsql_commit_alter` when it is;
3. self-heal an already-broken database: columns present but the update trigger does not
   mention them means the old migration ran, so an empty `begin_alter` / `commit_alter` pair
   regenerates the triggers.

Step 3 is what fixes existing installations; step 2 only prevents new ones.

## Changes Made

| File | Change |
|---|---|
| `backend/api-service/db.js` | CRR-safe `ensureImagesSchema` + shared `crrUpdateTriggerSql` helper; exported for tests |
| `frontend/src/store/syncStore.js` | Same migration and self-heal on the browser replica |
| `backend/api-service/tests/unit/db.test.js` | 5 new cases |
| `docs/architecture/crsqlite-sync.md` | New § Altering a CRR table |

## Tests

| Suite | Result |
|---|---|
| `npm run test:be` | 175 passed, 15 files (`tests/unit/db.test.js` 20 → 25) |
| `npm run test:fe` | 254 passed |
| `npm run lint` | 0 errors, 41 warnings, all pre-existing `no-console` |

New backend cases:

- a fresh user database has both columns and accepts writes;
- a legacy CRR `images` table migrates, accepts writes, and emits a `size_bytes` row in
  `crsql_changes`;
- **a half-migrated database is repaired** — the test first asserts the broken state really
  does throw `/expected \d+ values/`, so the repair assertion cannot pass vacuously;
- the migration is idempotent across three runs;
- it is a no-op when `images` does not exist.

Not covered by automated tests: the frontend `syncStore` path, because the CR-SQLite WASM
build does not run under the node test environment. It mirrors the backend logic line for
line, and the equivalent `notes` change was verified in the browser on PR #7.

## Open Items / Notes

- **Expected merge conflict with PR #7.** That branch adds a § Altering a CRR table to
  `docs/architecture/crsqlite-sync.md` whose closing note says the `images` migration still
  has the old pattern. This branch adds the same section without that caveat, because the
  caveat is no longer true once this lands. Whichever merges second should keep this branch's
  wording. `backend/api-service/db.js` will also conflict lightly — both add a
  trigger-inspection helper near the top; keep one.
- No production database was inspected or touched. If an affected database exists in
  production, the repair runs automatically the next time `getUserDb` opens it.
