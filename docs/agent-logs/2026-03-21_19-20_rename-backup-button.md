# Rename Backup Button

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-21 19:20
**Status:** completed

## Objective
Rename the Tools menu button label from `GitHub Backup` to `Backup`.

## Progress
- [x] Locate the current button label in the Tools submenu.
- [x] Update the label text to `Backup`.
- [x] Verify the updated label in the running app.

## Changes Made
- `frontend/src/components/SubMenuBar.vue` — changed the Tools menu button label from `GitHub Backup` to `Backup` while keeping the existing action and icon.
- `docs/agent-logs/2026-03-21_19-20_rename-backup-button.md` — recorded this UI text update.

## Tests
- Browser validation in the dev app — verified the Tools menu now shows `Backup`.

## Open Items / Notes
- Existing unrelated worktree changes in `README.md`, `frontend/package-lock.json`, and earlier agent logs were left untouched.