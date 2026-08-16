# DX-10 — Node Runtime Upgrade (20 → 24)

> Move production and tooling off end-of-life Node 20 by upgrading the one package that
> pins it, in two independently reversible steps.
> Status: partially done — not shipped. The dev-side implementation and browser verification
> are complete (see `docs/agent-logs/2026/08/2026-08-08_11-30_dx-10-node-runtime-upgrade.md`
> and `docs/agent-logs/2026/08/2026-08-16_06-50_dx-10-browser-verification.md`). Two things
> remain: §6 Phase 2 step 8, the production merge-behaviour verification — started and
> deliberately aborted by the maintainer on 2026-08-16 rather than pull a live user database
> — and the production deploy itself. Do not mark this shipped until both are done.
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P0 — the production runtime has been unsupported since 2026-04-30
> Depends on: [DX-01](../shipped/dx-01-backend-test-runnability.md) (needs `npm run test:be` to be the verification surface), [DX-02](../shipped/dx-02-ci-test-gate.md) (soft — CI should be green before and after)
> Blocks: nothing. Supersedes [DX-01](../shipped/dx-01-backend-test-runnability.md) §5.2's "revisit later" note and adjusts [DX-09](dx-09-backend-type-checking.md) §5's `@types/node` pin

---

## 1) Summary

Every Node pin in this repo — four Dockerfiles, `.nvmrc`, `engines`, CI — traces to a
single package: `better-sqlite3@9.6.0`, whose prebuilt binaries predate Node 24. DX-01
correctly declined to change it while treating Node 20 as the stable production target.

Node 20 reached end of life on **2026-04-30**. As of this spec it has been unsupported for
100 days, so "matching production" now means matching an unpatched runtime. The reason to
keep the pin has become the reason to remove it.

The upgrade is smaller than it looks. `better-sqlite3@12.11.1` declares
`"node": "20.x || 22.x || 23.x || 24.x || 25.x || 26.x"` — one version spans the current and
target runtimes. That lets the dependency bump and the base-image bump ship as two separate
commits, each verifiable and revertible on its own, with no flag day.

---

## 2) Problem & Evidence

### 2.1 Node 20 is end-of-life

From the official release schedule (`nodejs/Release/schedule.json`):

| Line | Maintenance start | **End of life** | Status on 2026-08-08 |
|---|---|---|---|
| v20 "Iron" | 2024-10-22 | **2026-04-30** | **unsupported — no security patches** |
| v22 "Jod" | 2025-10-21 | 2027-04-30 | maintenance |
| v24 "Krypton" | 2026-10-20 | 2028-04-30 | **Active LTS** |
| v26 | 2027-10-20 | 2029-04-30 | current; becomes LTS 2026-10-28 |

`backend/api-service/Dockerfile:2` runs `node:20-bookworm-slim` in production. This is the
service that terminates authenticated traffic, holds every user's SQLite database, and runs
Puppeteer against user-supplied HTML.

### 2.2 The pin is one package, not the sync stack

AGENTS.md §3 says backend tests run in Docker "because native SQLite bindings must match
production," which reads as though CR-SQLite is part of the constraint. It is not.

| Component | Binding type | Node-ABI coupled? |
|---|---|---|
| `better-sqlite3@9.6.0` | Node native addon (N-API/NAN) | **Yes** — this is the entire constraint |
| `@vlcn.io/crsqlite@0.16.3` | SQLite loadable extension, `db.loadExtension()` at `db.js:541` and `db.js:755` | **No** — coupled to the SQLite C ABI, not Node's |

CR-SQLite is compiled from source in both images (`npm rebuild @vlcn.io/crsqlite
--build-from-source`) and loaded as a shared object. Changing the Node major does not touch
it. Changing `better-sqlite3` does — see §2.4.

### 2.3 The repo is half-migrated and satisfies neither target

`backend/api-service/patch-crsqlite.sh` exists solely to rewrite CR-SQLite's
`assert { type: "json" }` import attributes to `with { type: "json" }` — a **Node 24**
compatibility fix, and its header comment says so. Someone intended this move; the
`better-sqlite3` half was never done. DX-01 §2.1 already flagged this tension and deferred it.

Note the consequence for sequencing: on Node 20 that patch is cosmetic, because the old
`assert` syntax still parses. On Node 22+ it is a hard syntax error. The script becomes
load-bearing at Phase 3 and must be verified to actually run in both images at that point.

### 2.4 The real risk is SQLite, not Node

Upgrading `better-sqlite3` moves the bundled SQLite amalgamation underneath an extension
whose upstream is dead:

