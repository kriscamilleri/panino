# README refresh

Agent: Copilot CLI
Start: 2026-08-16 20:20 CEST
Status: Complete

## Objective

Update the README to describe user-facing improvements delivered since its most recent revision,
while retaining the existing headings, Markdown style, and developer documentation.

## Progress

- Compared the README history with commits delivered after `38851ad`, its latest update.
- Verified dashboard behavior from its components, utility tests, and the associated delivery log.
- Verified theme persistence, scope, and navigation controls from the implementation, tests, and
  dark-mode specification.

## Changes Made

- Added the persistent light/dark appearance to the feature list.
- Added user-guide sections for the document dashboard and appearance controls.
- Documented dashboard filtering, sorting, pinned documents, Continue Writing, and template-based
  creation without overstating the scoped behavior.
- Documented local browser theme persistence and desktop navigation-label collapse.
- Documented the vendored frontend and backend CR-SQLite runtimes, their SQLite support
  dependencies, platform boundary, and backend SQLite upgrade.

## Tests

- `git diff --check` — passed with no whitespace errors.
- Reviewed the resulting README diff to confirm that existing sections and formatting remain
  intact.
- Confirmed the documented frontend runtime dependencies from the vendored import graph:
  `crsqlite-wasm`, `wa-sqlite`, `xplat-api`, and npm-provided `async-mutex`.

## Open Items / Notes

- No code, runtime configuration, dependency, or schema changes.
