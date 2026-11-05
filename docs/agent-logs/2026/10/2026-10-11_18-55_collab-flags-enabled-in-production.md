# Shared spaces and live sessions enabled in production

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-11 18:52 (+02:00)
- Status: both flags on; this log is on `docs/collab-deploy-log`, not on `main`

## Objective

After the flags-off deploy the developer did not see the Spaces UI (expected: the flag was off)
and instructed, in this conversation, "flag them both on": `SHARED_SPACES_ENABLED` and
`LIVE_SESSIONS_ENABLED`. `CONTENT_MERGE_WRITEBACK_ENABLED` was not part of that and stays false.

## Changes made on production

Two edits to the server's untracked `.env`, each preceded by a database backup and a copy of the
file, each followed by recreating the `api-service` container (`docker compose up -d`, no
rebuild). `prod-server-debug` was loaded; nothing else on the server was written.

| Time (UTC) | Change | Copy of `.env` before it | Database backup before it |
|---|---|---|---|
| 16:53:15 | appended `SHARED_SPACES_ENABLED=true` | `.env.bak.20261011165314` | `panino-databases-20261011T165249Z.tar.gz` |
| 16:57:31 | appended `LIVE_SESSIONS_ENABLED=true` | `.env.bak.20261011165730` | `panino-databases-20261011T165710Z.tar.gz` |

Both backups were checksum-verified and staged with the restore tool (14 files, 0 spaces). After
each edit the file was compared with its copy: every earlier byte unchanged, one line added.
The copies follow the naming already used on the server and are untracked, so they do not
block a deploy.

After each recreate: container running with no restarts, both data volumes at the same mounts,
the flag present in the container's environment, no error line in the API log, a client's
WebSocket reconnected and authenticated, the site answering 200 and the API 401 without a token.

To turn either off again: remove its line from `.env` (or put back the matching copy) and
recreate the container. Spaces and recovery rows are kept while a flag is off.

## Why live sessions came four minutes after spaces

`docs/runbooks/live-session-recovery.md` allows the live flag only after its isolated two-account
checks. Earlier browser runs covered joining, typing, saving, a conflicting save and reconnecting
through a dropped connection, but never an API that is killed mid-session. I wrote that scenario
and ran it twice on the isolated stack (styled app, both flags on, the image built from the
deployed backend) before the second edit.

| Check | Result |
|---|---|
| API killed (`docker kill`) with everything acknowledged: both members show reconnecting, text stays on screen | pass |
| After a restart both are back in the session with all acknowledged text, once | pass |
| The session carries on (typing reaches the other member, two participants) | pass |
| Text typed at the instant of a kill, and by both members while the API is down, is held as unsent | pass |
| After the restart all of it arrives exactly once in both editors | pass |
| A second kill straight after loses nothing | pass |
| The recovered session saves; the stored Document has every piece once | pass |
| A member removed during a session is put out of it; what they type afterwards does not reach it; the space leaves their device and the message names nothing | pass |
| Requesting deletion closes every session at once (two connections) | pass |

11 of 11 checks, both runs.

## Things production now depends on

- **A restart interrupts live sessions.** Docker gives the API 15 seconds to save and stop. A
  client waits 30 seconds for the server before it gives up on a session and leaves the text on
  screen to copy; the socket retries after 1, 2, 4, 8 and 16 seconds. The deploy on this day had
  the API down for about one second.
- **Invitation and verification mail now go out through the production mail account.** I did not
  send a test message. Password resets use the same account.
- **No account is verified yet** (0 of 12), so "Invitations to you" is empty for everyone until
  they use "Verify my email" or open an invitation link.
- **Code behind these flags is no longer inert.** A change to it reaches users on the next deploy.

## Open Items

- Not done by a person yet: creating a space, inviting a second account, and a live session, on
  production.
- The recovery scenario lives in the session's scratch directory, not in the repository.
- On this machine: two more archives and their staged copies under `~/backups/panino/`
  (`preflags-20261011T165249Z/`, `prelive-20261011T165710Z/`), holding real user data.
- Still open from earlier logs: rotating the production SSH password; a second reader for the
  verify-email and copy-or-move changes.
