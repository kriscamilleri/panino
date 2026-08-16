# Merge dark mode into develop

Agent: Copilot CLI
Started: 2026-08-16 20:03 +02:00
Status: complete

## Objective

Merge the already-pushed `feature/dark-mode` branch into `develop`.

## Progress

- Fetched `origin` and confirmed the feature branch was clean and already pushed.
- Reconciled the dashboard header and dashboard test conflicts.

## Changes Made

- Retained `develop`'s New-from-template menu and the dark-mode branch's neutral,
  link-blue New action styling.
- Retained both the dashboard sorting and New-action styling assertions.

## Tests

- `npm test --prefix frontend -- --reporter=verbose tests/unit/documentDashboard.test.js`
  - 46 tests passed.
  - Existing CR-SQLite vendor sourcemap warnings and expected error-path test logging were
    emitted; neither affected the successful result.

## Open Items / Notes

- None.
