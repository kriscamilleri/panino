# Mobile dashboard search overflow

Agent: Copilot
Start: 2026-08-16 17:59 CEST
Status: Complete

## Objective

Keep the Recent Documents header's New action visible when the available pane width is narrow,
and offer template-based document creation from that action.
The dashboard also supports modification- and creation-date sorting in either direction.

## Progress

- Reproduced the issue in the running frontend at a 375px viewport. The document tree occupied 300px, leaving a 71px Recent Documents pane; the header control row's intrinsic minimum width placed the New button outside that pane.
- Identified the header control group as the missing flex shrink boundary: the search wrapper was already shrinkable, but its parent was not.

## Changes Made

- Added `min-w-0` to the header control group so the flexible Search field is limited to the width remaining after the fixed-width New action.
- Added a component regression test that preserves the shrink contract for the controls, search field, and New action.
- Added an accessible split-button menu that opens the existing Template Picker from the Recent Documents header.
- Reused the existing picker and its creation flow, passing the active folder scope and routing created documents through the dashboard's established open-document flow.
- Preserved each document's creation timestamp in the dashboard model and added ascending and descending creation-date sort options.
- Made date grouping follow the selected sort date so created-date sections remain chronological.

## Tests

- `npm --prefix frontend test -- recentDocuments.test.js documentDashboard.test.js` -- passed: 91 tests. The expected error-path tests log failed document creation and failed pin writes. Vite also reported pre-existing missing source maps for vendored CR-SQLite modules.
- `npm --prefix frontend run build` -- passed. The build reported existing Browserslist age and chunk-size warnings.
- Browser verification in the running dev frontend: the New menu exposed “New from Template” and opened the existing picker dialog. The dashboard also selected “Created, newest first” and reordered the visible documents. At 375px, the selected sort control remained visible and document scroll width equalled the viewport width. At 1280px, Search was 288px and New remained visible.

## Open Items / Notes

- No schema, store, sync, authorization, or dependency changes.
