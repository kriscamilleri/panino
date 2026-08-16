# Conclude pending specs: promote two to shipped, reconcile DX headers

**Agent:** Claude Code (Opus 5)
**Started:** 2026-08-16 09:20
**Status:** completed (steps 1–2 of the assigned task; steps 3–5 reported to the maintainer, not executed)

## Objective

Two things:

1. Verify the two `docs/specs/active/` specs against the code they claim to describe, and
   promote them to `shipped/` if the claim holds.
2. Reconcile every DX spec header with actual repo state. All ten still said
   `Status: proposed`, including the ones implemented on 2026-08-08 — which is exactly the
   drift [DX-07](../../../specs/shipped/dx-07-spec-lifecycle.md) exists to prevent. DX-07 was never
   itself implemented as a spec, so this pass does its job by hand.

Three further items (GitHub branch protection, the diverged production checkout, and
DX-10 §6 Phase 2 step 8) were scoped as report-only. The first two were then decided by the
maintainer mid-session and are recorded below; step 8 remains open pending a decision on
approach.

A second round followed the maintainer's decisions: conclude the DX set by moving the
completed specs into `shipped/`, declining DX-09, and fixing the CI breakage that would
otherwise block the promotion those conclusions imply.

## Progress

- [x] Verify `document-templates-extensions.md` §11 test matrix against the five files it names.
- [x] Close the two gaps found: a latent defect in `TemplatePickerModal.vue` and the missing
      §11.3/§11.4 test groups.
- [x] `npm run test:fe` — 250 tests pass.
- [x] Verify `sync-crsqlite-connection-state-recovery.md` against `db.js`, `sync.js`,
      `image.js`, `backup.js`.
- [x] Close the one gap found: no test covered the background-job health guard.
- [x] `npm run test:be` — 154 tests pass.
- [x] `git mv` both specs to `shipped/` with `Shipped:`/`Implementation:` headers.
- [x] Verify DX-01…DX-10 against their own validation checklists and rewrite each `Status:` line.
- [x] Read-only production diagnosis; concluded no repair is needed.
- [x] Record the branch-protection decline (DX-02 §7) and the DX-09 decline.
- [x] Fix the `stream-database-backup` suite and its 13 lint errors; lint is now 0 errors.
- [x] Diagnose and fix the flaky test — it was mine, and the cause was not what it looked like.
- [x] Move DX-01…DX-08 into `shipped/`, rewrite 14 cross-links, verify all 29 spec-tree links.

## What the verification found

### Template extensions — one latent defect

The spec was implemented in full: both columns exist in the frontend `DB_SCHEMA`, the
`ensureTemplatesSchema()` migration, backend `BASE_SCHEMA`, all four `templateStore` CRUD
functions, the editor fields with the specified `data-testid`s, the list columns, and the
picker's title-pattern resolution.

One thing did not work. `TemplatePickerModal.vue` implemented §7.5's deleted-folder fallback
as a synchronous recursive walk of the structure tree:

```js
const children = structureStore.getChildren(item.id);   // returns a Promise
if (search(children)) return true;                      // for…of over a Promise → TypeError
```

