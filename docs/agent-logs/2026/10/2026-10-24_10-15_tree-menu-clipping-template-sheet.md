# Desktop tree menu clipping; phone template picker as a sheet

- **Agent:** Claude Code (Opus 5.5)
- **Started:** 2026-10-24 10:15
- **Status:** Done

## Objective

1. Desktop: the sidebar tree's "…" menu was cut off near the bottom of the window.
2. Phone: the template button opened the desktop dialog, which appeared with no animation and
   swapped "Loading templates…" for the list as it opened. The new-note button slides up a sheet.
   Make the template button match.

## Progress

- `TreeItem` placed the `fixed` menu at the pointer with no edge check, inside the sidebar's
  `overflow-hidden` container. It now teleports to `body` and, after measuring itself, flips above
  or left of the pointer when it would overflow (8px gap from the edge).
- `TemplatePickerModal` takes `sheet` and `open`. With `sheet` it renders through `BottomSheet`
  (same title, list, Cancel / Use Template). `PhoneHome` and `PhoneFolderView` keep it mounted and
  drive `open`, so the enter and leave transitions run. Desktop callers are unchanged (`open`
  defaults to true; they still mount it with `v-if`).
- Templates load once the database key is known, before the first opening, and again on each
  opening. The "Loading templates…" line shows only while the list is empty, so a refresh no
  longer resizes the sheet. Each opening resets to Blank document and the list view.

- Follow-up: Use Template was still abrupt. The parent closed the sheet and pushed the editor
  route in the same tick, so the sheet was unmounted mid-slide. `BottomSheet` now emits `closed`
  after its leave transition; `TemplatePickerModal` forwards it and the phone parents push the
  route then. Use Template and Create Document are disabled from the first tap until the next
  opening (one note per tap). The variables form stays on screen while the note is created
  instead of flipping back to the list.

## Changes Made

- `frontend/src/components/TreeItem.vue`
- `frontend/src/components/TemplatePickerModal.vue`
- `frontend/src/components/phone/PhoneHome.vue`, `PhoneFolderView.vue`, `BottomSheet.vue`
- `frontend/tests/unit/treeItemContextMenu.test.js`, `templatePickerSheet.test.js` (new)

## Tests

- `npm run test:fe`: 66 files, 835 tests pass. `npm run lint`: clean.
- Browser, dev stack, phone width (547x725): the template sheet's top went 725 → 367 → 180 → 106
  → 73 → 57 → 49 → 47 at 35ms intervals, against 725 → 355 → 162 → 85 → 51 → 34 → 25 for the
  new-note sheet. Closing by Cancel and by the scrim both slide down and unmount in about 200ms.
- Use Template at phone width: the sheet slid 24 → 228 → 488 → 554 → 620 → 665 over ~230ms,
  then the editor route was pushed at ~250ms.
- Desktop menu not checked in the browser by the agent (the Chrome window would not resize past
  537px); Kris confirmed the fix on desktop.

## Open Items / Notes

- Measurements in a background Chrome tab show transitions frozen at their first frame; bring the
  tab to the front (a screenshot does it) before timing animations. A tab that was open before an edit can also keep running the old
  module even though Vite serves the new file; reload before testing.
