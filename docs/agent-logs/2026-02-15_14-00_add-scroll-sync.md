# Add Scroll Sync Between Editor and Preview

**Agent:** GitHub Copilot (Claude Opus 4.6)
**Started:** 2026-02-15 14:00
**Status:** completed

## Objective
Add a scroll lock toggle to the editor menu that synchronizes scroll positions between the editor and preview panes.

## Progress
- [x] Research editor, preview, and content area components
- [x] Add `scrollSync` state to uiStore with persistence
- [x] Implement proportional scroll sync in ContentArea.vue
- [x] Add Scroll Sync toggle button to SubMenuBar.vue editor action bar

## Changes Made
- `frontend/src/store/uiStore.js` — Added `scrollSync` ref, included in settings persistence (save/load/reset), exposed toggle action
- `frontend/src/components/ContentArea.vue` — Added scroll event listeners on editor/preview panes with proportional sync logic, attach/detach based on toggle state
- `frontend/src/components/SubMenuBar.vue` — Added Scroll Sync toggle button with LockKeyhole/UnlockKeyhole icons from Lucide

## Tests
- No lint/compile errors in any modified file

## Open Items / Notes
- Scroll sync uses proportional (percentage-based) mapping between panes — this works well for similarly-structured content but may drift slightly when rendered preview height differs significantly from source text height (e.g., large images, collapsed code blocks).
