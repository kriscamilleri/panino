# Rewrite revision history proposal

**Agent:** GitHub Copilot (GPT-5.3-Codex)
**Started:** 2026-02-15 21:25
**Status:** completed

## Objective
Completely rewrite `docs/specs/revision-history-proposal.md` with clearer contracts, stronger correctness guarantees, and phased implementation guidance.

## Progress
- [x] Define revised proposal structure and decision boundaries.
- [x] Rewrite full proposal document.
- [x] Consistency pass and finalize.

## Changes Made
- `docs/agent-logs/2026-02-15_21-25_rewrite-revision-history-proposal.md` — created log for this rewrite session.
- `docs/specs/revision-history-proposal.md` — fully replaced with v2 specification including explicit invariants, API contracts, pruning precedence, and phased delivery.

## Tests
- Not applicable yet (documentation rewrite).

## Open Items / Notes
- Open product decisions remain in section 16 of the new proposal (restore snapshot strategy, export/import inclusion, manual-slot reservation).
