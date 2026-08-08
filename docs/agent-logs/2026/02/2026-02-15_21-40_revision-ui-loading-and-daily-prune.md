# Revision spec follow-up: UI loading and daily prune

**Agent:** GitHub Copilot (GPT-5.3-Codex)
**Started:** 2026-02-15 21:40
**Status:** completed

## Objective
Extend the revision history spec with UI loading behavior and a daily periodic prune process for inactive/deleted notes.

## Progress
- [x] Identify sections to update for UI load model.
- [x] Add daily scheduler and orphan/deleted-note cleanup behavior.
- [x] Final consistency pass.

## Changes Made
- `docs/agent-logs/2026-02-15_21-40_revision-ui-loading-and-daily-prune.md` — created log for this follow-up session.
- `docs/specs/revision-history-proposal.md` — added revision list pagination + UI loading model (skeletons, lazy detail fetch, session caching, error handling) and daily global prune requirements for inactive/orphaned revisions.

## Tests
- Not applicable (documentation change).

## Open Items / Notes
- Section 9 now defines `limit`/`before` pagination contract expected by frontend loading behavior.
