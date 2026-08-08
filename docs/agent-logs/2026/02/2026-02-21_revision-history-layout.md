# Revision History Layout Redesign

**Agent:** GitHub Copilot
**Started:** 2026-02-21
**Status:** in-progress

## Objective
Replace AccountLayout with a full-viewport layout (matching StylesPage / PrintStylesPage) in RevisionHistoryPage.

## Progress
- [ ] Remove AccountLayout wrapper from RevisionHistoryPage.vue
- [ ] Use AccountNav + full-screen flex layout directly (mirrors StyleCustomizer)
- [ ] Verify RevisionPanel fills remaining viewport correctly

## Changes Made
- `frontend/src/pages/RevisionHistoryPage.vue` — replaced AccountLayout with direct AccountNav + full-screen layout

## Open Items / Notes
None.