`structureStore.getChildren` is `async` ([structureStore.js:77](../../../../frontend/src/store/structureStore.js#L77)).
Any template with a `default_folder_id` set would throw as soon as the walk recursed past a
non-matching root folder — so the feature's headline capability failed for exactly the
templates that used it, unless the target folder happened to sort first at root level. Unit
tests did not catch it because none existed for this component.

Replaced with the DB query §7.5 itself proposes as the simpler alternative:

```sql
SELECT COUNT(*) AS count FROM folders WHERE id = ?
```

CR-SQLite syncs deletions, so the folders table is authoritative and this needs no tree walk.
`resolveTargetFolder` and its two callers became `async`.

### Sync connection-state recovery — implemented, one test gap

Every implementation step was present and matched the spec: `invalidateUserDb()` with the
`expectedDb` guard and idempotent close, `getHealthyUserDb()` reopening on a non-zero sync
bit, `sync.js` failing closed with 503 `SYNC_CONNECTION_RESET` instead of continuing the
batch, `getHealthyUserDb` wired into all four `image.js` mutation paths and `backup.js`'s
image cleanup, the `ON DELETE CASCADE` FK plus its migration, and all four structured events
with masked user IDs.

The gap was in tests. `getHealthyUserDb` — the entire background-job guard, and the direct
control for the failure that caused the original incident — had zero coverage. Added two
tests to `tests/unit/db.test.js`: one asserting a clean connection is passed through
unchanged, one poisoning a connection with `crsql_internal_sync_bit(1)` and asserting the
guard reopens it, returns a different handle, leaves the bit at 0, and evicts the poisoned
handle from the cache rather than merely bypassing it.

### DX specs — one genuinely not started

Verified each against its own validation checklist rather than against the 2026-08-08 audit
log alone.

| Spec | Reality |
|---|---|
| DX-01 | done; `engines` pin superseded by DX-10 (`>=24 <25`) |
| DX-02 | done — §7's branch-protection rule declined by the maintainer 2026-08-16 |
| DX-03 | done |
| DX-04 | done |
| DX-05 | done |
| DX-06 | done |
| DX-07 | done (concluded by this pass) |
| DX-08 | done; the decision lives in `AGENTS.md` §4, not §7 — the checklist's number predates the DX-03 rewrite |
| DX-09 | **not started** — no `tsconfig.json`, no `typecheck` script, no CI step |
| DX-10 | partially done; left as instructed, not shipped |

### A stale local ref, and what it cost

The first pass of this reconciliation had DX-02 as "partially done, `main` doesn't carry the
workflows, `develop` is 28 commits ahead" — and had the DX-10 header repeating the
"production checkout blocks promotion" claim. Both were wrong, and wrong the same way: I read
the local `main` ref, which was 19 commits behind `origin/main` and had not been fetched.

After `git fetch`, `origin/main` is at `51ffcf1` and does carry `test.yml` and `deploy.yml`.
The run history settles §8 better than inspection could:

```
2026-08-08T07:06  Deploy to VPS [main]  failure   ← diverged checkout, pre-flight caught it
2026-08-08T08:09  Tests        [main]  success
2026-08-08T08:09  Deploy to VPS [main]  success   ← after the server was repaired
```

That is the gate working end to end, including the failure mode DX-02 §8 asks to observe.
§7's branch-protection rule was put to the maintainer and **declined** — not needed at this
stage, the checks stay advisory by choice — so DX-02 is complete as scoped.

The general lesson, worth more than the specific correction: **a local branch ref is not
evidence about a remote branch.** `git log main` on a branch you have not checked out in
weeks reports history, not state. Fetch first, then read `origin/<branch>`.

## Changes Made

| File | Change |
|---|---|
| `frontend/src/components/TemplatePickerModal.vue` | Replaced the synchronous tree walk in `folderExists` with a parameterized `COUNT(*)` against `folders`; `resolveTargetFolder` and both callers are now `async` |
| `frontend/tests/unit/templatePickerModal.test.js` | New — spec §11.3, 13 tests |
| `frontend/tests/unit/templateManagerPage.test.js` | New — spec §11.4, 17 tests |
| `backend/api-service/tests/unit/db.test.js` | Added the two `getHealthyUserDb` background-job-guard tests |
| `docs/specs/active/*` → `docs/specs/shipped/*` | Both specs moved with `Shipped:`/`Implementation:` headers; the sync spec's acceptance criteria are now ticked with the evidence for each |
| `docs/specs/shipped/document-templates.md` | Added the cross-reference to the extension spec that its own §8 asked for |
| `docs/specs/dx/dx-00…dx-10` | `Status:` lines rewritten to state reality and what remains |
| `docs/specs/dx/dx-01…dx-08` → `docs/specs/shipped/` | Moved, `Status: shipped`, `Shipped:`/`Implementation:` added; 14 cross-links rewritten |
| `docs/specs/dx/dx-09-backend-type-checking.md` | `DECIDED 2026-08-16: declined` block |
| `docs/specs/README.md` | Records how DX specs move, and that declined ones stay in `dx/` |
| `scripts/test-backend.sh` | Bind-mounts repo `scripts/` at `/scripts:ro` so the backup test's import resolves |
| `scripts/production-database-backup/stream-database-backup.mjs` | Ordered `better-sqlite3` resolver list including `process.cwd()` |
| `eslint.config.mjs` | Node globals block for `scripts/**`; `no-console` off there |
| `backend/api-service/tests/unit/db.test.js` | Distinct user ids for the two guard tests, killing a fixture race |
| `scripts/production-database-backup/*` | `--only`/`--exclude` database selection, path-separator validation, missing-database error |
| `backend/api-service/tests/unit/stream-database-backup.test.js` | 8 tests for the selector |
| `scripts/dx10-merge-verification/*` | New — two-arm merge-behaviour harness for DX-10 step 8 |
| `docs/specs/dx/dx-10-node-runtime-upgrade.md` | Step 8 annotated with the harness, the first result, and what remains |

`docs/specs/active/` is empty. `docs/specs/dx/` holds only DX-00, DX-09 and DX-10.

## Tests

Final state, all green:

- `npm run test:fe` — 16 files, 250 tests pass (was 220; +30 from the two new files).
- `npm run test:be` — **15 files, 166 tests pass** (was 14 files / 152, with one suite that
  could not even load). Run four consecutive times after the fixture fix; all clean.
- `npm run lint` — **0 errors**, 41 advisory warnings (was 13 errors).
- All 29 markdown files under `docs/specs/` link-check clean, code fences excluded.

The three `test:be` failures seen earlier in the session are all accounted for: the
unloadable `stream-database-backup` suite (fixed), its 13 lint errors (fixed), and the
intermittent `db.test.js` failure (fixed — it was a fixture race in a test added earlier this
same session, see above). Nothing is left known-red, which matters because DX-01's checklist
warns that a known-red suite trains agents to ignore failures.

## Concluding the DX set

The maintainer decided three things this session, all recorded in the specs themselves so the
next agent sees ratified decisions rather than open questions:

- **DX-02 §7 branch protection — declined.** Not needed at this stage. The `lint`/`frontend`/
  `backend` checks still run on every push and PR; they are advisory by choice, not by
  oversight. Revisit if more than one person starts pushing to `main`. DX-02 is therefore
  complete as scoped, not "partially done".
- **DX-09 — declined.** No `checkJs` gate. The spec is kept for its analysis, particularly
  §8's catalogue of 21 real defects a Phase 2 run surfaces. Recorded as a `DECIDED` block
  matching the DX-01 Phase 5 and DX-08 Phase 2 precedent. The block also records the tension
  the decision leaves open rather than arguing it away: §2's rationale — `sync.js` and `db.js`
  sit behind both 2026 incidents with no static checking beyond ESLint — is untouched by
  declining. If a third incident starts there, this is the first thing to revisit.
- **Completed DX specs move into `shipped/`.** DX-01…DX-08 moved, keeping their `dx-NN-`
  prefix so the set stays recognisable. DX-00 (index), DX-09 (declined) and DX-10 (open)
  stay in `dx/`.

The move cost 14 cross-link rewrites, in both directions: moved specs pointing at ones that
stayed (`../dx/…`), and the three that stayed pointing at moved ones (`../shipped/…`). All 29
markdown files in the spec tree were then link-checked, skipping fenced code blocks — DX-03
embeds sample `CLAUDE.md` content whose links are illustrative, not real, and a naive checker
flags them.

`docs/specs/README.md` gained the rule this implies: DX specs follow the same lifecycle and
move to `shipped/` when done, but a *declined* spec stays in `dx/` with its decision
recorded. Declining is a conclusion, not a shipment.

## Fixing the CI breakage (and one flaky test of my own)

The `stream-database-backup` suite from `d1155bd` failed under `scripts/test-backend.sh` and
carried all 13 lint errors. Both had the same root cause: the file had only ever been
exercised host-native.

- **Test resolution.** The image's build context is `backend/api-service`, so repo-root
  `scripts/` is not baked in. The test imports the producer at `../../../../scripts/…`, which
  is correct from the host but escaped the mount in the container. Rather than widen the build
  context — DX-01 Phase 1 narrowed it deliberately — the runner now bind-mounts `scripts/` at
  `/scripts:ro`, which is exactly where that relative path resolves from `/app/tests/unit`.
  The import now means the same thing in both environments.
- **Module resolution.** The producer then could not find `better-sqlite3`: it tried its own
  directory, then a repo-relative backend path that does not exist in the container. Replaced
  the two-branch fallback with an ordered list of resolvers that also tries `process.cwd()` —
  which is how it actually runs in production, piped into `node` inside the api-service
  container where the dependency sits at the working directory.
- **Lint.** `scripts/**` had no ESLint block, so it fell through to the base config with no
  globals and `process`, `Buffer`, `URL` and `console` all read as undefined. Added a Node
  block for it with `no-console` off — console is an ops script's user interface, not debug
  output. Lint is now **0 errors**, down from 13.

### The flake was mine, and the obvious explanation was wrong

The earlier "one unidentified flake in four runs" turned out to be the `getHealthyUserDb`
test added earlier in this same session. Reproduced it by looping the full suite, and the
stack said:

```
SqliteError: Safety level may not be changed inside a transaction
 ❯ Module.getUserDb db.js:562        db.pragma("synchronous = normal")
 ❯ tests/unit/db.test.js:232
```

The tempting read is that `crsql_internal_sync_bit(1)` leaves a transaction open. It does
not — probed directly: after setting the bit, `inTransaction` is `false`, `COMMIT` reports
"no transaction is active", and the bit stays raised. The real tell was line 232: the *first*
line of the test, before any poisoning.

The cause is a race in the fixture, not in the guard. `afterEach` deletes the `.db`/`-wal`/
`-shm` files, and my two tests both reused `testUserId1`, so the second reopened a path
deleted microseconds earlier. Under full-suite parallel load `journal_mode = wal` occasionally
cannot take the lock cleanly, leaves a read transaction open, and the following
`synchronous = normal` pragma throws. Giving each test its own user id removes the race.
Four consecutive full runs are now clean at 158/158.

Worth recording because the fragility is real and lives in `getUserDb`, not in the test:
those two pragmas are unguarded against lock contention on open. No production path opens a
just-deleted database, so it is a test-only exposure today — but it is the kind of thing that
becomes a mystery in an incident.

## DX-10 step 8 — building the gate (no production data touched)

The maintainer asked whether `backup-production-databases.sh` could serve as the snapshot
mechanism for step 8. It can, and it is a better mechanism than the ad-hoc approach aborted on
2026-08-16 — `db.backup()` on a readonly connection, staged in RAM-backed `/dev/shm`, deleted
immediately, streamed over SSH, checksummed. It never writes to production disk, which the
earlier attempt did. Two gaps had to be closed first.

**It took everything.** `listDatabaseFiles` returned all 13 user databases plus `_users.db`,
the auth database. Step 8 needs exactly one user database, and `_users.db` is not even a CRR
database — it is pure exposure with no diagnostic value. Added `--only` / `--exclude`
(`PANINO_BACKUP_INCLUDE` / `PANINO_BACKUP_EXCLUDE`) with the default unchanged: a full backup
still takes everything, because that is what a backup is for. Selector entries are validated
as plain filenames — `../` is rejected rather than normalised — and an `--only` naming a
database that does not exist fails loudly instead of silently producing a smaller archive.

**A snapshot has no baseline.** Step 8's fourth bullet asks to compare `crsql_db_version()`
and clock-table counts "with the same operations on a 9.6.0 build". A single run on the new
stack produces numbers with nothing to compare them against. So the harness runs *two arms* —
better-sqlite3 9.6.0 (SQLite 3.45.3) and 12.11.1 (SQLite 3.53.2), Node held at 20 in both so
the dependency is the only variable, per §5.1 — against copies of the same database, and
diffs the reports.

`scripts/dx10-merge-verification/` holds the probe, the fixture generator, a
version-parameterised Dockerfile, and the runner.

**The fixture is generated on the old arm, deliberately.** The risk in §2.4 is CR-SQLite state
*written by* 3.45.3 being read by 3.53.2. A fixture built on the new stack never exercises
that and would pass regardless. The generator accumulates deletions so `-1` tombstone
sentinels exist in the old format before the new arm reads them.

**Result (400-note synthetic fixture): IDENTICAL.** Both arms completed all seven steps with
no errors, `dbVersionDelta` 6, seven non-sentinel image clock rows on insert, 1 sentinel /
0 non-sentinel on both deletes. The seven is a nice corroboration: the July incident found
"seven ordinary image clock rows for key 216", so the probe reproduces the clock shape that
incident described.

### Three things the harness got wrong first, two of them dangerous

Worth recording, because two were false passes — the failure mode that matters most in a tool
whose entire job is to say "safe" or "not safe".

1. **Empty reports diffed clean and reported IDENTICAL.** The probes were crashing with
   SIGILL (exit 132), the runner discarded stderr, and `diff` of two empty files succeeds. A
   verification harness that reports success when both arms crashed is worse than no harness.
   Now stderr is captured and an unparseable report exits `3` before any comparison happens.
2. **Identical failures diffed clean and reported IDENTICAL.** Handed a non-CR-SQLite
   database, both arms errored the same way and the runner called it a pass. "Both broke
   identically" is not "behaviour is unchanged". The verdict now requires both arms to have
   completed all seven named steps with an empty `errors` array; otherwise it exits `4`
   INCONCLUSIVE with the reason. Verified against an empty database.
3. **The probe's SQL was wrong in two ways**, which is what caused the crash. `crsql_changes`
   takes primary keys in CR-SQLite's *packed binary* format, not a quoted SQL literal — the
   insert aborts otherwise; `sync.js:232-238` packs via `crsql_pack_columns` and the probe now
   does the same. And clock tables key on an integer indexing `<table>__crsql_pks`, not on the
   business id, so counting rows for a given id means joining through that table. That
   indirection is the `key 216` from the July incident notes.

Also verified the diff can actually detect divergence — an unfalsifiable "IDENTICAL" would be
worthless — by comparing two reports known to differ.

### What this does not do

It does not close step 8. The spec asks for the comparison against real production data, and
synthetic data cannot cover unknown-unknowns in accumulated user state. **No production
database was pulled and nothing was run against production for this.** What changed is that a
production run now has a baseline to be compared against instead of being a one-shot
observation, and can take one database instead of the whole estate.

## Production checkout — read-only diagnosis (no writes)

The task carried a standing item to repair a diverged production checkout, gated on approval.
Read-only inspection says **there is nothing left to repair**. Recorded here because the
premise has outlived the problem and the next agent should not go looking for it.

```
BRANCH=main
HEAD=51ffcf1              # identical to origin/main
--- tracked drift ---     # empty
--- untracked ---
?? .env.bak.20260322181722
?? backups/…              # 5 pre-existing backup artifacts
```

`git status --porcelain --untracked-files=no` is empty, so the deploy pre-flight — which
`51ffcf1` itself scoped to tracked drift — passes. The untracked entries are backup
artifacts under paths git does not track, and cannot block a pull. The repair was already
carried out on 2026-08-08; `c64a13b "docs: complete production checkout repair"` on
`origin/main` is the record of it, and the successful deploy 63 minutes later is the proof.

No write, backup, reset, or restart was performed, and none is warranted.

Two things worth flagging from the connection itself, neither acted on:

- Production credentials came from a machine-local gitignored `prd-server.env` (`UN`/`P`/`IP`)
  via `sshpass`. `AGENTS.md` §4 says they live in `.claude/settings.local.json`, which holds
  only the `Bash(sshpass:*)` permission. Key-based auth to the host fails outright
  (`Permission denied (publickey,password)`). The 2026-08-16 06:50 log raised this too; it is
  now the second session to trip on it.
- CI is currently **red on `develop`** — run of 2026-08-16 07:15, "feat: add production
  database streaming backup". That is the same `stream-database-backup` breakage described
  under Tests above, confirming it is not a local-environment artifact.

## Open Items / Notes

- **Browser validation not performed.** `TemplatePickerModal.vue` changed and the dev stack
  is up on :5173, but this session has no browser-automation tool available, so the picker's
  default-folder path was verified by unit test only. The spec's §12 step 8 (Chrome DevTools
  MCP at 1280px and 375px) is unclosed for the fixed code path.
- **Both promoted features are genuinely live.** They are on `origin/main` at `51ffcf1`,
  which is the commit the production server has checked out, deployed successfully on
  2026-08-08. `shipped/` is accurate for both.
- **`develop` is ahead of `origin/main`** by this session's work plus the earlier DX
  commits. Promoting it is what remains to get DX-10 and the streaming backup to production.
  The CI gate will now pass it — before this session it would not have.
- **`getUserDb`'s open-time pragmas are unguarded against lock contention.**
  `journal_mode = wal` followed by `synchronous = normal` can throw if the first cannot take
  the lock cleanly. Only reachable today by reopening a just-deleted database, which no
  production path does. Not fixed — flagged because it would be a confusing failure to meet
  during an incident.
- **DX-10 §6 Phase 2 step 8 is the one substantive thing still open** across the whole spec
  set. Approach undecided as of this log; the maintainer asked whether
  `scripts/production-database-backup/backup-production-databases.sh` can serve as the
  snapshot mechanism. It can, with two caveats — it pulls *all* databases including
  `_users.db`, and a snapshot alone gives no baseline arm for step 8's fourth check ("the
  same operations on a 9.6.0 build"). Nothing was run against production for this.
- Committed `2026-08-16_06-50_dx-10-browser-verification.md`, which had been left untracked.
  DX-04's "zero untracked files under `docs/`" is a recurring condition, not a one-time check;
  the `Stop` hook proposed in DX-08 §7 would catch this class of miss automatically.
