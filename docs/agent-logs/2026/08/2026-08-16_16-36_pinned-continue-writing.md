# Pinned Continue Writing Cards

- Agent: Copilot CLI
- Start: 2026-08-16 16:36 +02:00
- Status: complete

## Objective

Remove the redundant global `Recent` toolbar heading and make Continue Writing
show only the three most recently modified pinned notes.

## Progress

- Reviewed the shared dashboard component, its mounted component tests, and the
  shipped redesign specification.
- Updated Continue Writing to filter source documents by `isPinned` and reuse
  the timestamp-safe newest-first utility sort, independently of the list sort.
- Kept folder dashboards unchanged: they retain the `Documents` toolbar heading
  and never render the global card rail.

## Changes Made

- `frontend/src/components/DocumentDashboard.vue`
  - Removed the global `Recent` toolbar heading.
  - Restricted Continue Writing cards to pinned notes, newest first.
  - Removed the duplicate empty-state creation action.
- `frontend/src/components/DocumentDashboardHeader.vue`
  - Shortened the header creation action from `New Note` to `New`.
- `frontend/tests/unit/documentDashboard.test.js`
  - Updated card-count and card-order assertions for pinned-only behavior.
  - Added coverage that oldest-first list sorting does not reverse card order.
  - Asserted that empty states do not duplicate the header creation action.
- `docs/specs/shipped/recent-documents-redesign.md`
  - Recorded the final card-selection and heading behavior.

## Tests

| Command | Result |
|---|---|
| `npm test --prefix frontend -- tests/unit/documentDashboard.test.js` | 43 passed |
| `npm run test:fe` | 352 passed, 19 files |
| `npm run lint` | 0 errors; 40 pre-existing warnings |

### Browser validation

With the Docker development stack running on the local `develop`-derived branch:

- The global toolbar no longer rendered the redundant `Recent` heading.
- The global rail rendered the pinned test note and no unpinned notes.
- At a 375px viewport, the rail showed one pinned card and the global list-heading
  test ID had a count of zero.
- A fresh browser context showed the header control as `New` and zero empty-state
  creation controls.

## Open Items / Notes

- No open items.