| `better-sqlite3` | Bundled SQLite |
|---|---|
| 9.6.0 (current) | **3.45.3** |
| 11.10.0 | 3.49.2 |
| 12.11.1 (proposed) | **3.53.2** |

`@vlcn.io/crsqlite` last published **0.16.3 on 2024-01-17** — the SQLite 3.45 era — and the
project is unmaintained. There will be no upstream fix if it misbehaves against 3.53.2.

This is the one part of the change that deserves real caution, because it lands on
`crsql_changes` semantics — the exact surface behind both 2026 production incidents
(`docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md`). A green unit
suite is not sufficient evidence here; §6 Phase 2 specifies what is.

### 2.5 Everything else is already version-agnostic

- `.github/workflows/test.yml:17,29` uses `node-version-file: ".nvmrc"`, so CI follows the
  pin automatically — no workflow edit needed for the runtime itself.
- `backend/font-service` has no native dependencies (`cors`, `express`, `multer`,
  `node-fetch`); its image moves for free.
- `frontend/` has no native dependencies; Vite and Vitest run on any current LTS.

The blast radius is one npm package and a list of string literals.

---

## 3) Goals

1. Production runs a Node version that receives security patches.
2. `better-sqlite3` is on a release line with prebuilds for current LTS runtimes.
3. CR-SQLite merge behaviour is proven unchanged against the newer SQLite, with evidence
   stronger than "the unit suite is green."
4. Host-native `npm run test:be:host` works on a current LTS host, ending the ABI mismatch
   that DX-01 §2.1 documents across four agent logs.
5. Docker remains the canonical backend test runner. Matching production is still the rule;
   both sides simply move together.

## 4) Non-Goals

- Not replacing `@vlcn.io/crsqlite`. Its abandonment is a real risk, but it is a separate
  and much larger spec. This change only proves the current version still works.
- Not upgrading to `better-sqlite3@13`. It requires `>=22`, which would force the dependency
  and runtime bumps into one commit and destroy the rollback story.
- Not targeting Node 26. It becomes LTS on 2026-10-28; `better-sqlite3@12.11.1` already
  covers `26.x`, so that hop is cheap once it ships. Do it then, not now.
- Not changing test framework, test structure, or sync logic.

---

## 5) Proposed Change

### 5.1 Two steps, two commits, two rollbacks

```
Phase 2:  node:20  +  better-sqlite3@12   ← dependency risk isolated (SQLite 3.45 → 3.53)
Phase 3:  node:24  +  better-sqlite3@12   ← runtime risk isolated (ABI, Puppeteer, base OS)
```

Because `12.11.1` supports both `20.x` and `24.x`, Phase 2 ships and bakes on the current
production runtime. If sync breaks, exactly one variable changed. Phase 3 then changes only
the runtime, against a dependency already proven in production.

Doing both at once is the failure mode to avoid: a sync regression would leave you unable to
tell whether SQLite 3.53 or Node 24 caused it, on the code path with the worst blast radius
in the repo.

### 5.2 Target `better-sqlite3@^12.11.1`, target `node:24-bookworm-slim`

Node 24 is Active LTS with support until 2028-04-30. `bookworm-slim` keeps the base
distribution identical to today, so the Puppeteer shared-library list in both Dockerfiles
stays valid.

### 5.3 Bisect anchor if CR-SQLite breaks

If `0.16.3` misbehaves against SQLite 3.53.2, `better-sqlite3@11.10.0` bundles **3.49.2**
and still carries Node 20/22/23 prebuilds. It is a usable intermediate that gets off the
worst of the ABI problem while narrowing which SQLite release introduced the break. Record
the finding either way — it is the first hard data point on how much headroom the abandoned
extension actually has.

---

## 6) Implementation Steps

### Phase 1 — Resolve the dual lockfile first

`backend/api-service/` tracks **both** `package-lock.json` and `pnpm-lock.yaml` in git. Both
currently pin `better-sqlite3@9.6.0`, so they agree today; a native-dep upgrade applied to
one and not the other produces a drift that only surfaces at image build time.

1. Confirm npm is the intended package manager: both Dockerfiles branch on
   `if [ -f package-lock.json ]; then npm ci; ...`, and `docs/agent-logs/2026/02/2026-02-15_21-27_add-account-db-size.md`
   records the pnpm path as a source of native-build failures.
2. `git rm backend/api-service/pnpm-lock.yaml` and drop the now-orphaned
   `pnpm-workspace.yaml` `onlyBuiltDependencies` block if nothing else needs it.
3. Land as its own commit, before any version change.

### Phase 2 — Upgrade `better-sqlite3` on Node 20

4. In `backend/api-service/package.json`, set `"better-sqlite3": "^12.11.1"`. Leave
   `engines` at `>=20 <21` for now — this phase does not change the runtime.
