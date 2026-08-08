# Investigate large database size for test agent

**Agent:** GPT-5.3-Codex
**Started:** 2026-02-15 21:48
**Status:** completed

## Objective
Determine why the account database size appears large when logged in as the test agent.

## Progress
- [x] Locate account DB-size calculation in backend and display in frontend
- [x] Measure per-user DB size totals from local data files
- [x] Break down test agent DB into `.db`, `-wal`, and `-shm`
- [x] Inspect table counts for the test agent DB
- [x] Identify root cause and prepare explanation

## Changes Made
- `docs/agent-logs/2026-02-15_21-48_investigate-test-agent-db-size.md` — added investigation trail and findings.

## Tests
- Ran Node inspection scripts in `backend/api-service` to map users to DB size and inspect table counts.
- Verified test agent size contributors via file-level breakdown:
  - `.db`: 163840 bytes
  - `-wal`: 774592 bytes
  - `-shm`: 32768 bytes

## Open Items / Notes
- Current backend size metric intentionally sums `.db` + `-wal` + `-shm` (`getUserDbSizeBytes` in `backend/api-service/db.js`).
- For test agent, the WAL file dominates reported size; this reflects uncheckpointed write-ahead log pages rather than only durable base-file payload.
- If desired, add a second metric that reports only base DB size (`.db`) or trigger WAL checkpoint before reporting.
