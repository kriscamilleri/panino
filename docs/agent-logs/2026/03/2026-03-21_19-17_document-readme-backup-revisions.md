# Document README Backup And Revisions

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-21 19:17
**Status:** completed

## Objective
Document the automatic GitHub backup scheduling behavior and revision-history retention policy in the README.

## Progress
- [x] Locate the existing README sections for GitHub backup documentation.
- [x] Add README notes for sync-triggered daily backups.
- [x] Add README notes for revision-history retention and pruning.

## Changes Made
- `README.md` — documented that automatic GitHub backups are sync-triggered with a 24-hour eligibility check, and that older automatic revisions are pruned to daily restore points after 48 hours rather than monthly snapshots.
- `docs/agent-logs/2026-03-21_19-17_document-readme-backup-revisions.md` — recorded this documentation task.

## Tests
- No code or runtime behavior changed; no automated tests were required for this documentation-only update.

## Open Items / Notes
- Existing unrelated worktree changes in `frontend/package-lock.json` and `docs/agent-logs/2026-03-21_19-05_rebuild-dev-and-browser-retest.md` were left untouched.