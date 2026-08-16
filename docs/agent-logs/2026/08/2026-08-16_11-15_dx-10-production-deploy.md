# DX-10 production deploy: Node 24 live, and two defects the deploy exposed

**Agent:** Claude Code (Opus 5)
**Started:** 2026-08-16 11:15
**Status:** completed — production is on Node 24; two production defects found and fixed

## Objective

Deploy DX-10 and conclude the spec. Everything up to this point was verified but unshipped:
production had been running end-of-life Node 20 since 2026-04-30.

The deploy did not go cleanly. It surfaced a defect in the deploy pipeline itself and a full
disk on the server, either of which would have bitten the next person to deploy anything.

## Result

Production, verified in the live container rather than inferred from a green workflow:

| | |
|---|---|
| Node | **v24.19.0** (was v20.20.2, EOL since 2026-04-30) |
| better-sqlite3 | **12.11.1** (was 9.6.0) |
| SQLite | **3.53.2** (was 3.45.3) |
| Checkout | `b1fd41d` |
| Site | 200 |
| Errors since restart | 0 |

## Progress

- [x] CI green on `develop` (`7646897`).
- [x] Record the combined-deploy deviation from §5.1 in the spec before shipping it.
- [x] Promote `develop` → `main` (`2bd5a56`). `Deploy to VPS` reported **success**.
- [x] Verify production — **found it still running Node 20**.
- [x] Diagnose: `deploy.sh` never rebuilt the backend, and reported success anyway.
- [x] Fix `deploy.sh`; promote (`b1fd41d`); deploy **failed loudly** — disk full.
- [x] With approval, prune dangling images and build cache: 100% → 45%.
- [x] Re-run deploy; verify Node 24, better-sqlite3 12.11.1, SQLite 3.53.2 live.
- [x] Verify API surface and watch for merge failures.

## Defect 1 — a deploy that reported success without deploying

`Deploy to VPS` went green for `2bd5a56`. The frontend was published and the checkout advanced
to the right commit. The api-service container kept running the **8-day-old Node 20 image** for
the next half hour.

`deploy.sh:303` was:

```bash
nohup bash -c "cd '$PROJECT_ROOT' && docker compose up --build -d api-service && echo 'Docker rebuild complete' >> /tmp/panino-deploy.log 2>&1" &
```

Two independent faults, both load-bearing:

1. **The redirect binds only to the `echo`.** `docker compose up --build` still wrote to the
   stdout it inherited from the SSH channel. When the deploy session closed, the build died on
   a broken pipe.
2. **The job returned as soon as the background process was launched**, so the workflow's
   success meant "the rebuild was started", not "the backend is deployed" — described in the
   comment as "async to save CI minutes".

What made it diagnosable: `/tmp/panino-deploy.log` had an mtime of **2026-08-08**. The two
"Docker rebuild complete" lines in it were both from the previous deploy, so today's rebuild
had not merely failed — it had never written anything at all. The image and container
creation timestamps agreed, both 8 days old.

Fixed by making the rebuild synchronous and gating the deploy's exit status on it, plus a
post-rebuild check that the container came back up, logging the Node version now running.
A deploy step that can silently not deploy is worse than a slow one. The CI-minutes saving
was real but it was buying the wrong thing.

**This had been true for every deploy since the async change.** The 2026-08-08 deploy
apparently won the race; this one lost it. Any deploy in between may or may not have applied.

## Defect 2 — production disk 100% full

With the fix in place the deploy failed properly, which is the point of the fix:

```
Error: ERROR: Failed to set up chrome-headless-shell v151.0.7922.71!
  [cause]: - DefaultProvider: ENOSPC: no space left on device, write
ERROR: docker compose up --build failed; the previous container is still running
```

`/dev/vda1 17G 17G 159M 100%`. Docker held 10.11 GB of images of which **9.38 GB was
reclaimable** — 11 dangling images (0 active) and 526 MB of build cache accumulated over
months of deploys.

This is worth separating from the deploy: **a full disk is a live risk to a SQLite
application independent of any deployment.** WAL checkpoints and ordinary writes fail on a
full volume, and this database is the one that has already had two clock-corruption
incidents this year.

With explicit approval, pruned dangling images and build cache only:

```bash
docker image prune -f      # 11 dangling, 0 active
docker builder prune -f    # 526 MB, 0 active
```

