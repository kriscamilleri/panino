# Preserve document timestamps on open

Agent: Copilot CLI runtime in VS Code
Start: 2026-08-16T12:40:58+02:00
Status: Complete

## Objective

Reproduce and correct the frontend behavior that updates a note's `updated_at` timestamp when
the note is opened without an edit.

## Progress

The document-selection store only reads the selected note. The editor updates OverType's value
when the selected file changes, and its `onChange` callback currently schedules a save without
checking whether that value differs from the persisted note content.

## Changes Made

- Added a pure predicate for comparing persisted and editor content.
- The editor now schedules a save only when its value differs from the selected note's persisted
  content. It also cancels a pending save when the editor returns to that persisted value.
- Added regression coverage for initialization, legacy empty content, actual edits, and the
  editor's guarded scheduling path.

## Tests

- `npm exec --prefix frontend vitest run -- tests/unit/documentPersistence.test.js` — 4 passed.
- `npm exec eslint -- frontend/src/components/Editor.vue frontend/src/utils/documentPersistence.js frontend/tests/unit/documentPersistence.test.js` — passed.
- `npm run build --prefix frontend` — passed; existing dynamic-import and bundle-size warnings
  remain.
- Browser check: the Docker development frontend loaded successfully at the sign-in route.
- Authenticated browser regression: created a fresh development account and note, recorded its
  `Last Updated` value (`8/16/2026, 12:43:11 PM`), navigated to the recent-documents route,
  reopened the note, and waited 1.2 seconds beyond the 500 ms save debounce. The `Last Updated`
  value remained exactly `8/16/2026, 12:43:11 PM`.

## Open Items / Notes

- Browser verification used a fresh development-only account and note.
