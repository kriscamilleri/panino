# Node 20 GitHub Actions audit

**Agent:** Copilot CLI
**Started:** 2026-08-16 13:04 +02:00
**Status:** completed — workflow action pins moved to Node 24 implementations

## Objective

Determine why GitHub Actions reports Node 20 after DX-10 moved Panino's runtime images to Node 24, and identify any remaining active Node 20 use.

## Progress

- Read the workflow, runtime pins, Dockerfiles, test runners, and current successful CI log (run `31943217119`).
- Verified `actions/checkout@v4`, `actions/setup-node@v4`, and `webfactory/ssh-agent@v0.9.0` each declare `runs.using: node20`.
- Verified the hosted runner's warning says it executes those actions with Node 24 by default.
- Verified lint and frontend jobs resolve `.nvmrc` to cached Node `24.19.0`; backend tests build `backend/api-service/Dockerfile.test`, which starts from Node 24.
- Searched active configuration outside dependency locks and historical documents.

## Changes Made

- Updated `actions/checkout` from `v4` to `v5` in all three test workflow jobs.
- Updated `actions/setup-node` from `v4` to `v5` in the lint and frontend jobs.
- Updated `webfactory/ssh-agent` from `v0.9.0` to `v0.10.0` in the deploy workflow.

All three new action versions declare `runs.using: node24`, removing the obsolete Node 20
action-runtime warning and aligning action metadata with Panino's Node 24 policy.

The only repository-local Node 20 runtime is
`scripts/dx10-merge-verification/Dockerfile.arm`. It deliberately holds both verification
arms on Node 20 so DX-10 could isolate the `better-sqlite3`/SQLite dependency comparison from
the later Node runtime change. It is a manually invoked historical verification harness, not a
CI or production path.

## Tests

- Configuration audit: `.nvmrc` is `24`; all production, development, and backend-test
  Dockerfiles start from Node 24.
- CI log audit: the successful run installed Node `24.19.0` for frontend and lint and ran the
  backend suite in the Node 24 test image.
- Action metadata audit: current pinned action implementations declare Node 20, while
  `actions/checkout@v5`, `actions/setup-node@v5`, and `webfactory/ssh-agent@v0.10.0` declare
  Node 24.
- Static validation: `git diff --check` passes, and an active configuration search finds no
  obsolete action pin with a Node 20 runtime. The only remaining Node 20 reference is the
  intentional DX-10 harness.

## Open Items / Notes

The only repository-local Node 20 runtime remains the intentionally historical, manually
invoked DX-10 comparison harness described above.
