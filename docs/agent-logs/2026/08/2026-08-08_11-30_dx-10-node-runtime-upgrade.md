# DX-10 Node runtime upgrade (20 -> 24) — implementation and local verification

**Agent:** Claude Sonnet 5
**Started:** 2026-08-08
**Status:** Phases 1-4 implemented and verified locally; production deploy steps deliberately not performed (see Open Items)

## Objective

Implement [DX-10](/home/kris/Development/panino/docs/specs/dx/dx-10-node-runtime-upgrade.md):
move production and tooling off end-of-life Node 20 by bumping `better-sqlite3` to
`^12.11.1` first (Phase 2, still on Node 20), then moving the runtime pins to Node 24
(Phase 3), then updating documentation (Phase 4) — each phase as an independently
revertible commit, per the spec's explicit sequencing requirement.

## Progress

- [x] Phase 1 — removed `pnpm-lock.yaml` / `pnpm-workspace.yaml`, npm is now the only
      tracked package manager for `backend/api-service`.
- [x] Established a pre-bump test baseline (152/152 passing on Node 20 +
      better-sqlite3@9.6.0) before touching the dependency, so the Phase 2 comparison
      means something.
- [x] Phase 2 — bumped `better-sqlite3` to `^12.11.1` on Node 20; regenerated
      `package-lock.json` inside a Node 20 container; verified `loadExtension` +
      `crsql_db_version()`; full suite passed 152/152 with no regressions.
- [x] Phase 3 — moved all seven runtime pins to Node 24; found and fixed two real
      breakages the spec text didn't anticipate (see Changes Made); full suite passed
      152/152 on Node 24, both in Docker and host-native.
- [x] Verified Goal 4 directly: `npm run test:be:host` now passes on this machine's
      actual Node 24 host (`v24.11.1`), which was previously blocked by the ABI mismatch
      DX-01 documented.
- [x] `npm run doctor` reports `v24.x` as expected, no broken bindings.
- [x] Brought up the full dev stack (`docker compose -f docker-compose.dev.yml up --build`)
      and drove it end-to-end over HTTP: signup, `/sync` round trip, `/render-pdf` — all
      succeeded against the live Node 24 container. No `chromium-cli` or Playwright was
      available in this environment, so this was an API-level smoke test, not a real
      browser click-through; see Open Items.
- [x] Phase 4 — replaced every "Node 20" reference in the spec's inventory (§6 step 15)
      across `AGENTS.md`, `README.md`, `backend/api-service/AGENTS.md`,
      `.github/copilot-instructions.md`, the feature-development skill, the CI workflow
      comment, `scripts/test-backend.sh`, and `scripts/doctor.sh`. Amended DX-01 §5.2 and
      DX-09 §5 per the spec. Added the dated note to `crsqlite-sync.md`.
- [ ] Not done: the merge-behaviour verification against restored real production data
      (§6 Phase 2 step 8), and the actual production deploy of either phase (§6 steps 9
      and beyond involving the live host). Both require production data/host access and
      explicit approval per `AGENTS.md` §4, out of scope for this local session.

## Changes Made

**Phase 1** (`249e87f`): removed the dual lockfile.

**Phase 2** (`4b2b1c0`): `backend/api-service/package.json` /
`package-lock.json` — `better-sqlite3` `^9.6.0` -> `^12.11.1`, `engines` left at
`>=20 <21`.

**Phase 3** (`c6a0334`): all seven runtime pins moved to Node 24
(`.nvmrc`, `backend/api-service/Dockerfile[.test]`, `frontend/Dockerfile.dev`,
`backend/font-service/Dockerfile`, `backend/api-service/package.json` `engines`,
`poc/package.json` `engines`). Puppeteer `^22.12.1` -> `^25.5.0` in both
`backend/api-service` and `poc`; both lockfiles regenerated inside Node 24 containers.
`patch-crsqlite.sh` hardened to exit non-zero when the substitution would silently no-op
(verified with an injected helper file containing neither `assert` nor `with` import
attributes).

Two breakages found and fixed that the spec text did not anticipate:

