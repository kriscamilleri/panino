# Trace the Node 20 pin to its cause and spec the upgrade

**Agent:** Claude Code (Opus 5)
**Started:** 2026-08-08 10:01
**Status:** completed

## Objective

Answer why this repo pins Node 20, identify the actual constraint behind it, and write the
spec for removing it. Investigation and documentation only — no runtime, dependency, or
build change was made.

## Progress

- [x] Enumerated every Node pin in the repo.
- [x] Traced the constraint to a single package and disproved the CR-SQLite half.
- [x] Confirmed the Node 20 support status against the official release schedule.
- [x] Measured the dependency upgrade path and the SQLite version delta it implies.
- [x] Wrote `docs/specs/dx/dx-10-node-runtime-upgrade.md` and registered it in DX-00.

## What the investigation established

### The constraint is `better-sqlite3@9.6.0`, not the sync stack

AGENTS.md §3 attributes the Docker test requirement to "native SQLite bindings," which reads
as though CR-SQLite is part of the pin. It is not. `db.js:541` and `db.js:755` load
CR-SQLite via `db.loadExtension()` — it is a SQLite loadable extension bound to the SQLite C
ABI, compiled from source in both images, and entirely indifferent to the Node major.

The only Node-ABI-coupled component is `better-sqlite3@9.6.0`, whose prebuilds predate Node
24. That single package is the source of the ABI 115 vs 137 error recorded in four agent
logs and diagnosed in DX-01 §2.1.

### Node 20 reached end of life on 2026-04-30

Confirmed against `nodejs/Release/schedule.json` rather than from memory: v20 "Iron" ended
2026-04-30 — 100 days before this session. v24 "Krypton" is Active LTS through 2028-04-30.
Production runs `node:20-bookworm-slim`.

This flips DX-01 §5.2's reasoning. That spec deferred the upgrade to avoid drifting the host
away from the production runtime, which was correct while Node 20 was supported. "Matching
production" now means matching an unpatched runtime.

### One dependency version spans both runtimes

`better-sqlite3@12.11.1` declares `"node": "20.x || 22.x || 23.x || 24.x || 25.x || 26.x"`.
This is the finding that shaped the spec: the dependency bump and the base-image bump can
ship as two separate, independently revertible commits with no flag day. `13.x` requires
`>=22` and would force them together, so the spec explicitly targets 12.

### The real risk is the SQLite delta, not Node

Extracted the bundled amalgamation version from each release tarball:

| `better-sqlite3` | Bundled SQLite |
|---|---|
| 9.6.0 (current) | 3.45.3 |
| 11.10.0 | 3.49.2 |
| 12.11.1 (proposed) | 3.53.2 |

`@vlcn.io/crsqlite` last published 0.16.3 on 2024-01-17 and is unmaintained upstream. The
upgrade would run a SQLite-3.45-era extension against 3.53.2, landing on the `crsql_changes`
surface behind both 2026 production incidents. `11.10.0` (SQLite 3.49.2, Node 20/22/23) is
recorded in the spec as a bisect anchor if 3.53.2 breaks it.

### Incidental findings

- `backend/api-service/` tracks **both** `package-lock.json` and `pnpm-lock.yaml`. They
  agree on `9.6.0` today, so this is latent rather than active, but a native-dep upgrade
  applied to one and not the other would only surface at image build time. The spec removes
  the pnpm lockfile as its Phase 1.
- `patch-crsqlite.sh` fixes CR-SQLite's import attributes for Node 24 — evidence of an
  earlier intent to migrate that never included `better-sqlite3`. On Node 20 the script is
  cosmetic; on Node 22+ it becomes load-bearing, and it currently no-ops silently if the
  substitution fails to match.
- `.github/workflows/test.yml` uses `node-version-file: ".nvmrc"`, so CI follows the pin
  with no workflow edit.
- Puppeteer is `^22.12.1`; current is `25.5.0`.

## Changes Made

- `docs/specs/dx/dx-10-node-runtime-upgrade.md` — new. Four phases: drop the duplicate
  lockfile, upgrade `better-sqlite3` on Node 20, move the base images to Node 24, update the
  documentation. Includes the complete inventory of the seven runtime pins and nine
  documentation references that name Node 20.
- `docs/specs/dx/dx-00-overview.md` — registered DX-10 in the spec table, added it to the
  sequencing diagram after DX-02, added a fourth real ordering constraint, and noted in §1
  why a production security item sits in a DX set.

No source, dependency, Dockerfile, or configuration file was modified.

## Tests

None run. This change touches only `docs/`, and no suite covers it.

## Open Items / Notes

- **DX-10 Phase 2 step 8 is the whole spec.** The `/sync` round trip against restored
  production-shape data is the only step that produces new information; the rest is version
  strings. A green unit suite is not sufficient evidence for a SQLite change on this path.
- The spec supersedes DX-01 §5.2 and changes DX-09's `@types/node@^20` pin to `^24`.
  Neither file was edited — that is DX-10 Phase 4 work, to land with the change itself.
- **The larger question this surfaced and did not answer:** the sync stack depends on an
  extension abandoned for two and a half years. DX-10 only proves 0.16.3 still works against
  current SQLite. If Phase 2 step 8 shows it does not, that is a more important finding than
  the upgrade, and the trigger for a spec on replacing or vendoring CR-SQLite.
- Node 26 becomes LTS on 2026-10-28 and is already inside the `12.11.1` engines range, so
  the next hop is cheap. Deliberately out of scope.
