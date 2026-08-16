# Correct dark pinned filter styling

Agent: Copilot CLI
Started: 2026-08-16 20:14 +02:00
Status: complete

## Objective

Correct the active Pinned filter button in the document dashboard so it does not use a light-mode
surface while dark mode is active.

## Progress

- Traced the issue to the dashboard's scoped pressed-state rules, which hard-code light gray
  backgrounds and therefore override the shared dark palette.

## Changes Made

- Added a dark-theme active state for the Pinned filter using the primary palette and dark,
  high-contrast foreground.
- Kept the hover state visibly distinct while preserving the existing light-mode styling.
- Added regression coverage for both active component state and dark CSS cascade requirements.

## Tests

- `npm test --prefix frontend -- --reporter=verbose tests/unit/documentDashboard.test.js tests/unit/darkPreviewCodeBlocks.test.js`
  - 48 tests passed.
  - Existing CR-SQLite vendor sourcemap warnings and expected error-path test logging were
    emitted; neither affected the successful result.

## Open Items / Notes

- Browser validation was blocked because the shared 5174 page redirected to login and no
  authenticated dashboard session was available.
