# Debug Auto Revision Capture Not Triggering

**Agent:** GitHub Copilot (GPT-5.3-Codex)
**Started:** 2026-02-17 21:49
**Status:** completed

## Objective
Reproduce and fix missing automatic revision creation when editing a document.

## Progress
- [x] Review latest revision-history agent logs for context
- [x] Reproduce issue via Chrome DevTools MCP
- [x] Trace backend sync-to-revision capture path
- [x] Implement root-cause fix
- [x] Run targeted backend tests
- [x] Re-verify behavior via Chrome DevTools MCP

## Changes Made
- `docs/agent-logs/2026-02-17_21-49_debug-auto-revision-capture.md` — Started investigation log.
- `backend/api-service/sync.js` — Fixed `parsePkId` to correctly decode note IDs from packed numeric-key PK objects sent by frontend sync payloads; prevents invalid `note_id` values during auto revision snapshot creation.
- `backend/api-service/tests/integration/sync.revision.test.js` — Added regression test `captures auto revision when note pk is sent as packed numeric-key object`.

## Tests
- Ran `npm test -- tests/integration/sync.revision.test.js` in `backend/api-service` — passed (`8` tests).
- Chrome DevTools MCP validation:
	- Reproduced failure before fix: `POST /sync` returned `500` with `SqliteError: FOREIGN KEY constraint failed` from `createRevisionSnapshot`.
	- After fix, same payload shape (`changes[].pk` as numeric-key object) returned `200`.
	- Revisions page shows new `AUTO` entry and detail content matches edited note text.

## Open Items / Notes
- Root cause: frontend sync sends packed PK as numeric-key object; previous parser converted it to `"[object Object]"`, causing invalid `note_id` on auto revision insert and FK violation.
