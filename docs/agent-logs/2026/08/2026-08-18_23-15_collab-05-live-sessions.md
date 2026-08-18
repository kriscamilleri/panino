# COLLAB-05 live sessions

- **Agent:** Codex
- **Started:** 2026-08-18 23:00 +0200
- **Status:** In progress — implementation and pre-rebase validation complete; rebase pending

## Objective

After both mandatory feasibility gates passed, implement explicit online live editing for shared
Documents without creating a second replicated source of truth. Preserve personal behavior and
keep shared spaces and live sessions disabled by default.

## Progress

- Added a space-only Yjs session manager to the existing versioned WebSocket connection.
- Added acknowledged crash recovery, restart replay cursors, reconnect/idle lifecycle, shutdown
  draining, recovery limits, and 30-day archive maintenance.
- Added the production OverType textarea binding, Pinia session state machine, participant/status
  UI, Save version confirmation, origin-scoped undo, and conflict resolution reuse.
- Wired membership, space deletion, and Document deletion cleanup into live sessions.
- Ran an isolated two-account browser drill with shared spaces and live sessions enabled only in a
  disposable Compose project. It covered invitation acceptance, shared Document creation, live
  convergence, qualified image rendering, explicit version save, two hard API crashes, and both
  acknowledged recovery and pre-ack replay.

## Changes Made

- `notes.content` remains plain CRR text. Save version performs one ordinary parameterized update,
  one `actor_kind='collab'` revision, then sends the existing space sync poke.
- Every inbound operation rechecks the authenticated account and owner/editor membership. Opening
  also requires the exact active space subscription. Unauthorized and missing targets share one
  response.
- Acknowledgements and rebroadcasts occur only after `collab_sessions` plus the participant cursor
  commit. Updates are base64, size/rate limited, and duplicate sequences are idempotent.
- Normal browser database saving and content-conflict handling pause while the Yjs binding owns the
  textarea. Reconnect buffers local updates; a hard timeout visibly disables editing while leaving
  text copyable.
- Browser validation exposed two cross-phase integration defects. Shared CR-SQLite uploads now
  project onto the server's exact public allowlist, preventing legacy `user_id` and server-owned
  profile/image deltas from rejecting a new shared Document batch. Development Markdown previews
  now resolve authenticated relative image URLs against the configured API origin instead of the
  frontend origin. SMTP authentication is omitted when development credentials are blank, restoring
  the documented MailHog flow.

## Tests

- Backend focused integration: 7 live-session tests passed, covering convergence, durable ack,
  replay/duplicate handling, malformed input, non-disclosure, merge/conflict, feature flag,
  immediate revocation, revision attribution, and graceful shutdown.
- Backend schema focus: 38 database tests passed with space-only content schema v2 coverage.
- Aggregate `npm test`: shared 25/25, frontend 49 files / 501 tests, and Dockerized backend
  26 files / 307 tests passed.
- `npm run doctor`, root `npm run lint`, `git diff --check`, and the frontend production build passed.
  Vite reported only the repository's existing mixed static/dynamic import and large-chunk warnings.
- Isolated browser validation passed on Chromium at 1280×800 and 375×812. Both participants showed
  the server-derived roster and zero unsaved changes; the qualified image completed with non-zero
  intrinsic width; a committed marker survived SIGKILL/restart; and a locally generated update made
  while the API container was paused replayed after the paused process was killed and replaced.
  No page or console errors were emitted. The isolated containers, volumes, override, and screenshots
  were removed after inspection; normal development/production data and flags were untouched.
- Shared outbound-projection regression: `frontend/tests/unit/syncRegistry.test.js` passed (16 tests).
- Post-review focused checks passed: 22 frontend tests for live state, sync projection, and image URLs;
  targeted frontend/backend ESLint; and the backend automatic-conflict recovery integration test.

## Open Items / Notes

- Run full backend/root validation, deliberately rebase onto `origin/main`, and repeat validation
  before opening the PR.
- Dependency installation reported existing audit findings; no breaking force-fix was run.