1. **Install-script ordering.** `@vlcn.io/crsqlite` runs its own `"install"` lifecycle
   script (`nodejs-install-helper.js`) *before* the root package's `postinstall` ever
   fires — npm runs a dependency's own lifecycle scripts during its installation phase,
   which precedes the root package's `postinstall`. That helper still used the
   pre-Node-22 `assert { type: "json" }` import-attribute syntax, a hard `SyntaxError` on
   Node 24, so `npm ci` crashed before `patch-crsqlite.sh` ever got a chance to run — no
   matter how loud the patch script's own failure mode was made. Fixed by adding
   `backend/api-service/.npmrc` (`ignore-scripts=true`) and a `native:setup` npm script
   that explicitly drives, in order: patch the helper -> build `better-sqlite3`'s N-API
   addon (`cd node_modules/better-sqlite3 && npm run install`) -> fetch CR-SQLite's
   prebuilt extension (`cd node_modules/@vlcn.io/crsqlite && node
   nodejs-install-helper.js` — must `cd` first, the script uses paths relative to its own
   package directory) -> download Puppeteer's Chrome build (`node
   node_modules/puppeteer/install.mjs`). Both Dockerfiles now run `npm ci && npm run
   native:setup`. Verified the binary actually lands
   (`node_modules/@vlcn.io/crsqlite/dist/crsqlite.so` present, `loadExtension` +
   `crsql_db_version()` succeed) rather than trusting `npm rebuild`'s "rebuilt
   dependencies successfully" message, which turned out to be a false positive — it
   silently skipped the lifecycle script under `ignore-scripts=true` without downloading
   anything.

2. **Puppeteer 25 API changes**, both silent (no throw at the call site until deep in a
   request path):
   - `Browser.isConnected()` was removed; replaced with the `.connected` boolean
     (`pdf.js:345`). Without the fix, every `/render-pdf` request threw
     `browserInstance.isConnected is not a function` -> HTTP 500.
   - `page.pdf()` now returns a plain `Uint8Array` instead of a Node `Buffer`. Express's
     `res.send()` only special-cases real `Buffer`s (`Buffer.isBuffer()`); handed a
     `Uint8Array` it falls through to the JSON-serialization branch and sends
     `{"0":37,"1":80,...}` instead of the PDF bytes — a 200 response with a corrupted
     body, not an error. Caught by `tests/integration/pdf.test.js`'s content-type
     assertion (`application/pdf` vs `application/pdf; charset=utf-8` — the charset is
     what `res.json()` adds), not by anything that directly names the real defect. Fixed
     with `res.send(Buffer.from(pdfBuffer))` (`pdf.js:610`). Documented both gotchas in
     `docs/architecture/pdf-pipeline.md` for the next Puppeteer major bump.

**Phase 4** (`e7fa54d`): documentation sweep — see commit message for the full file list.

## Tests

- Node 20 baseline (pre-bump): `npm run test:be` equivalent inside
  `Dockerfile.test` — **152/152 passed**, 14 files. No known-red tests found (the
  `sync.revision.test.js` file DX-01 §7 flagged as possibly known-red passed in full).
- Node 20 + better-sqlite3@12.11.1: loadExtension + `crsql_db_version()` probe succeeded
  (SQLite 3.53.2 loaded via CR-SQLite 0.16.3); full suite **152/152 passed**, identical to
  baseline.
- Node 24 + better-sqlite3@12.11.1 + Puppeteer 25 (before the two fixes above):
  **148/152 passed**, all 4 failures in `pdf.test.js` (`isConnected` TypeError -> 500,
  and one content-type mismatch that on isolation turned out to be the Buffer bug).
- Node 24, after both fixes: **152/152 passed**, both in `Dockerfile.test` and
  host-native (`npm run test:be:host` on this machine's actual Node 24.11.1 host).
- Production `Dockerfile` (with `--omit=dev`) also builds clean on Node 24.
- `npm run doctor`: reports `node v24.11.1 (expected: v24.x)`, `better-sqlite3: OK`.
- `patch-crsqlite.sh` failure mode verified directly: injecting a helper file with
  neither `assert` nor `with` import attributes makes the script exit 1 with a clear
  message, instead of silently no-oping.
- Full dev stack (`docker compose -f docker-compose.dev.yml up --build`): both
  `api-service` and `frontend` containers started clean, no errors in logs beyond a
  pre-existing benign `ENOENT` fallback for `/poc/print-defaults.json` (unrelated to this
  change). Drove it over HTTP with a throwaway test account:
  - `POST /signup` -> 200, JWT issued (exercises the new better-sqlite3 write path).
  - `POST /sync` (empty changeset) -> 200, valid `crsql_changes` payload returned
    (exercises the CR-SQLite loadable-extension path against SQLite 3.53.2 live, not just
    in the isolated test image).
  - `POST /render-pdf` with `htmlContent` -> 200, `Content-Type: application/pdf`, and the
    output verified with `file` as a genuine 1-page PDF document (proves both Puppeteer
    fixes work end-to-end against the running container).
  - Test account and generated PDF cleaned up after; stack torn down with
    `docker compose down`.

## Open Items / Notes

- **No real browser pass performed.** This environment has neither `chromium-cli` nor
  Playwright installed (`npx playwright` prompted to install and was declined
  non-interactively). The `run` skill's fallback pattern could not be used. What was done
  instead — driving the live container over HTTP through signup/sync/PDF — covers the
  same backend code paths but does not verify the frontend Editor/preview UI in an actual
  browser. If a real click-through is wanted, install `chromium-cli` or Playwright and
  rerun.
- **DX-10 §6 Phase 2 step 8 (the spec's own "real gate") was not performed.** It requires
  restoring a snapshot of real user data into a scratch container and running a full
  `/sync` round trip including a note delete and an image-clock write, comparing
  `crsql_db_version()` and clock-table row counts against a 9.6.0 build. This needs
  production data access, which this session did not have and did not request. The
  synthetic sync/image/revision integration tests all passed on the new build, which is
  necessary but explicitly **not sufficient** per the spec's own framing — do this before
  deploying Phase 2 to production.
- **No production deployment was performed** (§6 steps 9 and the Phase 3 rollout). Per
  `AGENTS.md` §4, that requires explicit approval in the working conversation and a
  timestamped backup first, and was out of scope for this session.
- All four commits (`249e87f`, `4b2b1c0`, `c6a0334`, `9c3206a`, `e7fa54d`) are on
  `develop`, not yet pushed or opened as a PR.
- Host `backend/api-service/node_modules` on this machine was mutated by the
  `test:be:host` verification (now built against better-sqlite3@12.11.1 / Node 24); this
  is gitignored and reversible with `npm run native:setup` after any future `npm ci`.
