# Revise Calendar Sync Spec

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 11:40
**Status:** completed

## Objective
Clarify whether note edits can affect unrelated external calendar events that happen to share the same date and time.

## Progress
- [x] Read the existing calendar sync spec
- [x] Clarify event ownership and collision behavior in the spec
- [x] Review wording and finalize notes

## Changes Made
- `docs/specs/calendar-sync.md` — clarified that Panino only updates events it created and linked, and never adopts unrelated external events just because the date/time matches.
- `docs/agent-logs/2026-03-22_11-40_revise-calendar-sync-spec.md` — session log for this spec revision.

## Tests
- Not applicable yet — documentation update only.

## Open Items / Notes
- Docs-only change; no code or test execution required.

---

## Follow-up — 2026-03-22 11:42

**Objective**
Clarify where a user can open a synced calendar event from within Panino.

**Progress**
- [x] Review the current spec for user-facing event access
- [x] Define the in-note access pattern for opening synced events
- [x] Update supporting data/API details needed for the link flow

**Changes Made**
- `docs/specs/calendar-sync.md` — added a user-facing `Open in Google Calendar` / `Open in Outlook` action in the note UI, plus supporting `external_event_url` storage and an optional redirect endpoint.

**Tests**
- Not applicable — documentation update only.

**Open Items / Notes**
- Current spec direction is that event access lives on the note itself, alongside the synced calendar metadata, not in Settings.

---

## Follow-up — 2026-03-22 11:43

**Objective**
Revise the spec so synced event access is embedded into the note text rather than exposed as a separate UI element.

**Progress**
- [x] Review the newly added event access direction
- [x] Replace UI-action language with document insertion behavior
- [x] Update supporting storage details for maintaining inserted links

**Changes Made**
- `docs/specs/calendar-sync.md` — replaced the separate in-note open button concept with a managed markdown link inserted into the note content, similar to image paste behavior.

**Tests**
- Not applicable — documentation update only.

**Open Items / Notes**
- Spec now assumes calendar sync is allowed to write a managed link artifact back into note content and keep it updated across re-syncs.

---

## Follow-up — 2026-03-22 11:46

**Objective**
Add a dedicated calendar reference management UI and pruning model, similar to image management.

**Progress**
- [x] Review the image management spec as the precedent
- [x] Add a dedicated calendar reference manager section
- [x] Define deletion, repair, dangling-reference states, and scheduled pruning

**Changes Made**
- `docs/specs/calendar-sync.md` — expanded the draft with a dedicated Calendar References manager UI, reference-health states, management endpoints, and a daily prune policy for dangling references.

**Tests**
- Not applicable — documentation update only.

**Open Items / Notes**
- The spec now combines two surfaces: managed links embedded in note content, plus a separate management UI for auditing and lifecycle control.

---

## Follow-up — 2026-03-22 11:55

**Objective**
Define the exact managed reference format and split implementation into backend and frontend tracks.

**Progress**
- [x] Specify the canonical document marker format for calendar reference blocks
- [x] Define managed-content rules for user edits and malformed blocks
- [x] Add an implementation split so backend and frontend work can proceed independently

**Changes Made**
- `docs/specs/calendar-sync.md` — added the canonical `panino:calendar-ref` block format, managed-content rules, and a backend/frontend implementation split.

**Tests**
- Not applicable — documentation update only.

**Open Items / Notes**
- The managed marker contract is now explicit enough to drive reference repair and pruning logic without guessing.