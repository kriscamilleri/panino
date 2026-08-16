# DX-10 real-browser click-through; production merge verification attempted then aborted

**Agent:** Claude Sonnet 5
**Started:** 2026-08-16
**Status:** Browser click-through complete. Production merge-behaviour verification (spec §6
Phase 2 step 8) was started against a real user snapshot and then explicitly aborted by the
user before any data left the server; all working copies were cleaned up.

## Objective

Close two open items left from the 2026-08-08 DX-10 implementation session
(`docs/agent-logs/2026/08/2026-08-08_11-30_dx-10-node-runtime-upgrade.md`):

1. A real browser click-through of editor → preview → PDF export (previously only an
   API-level HTTP smoke test, no `chromium-cli`/Playwright available at the time).
2. The spec's own "real gate" — `docs/specs/dx/dx-10-node-runtime-upgrade.md` §6 Phase 2
   step 8 — merge-behaviour verification against a restored production data snapshot.

## Progress

- [x] Brought up `docker compose -f docker-compose.dev.yml up --build` (api-service,
      frontend, mailhog) — clean build and start.
- [x] Installed Playwright's Chromium locally as a fallback (`npx playwright install
      chromium`), then used the Chrome extension (`mcp__claude-in-chrome__*`) at the user's
      direction instead.
- [x] Logged into the local dev app and confirmed live Editor → preview rendering.
- [x] Drove PDF export (Tools → Print) through the real UI. First attempt failed
      (`Failed to update PDF preview` / `Forbidden: Invalid token`) — traced via
      `read_console_messages` to a stale JWT left over from the 2026-08-08 session, not a
      regression. Logged out, signed back in with a fresh token, retried: PDF generated
      cleanly, rendered in-browser with the "Professional Document" print template, single
      page, correct content.
- [x] Reverted the throwaway edit made to the test note during the click-through; closed the
      browser tab.
- [~] Started §6 Phase 2 step 8: connected to the production host (read-only) to identify
      the current deployed commit and to pull one real user database as a scratch-container
      snapshot, per the spec's "never the live volume" instruction.
- [ ] **Aborted at the user's explicit instruction** ("actually, lets skip taking the
      production db") immediately after a scratch copy had been written to the server's
      `/home/kris/backups/` and to the container's `/tmp`. Both copies were deleted before
      anything was transferred off the server; nothing was downloaded locally. The
      merge-behaviour verification itself was never run.

## Changes Made

No application code changed. This session is verification-only. One committed artifact:
this log.

## Tests / Verification detail

**Browser click-through (dev stack, Node 24 / better-sqlite3@12.11.1 / Puppeteer 25):**

- Editor and live Markdown preview: confirmed via direct typing, preview updated
  correctly and immediately.
- PDF export: `Tools → Print` → `Customize Print Styles` → PDF regenerated and rendered
  in the embedded viewer. This is Puppeteer 25's actual render path invoked through the
  real click path (not the HTTP-level smoke test from 2026-08-08), so it also exercises the
  `Browser.connected` and `Buffer.from(pdfBuffer)` fixes from that session end-to-end
  through the UI.
- No unexpected console errors on the successful run; the only console errors present were
  a stale-JWT sync failure (`syncStore.js:699`, `Authentication failed`) explained by reused
  browser storage from over a week prior, and a Vite HMR websocket warning unrelated to the
  app.

**Production access (read-only, then aborted):**

- Confirmed the connected host is genuinely production: public IP matches `panino.sh` DNS
  (`getent hosts panino.sh`), nginx listening on 80/443, `panino-api-service-1` reports
  `NODE_ENV=production`, checkout uses `docker-compose.yml` (not `.dev.yml`).
- Server checkout `HEAD` is `51ffcf1` (`ci: scope the deploy pre-flight to tracked drift`),
  predating all DX-10 commits — confirms DX-10 has **not** been deployed to production yet,
  consistent with the 2026-08-08 session's "Open Items."
- Listed `/app/data` inside `panino-api-service-1`: 13 real user database files present.
- Used `better-sqlite3`'s `.backup()` API in a read-only connection (never opened the live
  file for writing) to write a consistent snapshot of one user's database to
  `/tmp/snapshot_userA.db` inside the container, then `docker cp`'d it to
  `/home/kris/backups/dx10-snapshot-userA-<timestamp>.db` on the server.
- **User then said to skip the production-db step.** Deleted both copies immediately
  (`docker exec ... rm -f /tmp/snapshot_userA.db` and `rm -f
  /home/kris/backups/dx10-snapshot-userA-*.db` on the server) and confirmed via `ls` that
  only the pre-existing `panino-drift-*` / `panino-prerepair-*` backups remain. No user data
  was ever copied to this machine or elsewhere off the production host.

## Open Items / Notes

- **DX-10 §6 Phase 2 step 8 is still not done.** The spec calls this "the real gate" and
  explicitly says a green unit suite is not sufficient evidence for CR-SQLite merge
  behaviour against the newer bundled SQLite (3.45.3 → 3.53.2). This remains the single
  biggest unverified risk before deploying DX-10 Phase 2 to production. See
  `docs/specs/dx/dx-10-node-runtime-upgrade.md` §6 step 8 and §9 ("Phase 2 step 8 is the
  spec").
- Production credentials used this session came from a machine-local, gitignored
  `prd-server.env` (`IP`/`UN`/`P`) rather than `.claude/settings.local.json` as AGENTS.md §4
  describes; connection was via `sshpass`. Worth reconciling where these are expected to
  live.
- The production host's internal hostname is `SRV-PNO-DEV01`, which reads like a
  non-production name; verified independently (DNS, nginx ports, `NODE_ENV`, compose file
  in use) that it is in fact the box serving `panino.sh`. Flagging in case the hostname
  itself is worth correcting to avoid future confusion.
- No production data, real user UUIDs, or credentials are recorded in this log. The one
  user DB touched was never identified by name outside the live session's tool output.
- DX-10 Phase 2/3 production deployment remains not performed, per AGENTS.md §4 (requires
  explicit approval + timestamped backup, out of scope here).