5. `npm install` inside the Node 20 image, not on the host, so `package-lock.json` is
   regenerated against the runtime that will consume it.
6. Confirm CR-SQLite still compiles and loads against the new amalgamation:

   ```bash
   docker build -f backend/api-service/Dockerfile.test -t panino-api-test backend/api-service
   docker run --rm panino-api-test node -e "
     const Database = require('better-sqlite3');
     const db = new Database(':memory:');
     db.loadExtension(process.env.CRSQLITE_EXT_PATH);
     console.log('sqlite', db.prepare('select sqlite_version() v').get().v);
     console.log('crsqlite', db.prepare('select crsql_db_version() v').get().v);
   "
   ```

   A clean `loadExtension` is necessary but not sufficient — extension-API mismatches in
   SQLite typically surface at statement-prepare time, not load time.

7. `npm run test:be` must pass in full. Note that DX-01 §7 flags
   `tests/integration/sync.revision.test.js` as possibly known-red; establish its status
   **before** this change so the comparison means something.

8. **Merge-behaviour verification — the real gate.** Unit tests do not exercise the
   `crsql_changes` paths that failed in June and July. Against a copy of production data
   (never the live volume), on the new build:

   - Restore a snapshot of at least one real user database into a scratch container.
   - Run a full `/sync` round trip: pull changes, apply a local edit, push, and confirm the
     server-side merge lands with no `could not find row to merge with` error.
   - Exercise a note delete and an image-clock write — both are documented tombstone/FK
     failure surfaces (`docs/architecture/crsqlite-sync.md`).
   - Compare `crsql_db_version()` and the clock-table row counts before and after; they must
     move consistently with the same operations on a 9.6.0 build.

   Record the transcript in the agent log. This is the evidence that justifies the change.

9. Deploy Phase 2 alone and let it run for a few days before starting Phase 3.

### Phase 3 — Move the base images to Node 24

10. Update the runtime pins:

    | File | Change |
    |---|---|
    | `backend/api-service/Dockerfile:2` | `node:20-bookworm-slim` → `node:24-bookworm-slim` |
    | `backend/api-service/Dockerfile.test:1` | `node:20-bookworm-slim` → `node:24-bookworm-slim` |
    | `frontend/Dockerfile.dev:1` | `node:20-alpine` → `node:24-alpine` |
    | `backend/font-service/Dockerfile:1` | `node:20-alpine` → `node:24-alpine` |
    | `.nvmrc` | `20` → `24` (CI follows automatically via `node-version-file`) |
    | `backend/api-service/package.json:8` | `">=20 <21"` → `">=24 <25"` |
    | `poc/package.json:8` | `">=20"` → `">=24"` |

11. Verify `patch-crsqlite.sh` actually executes in both images. Per §2.3 it is now
    load-bearing: if the `postinstall` hook is skipped or the `sed` silently no-ops, the
    build fails with an import-attribute syntax error rather than a clear message. Add a
    non-zero exit when the helper file is present but the substitution matched nothing.

12. Bump Puppeteer. `^22.12.1` predates Node 24; current is `25.5.0`. Treat this as a real
    sub-task, not a version-number edit — check the PDF pipeline against
    `docs/architecture/pdf-pipeline.md`, and confirm the Chrome shared-library list in both
    Dockerfiles still covers the bundled Chrome build. Keep the SSRF and sanitisation checks
    intact (AGENTS.md §4).

13. Run the full stack: `docker compose -f docker-compose.dev.yml up --build`, then
    `npm run doctor`, `npm test`, and a browser pass over editor → preview → PDF export.

14. Confirm `npm run test:be:host` now works on a Node 24 host — this is Goal 4, and the
    clearest signal the original blocker is gone.

### Phase 4 — Update the documentation that names the version

15. Replace the Node 20 references. This inventory is complete as of 2026-08-08:

    `AGENTS.md:48,66,67` · `README.md:180,184,188` · `backend/api-service/AGENTS.md:122,123` ·
    `.github/copilot-instructions.md:17` · `.github/skills/feature-development/SKILL.md:228` ·
    `.github/workflows/test.yml:41` (comment only) · `scripts/test-backend.sh:2` ·
    `scripts/doctor.sh:8` (the `expected: v20.x` string)

16. While editing `AGENTS.md` §3, fix the inaccuracy in §2.2 above. Suggested wording:

    ```markdown
    Backend tests run in the Node 24 Docker image because `better-sqlite3` is a native
    addon and must match the production ABI. CR-SQLite is a SQLite loadable extension
    compiled from source in the image, so it is not Node-ABI bound — but it is pinned to
    an unmaintained 0.16.3 release, so treat any SQLite version change as a sync risk.
    ```

