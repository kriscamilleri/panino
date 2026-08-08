# DX-01 — Make Backend Tests Runnable in One Command

> Remove the Node ABI blocker that prevents agents from verifying changes to sync/db code.
> Status: proposed
> Created: 2026-08-08
> Last updated: 2026-08-08
> Priority: P0 — blocks correctness verification on the most incident-prone code in the repo
> Depends on: nothing
> Blocks: [DX-02](dx-02-ci-test-gate.md)

---

## 1) Summary

Agents working on `sync.js` and `db.js` — the two files responsible for both production
incidents in June/July 2026 — routinely cannot run the backend integration suite. The
native `better-sqlite3` binding is built for Node ABI 115 (Node 20) while the host runs
Node v24.11.1 (ABI 137). Agents hit the failure, record it as "blocked", and ship
unverified changes.

A working Docker test image already exists (`backend/api-service/Dockerfile.test`) but is
undiscoverable and slow to build. This spec makes a verified backend test run a single
command that always works, and fixes the adjacent papercuts that make agents distrust
documented commands.

---

## 2) Problem & Evidence

### 2.1 The ABI blocker (primary)

Host: Node `v24.11.1` (ABI 137). `backend/api-service/node_modules/better-sqlite3` is
version `9.6.0`, whose prebuilds predate Node 24. `backend/api-service/package.json`
declares `"engines": { "node": ">=20" }`, which permits Node 24 and therefore does not
warn.

Recorded as a hard blocker in at least four agent logs:

| Log | Quote |
|---|---|
| `2026-07-11_12-00_review-latest-sync-fix.md:22` | "blocked by the installed `better-sqlite3` binary being built for Node ABI 115 while the runtime is Node ABI 137" |
| `2026-07-11_00-00_sync-connection-recovery.md:30` | "Host Vitest remains blocked by the local `better-sqlite3` Node ABI mismatch (115 vs 137)" |
| `2026-05-04_19-19_audit-develop-commits.md:31` | "`better-sqlite3` binding missing for Node `24.11.1` / ABI `node-v137`" |
| `2026-02-15_21-27_add-account-db-size.md:26` | "blocked by native dependency build approval in pnpm (`better-sqlite3`/`@vlcn.io/crsqlite` bindings missing)" |

Note the tension: `backend/api-service/patch-crsqlite.sh` exists specifically to patch
CR-SQLite for *Node 24* compatibility, so there has been an intent to support Node 24 on
the host — but `better-sqlite3` was never upgraded to match. The repo is in a half-migrated
state that satisfies neither target.

### 2.2 Root `npm test` is broken

`package.json:8` runs `npm test --prefix tests`. There is no `tests/` directory at the repo
root. Actual output:

```
npm error enoent Could not read package.json: ENOENT: no such file or directory,
open '/home/kris/Development/panino/tests/package.json'
```

This is the first command most agents try. Failing it teaches them that documented
commands in this repo are unreliable.

### 2.3 Lint is a phantom requirement

`.github/skills/feature-development/SKILL.md` Phase 6 requires "Lint clean (no ESLint
errors)". There is no ESLint config, dependency, or script anywhere in the repo. The only
file mentioning eslint is the 921 KB vendored `backend/api-service/lib/paged.polyfill.js`.
An unsatisfiable checklist item degrades the credibility of every other item in the list.

### 2.4 Test image build carries 28 MB of user data

`backend/api-service/.dockerignore` contains only `node_modules`, log globs, `.git`, and
`.gitignore`. It does **not** exclude `data/` (28 MB, 118 real user SQLite DBs) or
`uploads/` (2.6 MB of user images). Every `docker build` in that directory — including the
**production** image built by `deploy.sh` — copies live user data into image layers.

This is both a security issue and the reason a Docker test run feels too slow to bother
with.

---

## 3) Goals

1. `npm run test:be` works from a clean checkout on any host Node version, every time.
2. Backend tests execute against the same Node major version as production (Node 20).
3. Root `npm test` runs both workspaces and exits non-zero on failure.
4. An agent can diagnose an environment problem with one command instead of trial and error.
5. Every checklist item in the feature-development skill is actually satisfiable.
6. Docker build contexts contain no user data.

## 4) Non-Goals

- Not migrating the backend runtime to Node 24. Production is `node:20-bookworm-slim` and
  stays there in this spec.
