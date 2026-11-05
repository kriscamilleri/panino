# Spaces in the phone Drawer, and a collapsible My Notes

- Agent: Claude Code (Opus 5.5)
- Start: 2026-10-30, approximately 10:15
- Status: Implemented and verified locally on `feature/addons-menu` (with the Add-ons menu work); not committed

## Objective

Kris asked for spaces to be reachable from the sidebar on phones, and for personal Documents
(not in a space) to sit under a collapsible **My Notes** once there is at least one space, so
they collapse the way each space does.

## Changes Made

- `uiStore.js`: persisted `myNotesCollapsed` (default open) and `toggleMyNotesCollapsed`, saved
  with the other UI settings, so desktop and phone agree.
- `Documents.vue` (desktop sidebar): with no space, the tree is unchanged. With one or more, a
  **My Notes** row (`documents-my-notes-toggle`, `aria-expanded`) holds the personal root items,
  above the spaces. Dropping on it moves an item to the personal root, as the pane does.
  Search results stay flat.
- `phone/PhoneDrawer.vue`: with no space, the Folders section is unchanged. With one or more,
  **My Notes** is a collapsible group holding the personal folders, See all and New folder. Each
  space follows as a group: the chevron (`phone-drawer-space-toggle-<dbKey>`) shows its
  top-level folders, loaded when expanded and capped at seven with a See all, and the name
  (`phone-drawer-space-<dbKey>`) opens the space. A space's expanded state is the desktop tree's
  (`docStore.isFolderOpen(dbKey, dbKey)`).

## Tests

- New `tests/unit/sidebarMyNotes.test.js` (5 tests): desktop with and without a space, My Notes
  collapse, and order; Drawer with and without a space, My Notes collapse, opening a space, and
  expanding it (top-level folders only).
- `npm run lint` clean; `npm run test:fe` 86 files, 1052 tests passed.
- Headless Chromium against the dev stack, with the API recreated with
  `SHARED_SPACES_ENABLED=true` and a throwaway account owning two spaces: screenshots at
  1280x800 (My Notes open and collapsed) and 390x844 (Drawer, space expanded, My Notes collapsed,
  a space opened). No page errors.

## Open Items / Notes

- The dev API container now runs with `SHARED_SPACES_ENABLED=true` (set on the command line, not
  in `.env`); a plain `docker compose up` turns it off again.
- Throwaway dev account `sidebar-shots-<timestamp>@example.test` with two spaces remains.
