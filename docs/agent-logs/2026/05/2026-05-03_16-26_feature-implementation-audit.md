# Feature Implementation Audit

**Agent:** feature-audit
**Started:** 2026-05-03 16:26 UTC
**Status:** completed

## Objective
Audit 16 prospective features against the current codebase to determine which are already implemented and which need specs written.

## Progress
- [x] Delegate research to sub-agent covering all 16 features
- [x] Compile results and write spec prompts for unimplemented/partially-implemented features
- [x] Create agent log
- [x] Implement 3 low-complexity features on `feature/minor-amendments`
- [x] MCP validation of all 3 features

## Findings Summary

| # | Feature | Status |
|---|---------|--------|
| 1 | User-generated themes (Preview) | NOT IMPLEMENTED |
| 2 | User-generated themes (Print) | NOT IMPLEMENTED |
| 3 | Duplicate file | **NOW IMPLEMENTED** |
| 4 | Duplicate folder | NOT IMPLEMENTED |
| 5 | Document variables (local scoping) | PARTIALLY — Globals only |
| 6 | Toggle joint scrolling | IMPLEMENTED |
| 7 | AI Chat side panel | NOT IMPLEMENTED |
| 8 | Revision history rollback UI | IMPLEMENTED |
| 9 | Reload docs + auto-nav + folder path | PARTIALLY — Folder path missing |
| 10 | 3-pane layout issues | PARTIALLY — No docs-pane resizer, edge-case quirks |
| 11 | Refresh recent docs after sync | **NOW IMPLEMENTED** |
| 12 | Styles pages layout (vertical) | NOT IMPLEMENTED — Currently side-by-side |
| 13 | Collapse button across all submenus | **NOW IMPLEMENTED** |
| 14 | updated_at changing on open + last_accessed | NOT IMPLEMENTED |
| 15 | Date/time formatting settings | NOT IMPLEMENTED |
| 16 | Template manager | IMPLEMENTED |

---

## Implementation (2026-05-03 ~16:45 UTC)

**Branch:** `feature/minor-amendments` (cut from `develop`)

### #11 Refresh Recent Documents After Sync
- Added `recentDocVersion` ref to `docStore.js`, incremented in `refreshData()`
- `FolderPreview.vue` watchEffect now depends on `recentDocVersion` — refreshes recents when sync completes

### #3 Duplicate File
- Added `duplicateFile()` action to `structureStore.js` (reads source, generates new UUID, inserts copy with "(copy)" suffix)
- Exposed `duplicateFile` through `docStore.js`
- Added "Duplicate" button with `Copy` icon to `TreeItem.vue` context menu (between Rename and Delete)
- Added `handleDuplicate()` function

### #13 Collapse Button Across All Submenus
- Added `viewMenuCollapsed` and `toolsMenuCollapsed` to `uiStore.js` with toggle actions, persistence, and defaults
- Added collapse buttons to View and Tools submenus in `SubMenuBar.vue`
- Fixed: Added `class="button-text"` to all BaseButton spans in View and Tools submenus (was missing, so existing CSS `.editor-menu-collapsed .button-text` rule didn't apply)
- Added `:class` binding for `editor-menu-collapsed` on View and Tools submenu divs

## MCP Validation

| Test | Result |
|------|--------|
| Duplicate button in file context menu | ✅ Present (Rename > Duplicate > Delete) |
| Duplicate creates "X (copy)" in doc list | ✅ "Meeting Notes (copy)" appeared |
| Duplicate appears in Recent Documents | ✅ "Meeting Notes (copy)" in recents |
| View submenu collapse toggle | ✅ Round-trip: collapsed (icons only) ↔ expanded (labels) |
| Tools submenu collapse toggle | ✅ Round-trip verified |
| Console errors | ✅ None |

## Changed Files
- `frontend/src/store/docStore.js` — `recentDocVersion`, exposed `duplicateFile`
- `frontend/src/store/structureStore.js` — `duplicateFile()` action
- `frontend/src/store/uiStore.js` — `viewMenuCollapsed`, `toolsMenuCollapsed` with persistence
- `frontend/src/components/SubMenuBar.vue` — collapse buttons in View/Tools, `button-text` class fix
- `frontend/src/components/TreeItem.vue` — Duplicate context menu entry + Copy icon
- `frontend/src/components/FolderPreview.vue` — depends on `recentDocVersion`

## Open Items / Notes
- Full spec prompts delivered to user in conversation
- Remaining 10 features still need implementation or spec work