- Not changing test framework, test structure, or adding test coverage.
- Not adding frontend integration/e2e infrastructure (see DX-02 §7 for the follow-up).

---

## 5) Proposed Change

### 5.1 Docker is the canonical backend test runner

`Dockerfile.test` already pins `node:20-bookworm-slim`, installs the native build
toolchain, and runs `npm rebuild @vlcn.io/crsqlite --build-from-source`. It matches
production. Make it the documented default rather than a fallback nobody finds.

### 5.2 Node 20 pinned for host-native runs

Add `.nvmrc` and tighten `engines` so a host that wants to run tests natively gets a clear
signal instead of an ABI error 40 minutes later. This is the *secondary* path — Docker
remains canonical.

**Explicitly rejected alternative:** upgrading `better-sqlite3` to v11/v12 for Node 24
prebuilds. It would work, but it drifts the host away from the Node 20 production runtime
and re-introduces the "works locally, fails in prod" class of bug that DX-05 documents for
CR-SQLite. Revisit only when the production base image moves to Node 24.

### 5.3 A `doctor` script

One command that reports environment readiness, so an agent's first move on any failure is
diagnostic rather than exploratory.

---

## 6) Implementation Steps

### Phase 1 — Stop shipping user data in images

1. Rewrite `backend/api-service/.dockerignore`:

   ```
   node_modules
   npm-debug.log*
   pnpm-debug.log*
   .git
   .gitignore

   # Never ship user data into an image layer
   data/
   uploads/

   # Local artifacts
   *.db
   *.db-wal
   *.db-shm
   coverage/
   ```

2. Verify the production image is unaffected in behaviour: `data/` and `uploads/` are
   supplied at runtime as Docker volumes (`api-data`, `uploads-data` per
   `docker-compose.yml`), so they must not be baked in. Confirm the container still starts
   and `initDb()` creates `data/` on first boot.

3. Add the same `data/`/`uploads/` exclusions to `.llmignore` (see [DX-06](dx-06-repo-hygiene-context.md)).

### Phase 2 — Pin the host runtime

4. Create `.nvmrc` at repo root containing:

   ```
   20
   ```

5. Tighten `backend/api-service/package.json`:

   ```json
   "engines": { "node": ">=20 <21" }
   ```

   Do **not** add `engine-strict`; the goal is a legible warning, not a hard install
   failure for contributors on other versions who only touch the frontend.

### Phase 3 — One-command test runners

6. Create `scripts/test-backend.sh` (executable):

   ```bash
   #!/usr/bin/env bash
   # Canonical backend test runner. Uses the Node 20 image so results match production
   # regardless of host Node version. Pass extra args through to vitest.
   set -euo pipefail
   cd "$(dirname "$0")/.."

   IMAGE=panino-api-test
   docker build -q -f backend/api-service/Dockerfile.test -t "$IMAGE" backend/api-service
   docker run --rm "$IMAGE" npm test -- "$@"
   ```