17. Update the two DX specs this supersedes:
    - `dx-01-backend-test-runnability.md` §5.2 — mark the rejected alternative as revisited
      by DX-10, with the EOL date as the reason the trade-off flipped.
    - `dx-09-backend-type-checking.md` §5 — `@types/node@^20` becomes `^24`. If DX-09 has
      not shipped yet, just amend the pin in place.

18. Add a dated note to `docs/architecture/crsqlite-sync.md` recording the SQLite version
    CR-SQLite 0.16.3 is now running against, and the Phase 2 §8 verification result. The
    next person to touch this needs to know the extension is running eight SQLite minors
    ahead of its last release.

---

## 7) Validation Checklist

- [ ] Only one lockfile is tracked in `backend/api-service/`.
- [ ] `better-sqlite3` is `^12.11.1`; `package-lock.json` regenerated inside the image.
- [ ] `loadExtension` + `crsql_db_version()` probe succeeds on the new build (§6.4 step 6).
- [ ] Known-red test status recorded **before** the dependency bump, for comparison.
- [ ] `npm run test:be` passes with no new failures relative to that baseline.
- [ ] Full `/sync` round trip against restored production-shape data succeeds: pull, local
      edit, push, merge, note delete, image-clock write — transcript in the agent log.
- [ ] Phase 2 deployed and observed in production before Phase 3 starts.
- [ ] All seven runtime pins in §6.10 updated; `docker compose ... up --build` is clean.
- [ ] `patch-crsqlite.sh` verified to run, and now fails loudly on a no-op substitution.
- [ ] Puppeteer upgraded; PDF export verified in a browser, SSRF checks intact.
- [ ] `npm run test:be:host` passes on the Node 24 host.
- [ ] `npm run doctor` reports `v24.x` as expected and finds no broken bindings.
- [ ] Every documentation reference in §6.15 updated; no stale "Node 20" outside
      `docs/agent-logs/`, which is historical and must not be rewritten.
- [ ] DX-01 §5.2 and DX-09 `@types/node` amended.
- [ ] `docs/architecture/crsqlite-sync.md` records the new SQLite version and the evidence.

---

## 8) Risks & Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| CR-SQLite 0.16.3 misbehaves against SQLite 3.53.2 | **Medium — the main risk** | Phase 2 isolates it to one variable on the current runtime; §5.3 gives `11.10.0`/SQLite 3.49.2 as a bisect anchor; revert is a single dependency pin |
| A merge regression reaches production and corrupts clock tables | Low, high severity | §6.8 gate on restored real data before deploy; `docs/runbooks/sync-incident-response.md` and the `db-repair.js` tooling are the recovery path; take a timestamped volume backup before the Phase 2 deploy |
| Puppeteer 22 → 25 breaks PDF rendering | Medium, low severity | Separate commit within Phase 3; PDF export is not on the sync path and fails visibly rather than silently |
| `patch-crsqlite.sh` silently no-ops and the Node 24 build fails obscurely | Medium, low severity | §6.11 makes it exit non-zero when the substitution matches nothing |
| Node 24 changes Express/`ws` behaviour under load | Low | Both are current majors with Node 24 support; the dev-stack pass in §6.13 covers the WebSocket handshake |
| Alpine base bump breaks the frontend dev image | Low | Dev-only; does not touch production, which serves static files through Nginx |

**Rollback.** Phase 3 reverts by restoring the seven version strings — the Phase 2
dependency continues to support Node 20, so this is a clean revert with no dependency
churn. Phase 2 reverts by restoring `better-sqlite3@9.6.0` and the lockfile. Neither phase
performs a schema migration, so there is no data-shape rollback to manage.

---

## 9) Handover Notes

Phases 1, 3, and 4 are mechanical — roughly a day with the dev stack running. **Phase 2 step
8 is the spec.** Everything else is version strings; that step is the only part that
produces new information, and skipping it converts this from a managed upgrade into an
untested change to the sync path.

Do not compress the phases into one commit to save a deploy cycle. The two-step structure is
the entire reason this is safe to do, and it is only available because `better-sqlite3@12`
happens to span both runtimes.

If Phase 2 step 8 reveals a genuine CR-SQLite incompatibility, **stop and write it up rather
than working around it**. That result would mean the sync stack is pinned to an abandoned
extension with a hard SQLite ceiling — a much more important finding than this upgrade, and
the trigger for a spec on replacing or vendoring CR-SQLite.

Per AGENTS.md §4, production deployment and any write to production volumes require explicit
approval in the working conversation and a timestamped backup first.
