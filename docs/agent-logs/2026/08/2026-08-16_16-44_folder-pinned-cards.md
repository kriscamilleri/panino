# Folder Pinned Cards

- Agent: Copilot CLI
- Start: 2026-08-16 16:44 +02:00
- Status: complete

## Objective

Show Continue Writing cards for pinned documents directly within the selected
folder, not only at the global Recent Documents scope.

## Progress

- Confirmed folder dashboards already load only direct notes through the
  parameterized folder query.
- Removed the global-only card-rail guard, retaining the existing pinned-only,
  newest-first selection and quick-filter behavior.
- Updated the folder component test and shipped specification.

## Changes Made

- `frontend/src/components/DocumentDashboard.vue`
  - Shows Continue Writing cards in any scope that has pinned documents.
  - Gives the Pinned filter scoped hover and active backgrounds.
- `frontend/tests/unit/documentDashboard.test.js`
  - Verifies a folder dashboard renders only its pinned note as a card.
  - Verifies the Pinned filter hover and active backgrounds.
- `docs/specs/shipped/recent-documents-redesign.md`
  - Records scoped pinned cards for global and folder views.

## Tests

| Command | Result |
|---|---|
| `npm test --prefix frontend -- tests/unit/documentDashboard.test.js` | 43 passed |

### Browser validation

- Reloaded the local dashboard after the Vite update; the pinned global card
  rail continued to render without a component error.
- Measured the live button background colors: white normally, `#f3f4f6` on
  hover, `#e5e7eb` when active, and `#d1d5db` when active and hovered.

## Open Items / Notes

- No open items.