7. Create `scripts/test-frontend.sh` (executable) — the frontend has no native deps, so it
   runs on the host:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(dirname "$0")/../frontend"
   npm test -- "$@"
   ```

8. Replace the broken root `package.json` scripts:

   ```json
   "scripts": {
     "test": "npm run test:fe && npm run test:be",
     "test:fe": "./scripts/test-frontend.sh",
     "test:be": "./scripts/test-backend.sh",
     "test:be:host": "npm test --prefix backend/api-service",
     "doctor": "./scripts/doctor.sh",
     "llm": "node combine-files.cjs",
     "llmfe": "node combine-files.cjs --path ./frontend/",
     "llmbe": "node combine-files.cjs --path ./backend/"
   }
   ```

   Note `llmtest` is dropped — it pointed at the same nonexistent `./tests/` directory.

### Phase 4 — The doctor script

9. Create `scripts/doctor.sh` (executable). It must be read-only and exit 0 even when it
   finds problems (it is a report, not a gate):

   ```bash
   #!/usr/bin/env bash
   # Reports environment readiness. Read-only; never mutates the repo.
   cd "$(dirname "$0")/.."

   echo "== Runtime =="
   echo "node:   $(node -v)  (expected: v20.x — see .nvmrc)"
   echo "npm:    $(npm -v)"
   echo "docker: $(docker --version 2>/dev/null || echo 'NOT FOUND — required for npm run test:be')"

   echo
   echo "== Native bindings (backend) =="
   node -e "
     try { require('./backend/api-service/node_modules/better-sqlite3'); console.log('better-sqlite3: OK'); }
     catch (e) { console.log('better-sqlite3: BROKEN — ' + e.message.split('\n')[0]);
                 console.log('  -> host-native backend tests will fail; use: npm run test:be'); }
   " 2>/dev/null || echo "better-sqlite3: not installed"

   echo
   echo "== Env files =="
   for f in .env frontend/.env; do
     [ -f "$f" ] && echo "$f: present" || echo "$f: MISSING (see AGENTS.md §4)"
   done

   echo
   echo "== Dev stack =="
   docker compose -f docker-compose.dev.yml ps 2>/dev/null || echo "(dev stack not running)"
   ```

### Phase 5 — Resolve the lint contradiction

10. **Decision required from the maintainer.** Two acceptable outcomes; pick one and make
    the repo consistent:

    - **Option A (recommended) — adopt ESLint.** Add `eslint`, `eslint-plugin-vue`, and a
      flat `eslint.config.js` at root covering `frontend/src` and `backend/api-service`.
      Start with `eslint:recommended` + `plugin:vue/vue3-recommended`, all stylistic rules
      off. Add `"lint": "eslint ."` to root scripts. Fix or `// eslint-disable` the
      existing violations in one dedicated commit so the baseline is clean — a lint script
      that fails on arrival is worse than none.
    - **Option B — delete the requirement.** Remove the "Lint clean" line from
      `.github/skills/feature-development/SKILL.md` Phase 6.

    Option A is recommended: several agent logs note stray `console.log` and unused
    imports, which is exactly what a minimal ruleset catches.

### Phase 6 — Document it

11. Update `AGENTS.md` §4 (Development Environment) with a **Verifying your work** section
    placed before the LLM-context-generation section:

    ```markdown
    ### Verifying your work

    ```bash
    npm run doctor      # check environment before anything else
    npm run test:fe     # frontend tests (host, fast)
    npm run test:be     # backend tests (Docker, Node 20 — matches production)
    npm test            # both
    ```

    Backend tests run in Docker because the native `better-sqlite3` and CR-SQLite bindings
    are built for Node 20. Running them on a Node 22+ host fails with an ABI mismatch;
    this is expected, not a code defect. Use `npm run test:be:host` only if you are on
    Node 20 (`nvm use`).
    ```

12. Mirror that block into `backend/api-service/AGENTS.md` under **Testing → Running
    tests**, replacing the current instructions which lead with the host-native `npm test`
    that does not work.

---

## 7) Validation Checklist

- [ ] `.dockerignore` excludes `data/` and `uploads/`; `docker build` context drops by ~30 MB.
- [ ] Production container still boots and creates `data/` from the mounted volume.
- [ ] `.nvmrc` present; `engines` is `>=20 <21`.
- [ ] `npm run test:be` passes from a clean checkout on the Node 24 host.
- [ ] `npm run test:fe` passes.
- [ ] `npm test` runs both and returns non-zero when either fails (verify by temporarily
      breaking one test).
- [ ] `npm run doctor` reports the ABI mismatch clearly on the Node 24 host and reports OK
      under `nvm use 20`.
- [ ] Lint decision made and the repo is self-consistent (script exists and passes, or the
      checklist line is gone).
- [ ] `AGENTS.md` and `backend/api-service/AGENTS.md` document the verification commands.
- [ ] Known pre-existing failures in `tests/integration/sync.revision.test.js` are either
      fixed or explicitly marked `.skip` with a comment linking to
      `docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md`. A suite that is
      known-red trains agents to ignore failures.

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| `.dockerignore` change breaks the production image if anything read `data/` at build time | Grep the Dockerfile and `patch-crsqlite.sh` for `data/` before merging; verify container boot in the dev stack |
| Docker test runs are slower than host runs | Layer caching makes rebuilds fast after the first; `test:be:host` remains for Node 20 users |
| Adding ESLint surfaces a large violation backlog | Land the baseline fix as its own commit, separate from the config commit |

Rollback is per-phase; every phase is independent except that Phase 3 depends on Phase 1
for acceptable build times.

---

## 9) Handover Notes

Phases 1–4 are mechanical and can be done by one agent in a single session. Phase 5
requires a maintainer decision before work starts — **ask, do not assume**. Phase 6 must
not be skipped: the documentation is the deliverable that changes agent behaviour, the
scripts are just what makes it true.
