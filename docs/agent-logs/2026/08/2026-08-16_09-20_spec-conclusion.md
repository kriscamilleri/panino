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
   drift [DX-07](../../../specs/dx/dx-07-spec-lifecycle.md) exists to prevent. DX-07 was never
   itself implemented as a spec, so this pass does its job by hand.

Three further items (GitHub branch protection, the diverged production checkout, and
DX-10 §6 Phase 2 step 8) were explicitly scoped as report-only and are not recorded here as
done. They are in the maintainer report, not this log.

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

`docs/specs/active/` is now empty.

## Tests

- `npm run test:fe` — 16 files, 250 tests pass (was 220; +30 from the two new files).
- `npm run test:be` — 154 tests pass (was 152; +2). Run four times; three were clean.
- `npm run lint` — 13 errors, 41 warnings. All 13 errors are pre-existing and confined to
  `scripts/production-database-backup/stream-database-backup.mjs`; none are in files touched
  here.

### Pre-existing breakage found, not fixed

`npm run test:be` reports one failed suite that has nothing to do with this work:

```
FAIL tests/unit/stream-database-backup.test.js
Error: Failed to load url ../../../../scripts/production-database-backup/stream-database-backup.mjs
```

`scripts/test-backend.sh` builds with `backend/api-service` as the Docker context, so the
repo-root `scripts/` directory is not in the image and the test's `../../../../` import
escapes the mount. The same file also carries all 13 lint errors — `URL`, `Buffer`,
`process` and `console` flagged as undefined, i.e. ESLint has no Node globals configured for
it. Both arrive from `d1155bd` and both suggest that file was only ever exercised
host-native, never through the canonical runners.

Left alone: fixing it means changing the Docker build context or relocating the script,
which is a decision about the backup tooling's layout rather than part of this task. But it
means the backend suite and lint are both red on a clean checkout right now, which is
precisely the condition DX-01's checklist warns trains agents to ignore failures.

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
- **`develop` is 10 commits ahead of `origin/main`**, all DX work plus this commit. Promoting
  it is what remains to get DX-10 and the streaming backup to production — and the streaming
  backup's broken test would fail the CI gate on that promotion as things stand.
- One unidentified flake: the second of four `test:be` runs reported `1 failed` without the
  name surviving in captured output; the three other runs were clean. Recorded rather than
  dismissed — if it recurs, it is not new.
- Committed `2026-08-16_06-50_dx-10-browser-verification.md`, which had been left untracked.
  DX-04's "zero untracked files under `docs/`" is a recurring condition, not a one-time check;
  the `Stop` hook proposed in DX-08 §7 would catch this class of miss automatically.
- DX-09 is the only DX spec never started. Its stated rationale — that `sync.js` and `db.js`,
  the two files behind both 2026 production incidents, have no static checking beyond ESLint —
  still holds.
