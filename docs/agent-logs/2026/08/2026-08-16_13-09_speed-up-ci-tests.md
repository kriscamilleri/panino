# Speed up CI tests

Agent: Copilot CLI runtime in VS Code
Start: 2026-08-16T13:09:29+02:00
Status: Complete

## Objective

Reduce GitHub Actions time spent testing without weakening the test suite or changing its Node 24
Docker environment.

## Progress

The most recent successful `develop` test workflow completed in 68 seconds. Its frontend and lint
jobs completed in 14 and 11 seconds, respectively. The backend job took 68 seconds, but its
Vitest summary reported only 15 seconds of test execution for all 170 tests. The preceding 47
seconds were needed to build the backend test image, including native dependencies and
Puppeteer's browser.

## Changes Made

- Evaluated a GitHub Actions BuildKit cache for the backend test image, then removed it after its
  first run took 114 seconds against the prior 63-second Docker build. GitHub stored only a 5 KB
  cache index rather than reusable image layers, so the cache could not amortize native and
  Puppeteer setup.
- Added workflow concurrency so a newer push cancels an obsolete test run for the same branch or
  pull request.
- Stopped the standalone test workflow from running on `main` pushes because `deploy.yml`
  invokes the same reusable workflow before every deployment.
- Skipped the standalone test workflow for changes limited to documentation and repository
  guidance files. Workflow and source changes still run all three jobs.

## Tests

- Inspected workflow job and step timestamps from GitHub Actions run `31943511401`.
- Confirmed the backend run passed 15 test files and 170 tests in 15 seconds.
- `bash -n scripts/test-backend.sh` and `git diff --check` — passed.
- GitHub branch-protection API reports neither `main` nor `develop` has required checks, so a
  documentation-only skipped test workflow cannot block a merge.
- Configuration validation is limited to diff and shell syntax checks locally; the first GitHub
  Actions run will populate the Docker cache, and subsequent runs provide the measured warm-cache
  result.

## Open Items / Notes

- Keep the direct Docker build: it remains the faster, proven path for this small test image.
