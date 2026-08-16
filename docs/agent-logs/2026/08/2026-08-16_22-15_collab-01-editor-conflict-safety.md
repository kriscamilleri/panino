# COLLAB-01 — Editor Conflict Safety

Agent: Zed coding agent
Start: 2026-08-16 22:15 +02:00
Status: In progress

## Objective

Implement COLLAB-01: stop the open editor from silently destroying remote edits. This is the
P0 active data-loss bug in the collaboration spec set and the permanent fallback path for
every later spec.

## Progress

- Read the canonical handbooks (`AGENTS.md`, `frontend/AGENTS.md`,
  `backend/api-service/AGENTS.md`) and the full COLLAB spec set.
- Traced the bug path: `syncStore.refreshData → structureStore.reFetchSelectedFile →
  selectedFile.value` replacement, with `Editor.vue`'s content watch keyed only on
  `file.value?.id`, so a same-id remote content change never reaches the open editor and is
  clobbered by the next `debouncedSyncToDB` (`docStore.updateFileContent`).
- Established the frontend baseline: `cd frontend && npm test` → 372 tests passing across 25
  files.

## Changes Made

_(in progress)_

## Tests

_(pending)_

## Open Items / Notes

- COLLAB-02 will promote the in-memory `draftStore` base to the durable `note_sync_base`
  table; the in-memory base in this spec is anticipated by that design.
- `docStore.isSaving` currently has no `.vue` consumer; this spec adds the first such surface.
