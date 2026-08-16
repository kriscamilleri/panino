# DX-10 step 8 — merge-behaviour verification

Tooling for [`docs/specs/dx/dx-10-node-runtime-upgrade.md`](../../docs/specs/dx/dx-10-node-runtime-upgrade.md)
§6 Phase 2 step 8, the spec's "real gate" before the `better-sqlite3` upgrade ships.

## What it is for

DX-10 §2.4 identifies the one genuinely risky part of the upgrade: `better-sqlite3` bundles
the SQLite amalgamation, so moving 9.6.0 → 12.11.1 moves SQLite **3.45.3 → 3.53.2**
underneath `@vlcn.io/crsqlite@0.16.3` — a release from the 3.45 era whose upstream is dead.
The failure surface is `crsql_changes` merge semantics, which is exactly where both 2026
production incidents happened.

The spec says a green unit suite is not sufficient evidence. It asks to compare
`crsql_db_version()` and clock-table row counts across the same operations **on a 9.6.0
build**. That comparison needs two arms; a snapshot run on the new stack alone has no
baseline and cannot answer the question.

## Usage

```bash
# Against a synthetic fixture — no production data involved
scripts/dx10-merge-verification/run-two-arm-verification.sh --synthetic

# Against a real database (a copy is used; the input is never modified)
scripts/dx10-merge-verification/run-two-arm-verification.sh --database /path/to/user.db
```

Exit codes: `0` identical, `1` different (investigate before deploying), `3` an arm produced
no usable report, `4` inconclusive because an arm did not complete every step.

To pull a single production database for the `--database` form, discover the names and then
take just one, rather than the whole estate:

```bash
# Metadata only — names, sizes, mtimes. Copies no database content.
scripts/production-database-backup/backup-production-databases.sh --list

scripts/production-database-backup/backup-production-databases.sh \
  --only <user-id> --exclude _users.db --output-dir <scratch-dir>
```

`_users.db` is the auth database. It is not a CRR database, so it contributes nothing to this
verification and should not be copied.

## Why the fixture is generated on the old arm

`make-synthetic-fixture.mjs` runs inside the **9.6.0** image. That is deliberate and it is the
whole point: the risk is CR-SQLite state *written by* SQLite 3.45.3 being read and merged by
3.53.2. A fixture generated on the new stack would never exercise that, and would pass
regardless. The fixture accumulates deletions specifically so `-1` tombstone sentinels exist
in the old format before the new arm reads them.

The generator is seeded, so a given `--seed` always produces a byte-identical fixture.

## What the probe does

`merge-behaviour-probe.mjs` runs seven fixed steps and reports JSON:

| Step | What it covers |
|---|---|
| `pull-changes-since-0` | The read every client sync starts with |
| `merge-insert-note` | Incoming `crsql_changes` insert from a remote site |
| `merge-update-note` | Incoming update — where "could not find row to merge with" surfaces |
| `local-edit` | A local write advancing `crsql_db_version()` |
| `image-insert` | Image clock rows — the table that broke in July |
| `note-delete` | Tombstone: expects 1 sentinel, 0 non-sentinel |
| `image-delete` | Tombstone on the incident table |

Every id, timestamp and site id is fixed, so any difference between arms is attributable to
the stack rather than to the probe. `sqliteVersion` and `betterSqlite3Version` are excluded
from the comparison; everything else must match.

Primary keys are packed with `crsql_pack_columns` before insertion, the way `sync.js` does —
the `pk` column is CR-SQLite's packed binary format, and a quoted SQL string aborts the
statement. Clock lookups join through `<table>__crsql_pks`, because clock rows key on an
integer, not on the business id. That indirection is the `key 216` in the July incident notes.

## Reading the result

A clean comparison is only reported as a pass when **both arms completed all seven steps with
no recorded error**. Two arms that fail identically also produce identical reports, and
reporting that as "unchanged" would be exactly backwards — that case exits `4`, not `0`.

## Results on record

### Production data — 2026-08-16 (the run step 8 actually asks for)

One real user database, pulled with `--only` and `_users.db` excluded, 11 MB,
`crsql_db_version` **47875**, 3,630 change rows. This is the account that suffered the July
orphan-clock incident and was repaired, which makes it the most informative input available:
its clock tables carry 52 image deletion sentinels written by the old SQLite, plus the
post-repair state.

```
old arm: better-sqlite3 9.6.0   / SQLite 3.45.3
new arm: better-sqlite3 12.11.1 / SQLite 3.53.2
both arms completed all 7 steps with no errors.
IDENTICAL — CR-SQLite merge behaviour is unchanged across the SQLite versions.
```

Both arms: `dbVersion` 47875 → 47881 (delta 6), `changeRows` 3630 → 3633, seven non-sentinel
image clock rows on insert, 1 sentinel / 0 non-sentinel on both deletes, and byte-identical
clock totals across all seven clock tables:

| Clock table | total | sentinels | non-sentinels |
|---|---|---|---|
| `folders__crsql_clock` | 371 | 2 | 369 |
| `globals__crsql_clock` | 7 | 2 | 5 |
| `images__crsql_clock` | 1114 | 52 | 1062 |
| `notes__crsql_clock` | 2033 | 3 | 2030 |
| `settings__crsql_clock` | 3 | 0 | 3 |
| `templates__crsql_clock` | 102 | 6 | 96 |
| `users__crsql_clock` | 3 | 0 | 3 |

The snapshot and both working copies were deleted immediately after the run.

### Synthetic fixture — 2026-08-16

Run against a 400-note synthetic fixture generated on the 9.6.0 arm:

```
old arm: better-sqlite3 9.6.0   / SQLite 3.45.3
new arm: better-sqlite3 12.11.1 / SQLite 3.53.2
both arms completed all 7 steps with no errors.
IDENTICAL — CR-SQLite merge behaviour is unchanged across the SQLite versions.
```

Both arms produced `dbVersionDelta: 6`, seven non-sentinel image clock rows on insert, and
1 sentinel / 0 non-sentinel on both deletes. The seven rows are worth noting: the July
incident found "seven ordinary image clock rows for key 216", so the probe is reproducing the
same clock shape that incident described.

The synthetic run does not close step 8 on its own — synthetic data cannot cover
unknown-unknowns in accumulated user state. It is kept because it is reproducible from a seed
and needs no production access, so it can be re-run by anyone at any time. The production run
above is the one that satisfies the spec.