Deliberately **not** `docker system prune -a --volumes` or `docker volume prune`, either of
which would have destroyed `panino_api-data` and `panino_uploads-data` — every user database
and upload.

| | before | after |
|---|---|---|
| Disk | 17G used, 159M free, 100% | 7.5G used, 9.6G free, 45% |

Verified after: all three volumes present, `panino-api-service:latest` intact, container up,
site 200.

## Verification

Deliberately not "the workflow went green" — that is precisely what was wrong the first time.

- **In-container runtime**: Node v24.19.0, better-sqlite3 12.11.1, SQLite 3.53.2, queried live.
- **Image freshness**: built 28 seconds before the check; container up 21 seconds.
- **Startup**: clean. Auth database initialised, listening on 8000.
- **API surface**: `POST /api/sync` → 401 unauthenticated, 403 with a bad JWT (so the auth
  path executes on the new runtime), `POST /api/login` → 400 on empty body, frontend title
  served.
- **Merge failures since restart**: 0 — no `could not find row to merge with`, no
  `SYNC_CONNECTION_RESET`, no `crsqlite_merge_failure`, no `constraint failed`.
- **Errors since restart**: 0.

The substantive evidence for the risky part of this upgrade is not from the deploy at all —
it is DX-10 §6 Phase 2 step 8, run **before** shipping: a two-arm comparison of CR-SQLite
merge behaviour on 9.6.0/SQLite 3.45.3 versus 12.11.1/SQLite 3.53.2, against a real
production database (`user-A`, the July-incident account, `crsql_db_version` 47875).
IDENTICAL across `db_version` movement, change-row counts and all seven clock tables. See
`2026-08-16_09-20_spec-conclusion.md`.

## Changes Made

| File | Change |
|---|---|
| `deploy.sh` | Container rebuild is synchronous and gates the deploy's exit status; adds a post-rebuild container check |
| `docs/specs/dx/dx-10-…` → `docs/specs/shipped/dx-10-…` | Moved; `Status: shipped`, `Shipped:`/`Implementation:` headers |
| `docs/specs/shipped/dx-10-…` §5.1 | The combined-deploy deviation, with what step 8 does and does not cover |
| `docs/specs/dx/dx-00-overview.md` | Set complete: DX-01…DX-08 and DX-10 shipped, DX-09 declined |

Production side: dangling images and build cache pruned. No production file was edited, no
configuration changed, no volume touched.

## Open Items / Notes

- **Deploys between the async change and today are of unknown effect.** The mechanism was
  racy, not reliably broken — 2026-08-08 succeeded, 2026-08-16 did not. If anything looks
  stale on the server that should have shipped earlier, this is the likely reason.
- **A real end-to-end user sync has not been observed on Node 24.** Every layer responds and
  the merge behaviour was proven against this exact database pre-deploy, but no user had
  synced in the monitoring window. Worth opening a client and confirming a round trip.
- **Disk refill: fixed.** ~~Pruning was a one-off; nothing schedules it.~~ At the maintainer's
  direction, `deploy.sh` §8 now reclaims old image layers after every successful rebuild,
  keeping the newest dangling image — the build just replaced, i.e. the rollback artifact —
  and removing everything older. Cleanup never fails the deploy, since the new container is
  already serving by that point and a full disk is the *next* deploy's problem.

  Selection logic was dry-run against 225 real dangling images before shipping: it keeps
  exactly the newest and removes the other 224, including one created a second earlier. On
  production it first ran as a no-op ("at most one dangling image present"), which is the
  correct steady state — that deploy's rebuild was fully cached, so no new dangling image
  was produced.

  Note for rollback: the retained image is one generation deep, so the pre-DX-10 Node 20
  image will be dropped by the next deploy that actually rebuilds. This does not affect the
  rollback path, which is git-based (`51ffcf1`) and rebuilds from the Dockerfile anyway.
- **`[PDF] Falling back to bundled print defaults: ENOENT /poc/print-defaults.json`** appears
  at startup. It is a handled fallback, not an error, and not new to this deploy — but it
  means production PDF styling comes from the bundled defaults rather than `poc/`. Worth
  confirming that is intended.
- **§5.1's attribution concern is now unresolvable for this release.** Both phases shipped
  together, so a sync regression has two candidate causes. Rollback target is `51ffcf1`
  (last pre-DX-10 production commit) rather than an attempt to bisect the phases in
  production.
- DX-10 was the last open item in the DX set. `docs/specs/dx/` now holds only the index and
  the declined DX-09.
