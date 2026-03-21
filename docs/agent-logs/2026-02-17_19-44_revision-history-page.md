# Move Revision History to Dedicated Page

**Agent:** GitHub Copilot (GPT-5.3-Codex)
**Started:** 2026-02-17 19:44
**Status:** completed

## Objective
Move Revision History from the side panel to its own page, accessible with other tools like Images and Variables.

## Progress
- [x] Gathered frontend routing/navigation/revision UI context
- [x] Add revisions page route and page component
- [x] Remove side-panel-only revision toggles from view menu/content area
- [x] Add tools navigation entry for Revision History
- [x] Run frontend validation checks

## Changes Made
- `frontend/src/router.js` — Added dedicated `/revisions` route (`RevisionHistoryPage`).
- `frontend/src/pages/RevisionHistoryPage.vue` — New standalone Revision History page under account-style layout.
- `frontend/src/components/RevisionPanel.vue` — Converted panel to support standalone mode and moved compare toggle into panel-local state.
- `frontend/src/components/ContentArea.vue` — Removed embedded right-side revision panel from the editor/preview split view.
- `frontend/src/components/SubMenuBar.vue` — Removed View-menu revision toggles; added Tools-menu `Revisions` navigation button.
- `frontend/src/components/MobileMenu.vue` — Added mobile quick access button for Revisions.
- `frontend/src/store/uiStore.js` — Removed obsolete persisted `showRevisionHistory/showRevisionCompare` toggle state.

## Tests
- Ran `npm test` in `frontend` — passed (`5` files, `22` tests).

## Open Items / Notes
- Keep scope minimal: migrate existing RevisionPanel UI into a dedicated page and wire navigation consistently with existing tool routes.

---

## Session Update — 2026-02-17 19:53

**Status:** completed

### Objective
Strengthen revision-history test coverage for reliability, especially revision open/close lifecycle behavior and backend edge conditions.

### Changes Made
- `backend/api-service/tests/integration/revision.test.js`
	- Added duplicate-manual-save test (`duplicate-latest` response + revision count invariant).
	- Added revision-to-note ownership guard test (detail fetch with mismatched note/revision returns `404`).
	- Added cursor tie-break pagination test (`before` + `beforeId` correctness when `created_at` ties).
	- Added optimistic concurrency conflict test (`expectedUpdatedAt` mismatch returns `409`).
- `backend/api-service/tests/integration/sync.revision.test.js`
	- Added last-write-wins extraction test for multiple `content` changes in one sync payload.
	- Added rapid-sync throttle test asserting max one `auto` revision within throttle window.
- `frontend/tests/unit/revisionStore.test.js`
	- Added open/close lifecycle test: opening a revision detail then `resetState()` clears selection/cache, and reopening refetches detail.
	- Added restore-refresh lifecycle test: selection is cleared when refreshed list no longer contains previously opened revision.

### Tests
- Ran `npm test -- tests/integration/revision.test.js tests/integration/sync.revision.test.js` in `backend/api-service` — passed (`14` tests).
- Ran `npm test -- tests/unit/revisionStore.test.js` in `frontend` — passed (`5` tests).

### Notes
- Backend logs still show expected controlled error output for the corrupt-gzip `422` test case; behavior is validated and non-fatal.

---

## Session Update — 2026-02-17 20:27

**Status:** completed

### Objective
Add explicit continuity coverage for opening a revision, restoring, and reopening the same revision ID.

### Changes Made
- `backend/api-service/tests/integration/revision.test.js`
	- Added `keeps source revision readable after restore so it can be reopened`:
		- Open detail for source revision
		- Restore from that revision
		- Reopen same revision ID and verify content is unchanged/available
- `frontend/tests/unit/revisionStore.test.js`
	- Added `reopens the same revision id after restore by refetching detail`:
		- Open detail
		- Restore (which refreshes list and clears selected state)
		- Reopen same revision ID and verify detail content is loaded again reliably

### Tests
- Ran `npm test -- tests/integration/revision.test.js` in `backend/api-service` — passed (`9` tests).
- Ran `npm test -- tests/unit/revisionStore.test.js` in `frontend` — passed (`6` tests).

### Notes
- Frontend continuity intentionally validates **refetch-on-reopen** after restore refresh, matching current store behavior where reset list loads clear detail cache.

---

## Session Update — 2026-02-17 20:29

**Status:** completed

### Objective
Confirm whether scheduled/throttled auto revision creation is tested, and fill any gap.

### Changes Made
- `backend/api-service/tests/integration/sync.revision.test.js`
	- Added `creates a new auto revision after throttle window has elapsed`:
		- Seeds an existing `auto` revision at `now - 6 minutes`
		- Sends a new sync content change
		- Verifies a second `auto` revision is created (count becomes `2`)

### Tests
- Ran `npm test -- tests/integration/sync.revision.test.js` in `backend/api-service` — passed (`7` tests).

### Notes
- Coverage now includes both sides of throttled creation behavior:
	- within window → skip (`max 1 auto`)
	- after window → create new auto revision
