# Collaboration branch: second review round

- Agent: Claude Code (Opus 5.5), with six delegated review agents
- Started: 2026-10-10 11:00 (+02:00)
- Status: complete for the flag-off gate; flag-on gates and the production-copy drill remain

## Objective

Follow-up to `2026-10-10_10-40_collab-readiness-fixes.md`. The developer asked for five
things before `feature/collab` is merged with all three flags off:

1. drive the conflict resolve dialog by hand;
2. replace the per-sync scan of every Document, which was unmeasured at scale;
3. review the 24,000 changed lines by dividing them among agents;
4. security-review the server code that loads even with the flags off;
5. reproduce the suspected whole-API stall on a held database lock and revise the lock
   strategy if it is real.

## Progress

- The resolve dialog was driven with real clicks in scripted Chromium at 1280 and 375 px
  wide, in five scenarios: clean candidate, overlapping region kept as mine, as theirs,
  cancel and reopen, and a newer remote edit arriving while the dialog is open.
- The scan was measured at 5,000 Documents: 1,248 ms per idle sync, and a merge-base row for
  every Document on every device. Merge bases are now kept only for Documents with an edit in
  flight, and a sync that changed nothing does no follow-up work (5 ms). A single transaction
  larger than one request is uploaded in slices.
- The lock stall is real. A write lock held on `_users.db` for 6 s from outside the process
  delayed a login by 5.2 s and an unrelated `/sync` by 4.7 s, and a lock during a WebSocket
  handshake crashed the process. The wait is now 250 ms in the service, a still-locked
  request gets a retryable 503, and `_users.db` uses write-ahead logging.
- Six agents each read one slice of the branch (sync store and merge; editor and conflict UI;
  spaces and invitations; live sessions; database, WebSocket and start-up; deploy, backup and
  CI) and reported defects with reproduction steps. Each report was triaged here; nothing was
  accepted without being reproduced or read in the code.
- Fixing one of those findings (typing during a stored conflict was silently discarded)
  exposed a defect in this session's own earlier work: the code that keeps a stored conflict
  in step assumed the held body was always this device's. After a local win it is the other
  device's, and the next adopted change discarded it. The old code fails the new test for
  this; see "Stored conflicts" in `docs/architecture/crsqlite-sync.md`.
- Two crashes affect `main` as deployed today and were ported to the hotfix branch.

## Changes Made

Commits on `feature/collab`, oldest first:

| Commit | What |
|---|---|
| `1a62d10` | Lazy merge bases, no work on an idle sync, sliced upload cursor |
| `a79af9c` | Bounded lock waits, `503 DATABASE_BUSY`, write-ahead logging for `_users.db` |
| `7d8ea2f` | `/sync` authorization bypass through an object-valued `space`; transfer routes gated by the flag |
| `4e8f768` | WebSocket error listeners and `maxPayload`; `note_revisions` migration made restartable; start-up survives a failing `_spaces.db` |
| `950e529` | Editor and conflict fixes (below) |
| `216f6bb` | Deploy script, CI build job, backup and restore tooling, runbook |
| `5f2ccd3` | Merge of the hotfix branch (brings two regression tests) |

On `fix/sync-stranded-writes` (off `main`): `e4bcb5f`, the WebSocket and packed-key fixes for
the code that is in production now.

Client fixes in `950e529`:

- Text typed in the last half second before switching Documents or leaving the editor was
  dropped; it is saved, to the Document it was typed in.
- Client transactions on one database queue instead of nesting (`runExclusive`). A save that
  started during a remote apply used to fail and be lost.
- Stored conflicts are maintained by side (`planConflictAfterChange`), follow local saves and
  import overwrites, and pause editing of that Document until resolved.
- A stale draft of a Document opened earlier no longer raises a false conflict.
- Adopting a remote change keeps keyboard focus where it was and leaves an undo entry.
- Nested tree items can be moved after the root reload that follows a sync.
- Dashboard queries are bounded by the requested limit.

Operations fixes in `216f6bb`:

- `deploy.sh` failed its frontend build on a clean checkout (the shared package's dependency
  was never installed). Reproduced in a clean export; fixed through
  `scripts/build-frontend.sh`, which CI now runs too, together with the production image build.
- The backup tool could not back up the container that runs just before this release is
  deployed (new in-container path pinned, `_spaces.db` required). It now finds the data
  directory in either layout and accepts an estate without spaces.
- Re-verifying a staged restore failed on SQLite's `-wal`/`-shm` files. The runbook's
  installed-set check could not be run against two volumes and its install step would have
  displaced every personal image. `--verify-installed` and the rewritten runbook fix both.
- Maintenance scripts no longer treat `_spaces.db` as a user database.

## Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run test:shared` | 25 passed |
| `npm run test:fe` | 646 passed (55 files) |
| `npm run test:be` | 359 passed (29 files) |
| `./scripts/test-backend.sh` on `fix/sync-stranded-writes` | 184 passed (15 files) |
| `scripts/build-frontend.sh` in a clean export | builds; fails with the real error if `shared/` is skipped |

Scripted two-device Chromium, isolated stack (own ports, own Docker volumes, disposable
account), flags off:

| Check | Result |
|---|---|
| Type, then switch Document inside the save debounce | text saved and synced |
| Document opened earlier, edited twice elsewhere | adopted, no conflict, no base row left |
| Move a nested Document after reload and root refresh | moved |
| Remote change adopted while focus is in another field | focus and following keystrokes stay there |
| Typing in one Document while another receives six remote updates | nothing lost, no failed save |
| Conflict, other device won | both bodies held, editor read-only, keyboard/toolbar/replace/undo blocked with one notice, resolve gives both edits, typing works again, devices converge |
| Conflict, this device won, other device keeps editing | displaced edit still held after the later change is adopted; resolving brings it back |
| Conflict recorded while the user is typing | every character typed is in the record and in the result |
| Delete a Document that has a conflict | its conflict and base rows are removed |
| Previous release's image on data last written by this branch | login and `/sync` serve the same 12 Documents; forward again works |

Confirmed against the code before each fix: the new local-win conflict test fails on
`4e8f768` (record cleared); the new restore test fails on the previous validator ("Archive
entries do not exactly match the manifest"); on `main`, the malformed WebSocket frame raises
an unhandled error and the hex key string exits the test worker.

## Open Items / Notes

Not done, needs the developer:

- **Production-copy drill.** Start the new image on a copy of production data and confirm
  every database opens and migrates. Database opening is now fail-closed, and maintenance
  code only considers lowercase-UUID file names; neither has been checked against the real
  estate. Needs approval and a fresh backup.
- Nothing has been pushed.
- Personal images are in no backup, on this release or any before it.
- A page showing several stacked toasts can cover a dialog's buttons (seen when one action
  raised four). The editor now raises one notice per burst; the layout itself is unchanged.
- A Document deleted on another device takes an unsent local edit with it, as on `main`.

Accepted limits, documented in `docs/architecture/crsqlite-sync.md`:

- A third concurrent version of a Document that already has a stored conflict (two newest kept).
- Two insertions at the same point merge "clean" in an arbitrary order; relevant once
  `CONTENT_MERGE_WRITEBACK_ENABLED` is on.

Found by the review and **not fixed**, because they need a flag on. They block the gates
named, not this merge:

Shared spaces (`SHARED_SPACES_ENABLED`):

- An invitation can be redeemed by registering an unverified or case-variant copy of the
  invited address.
- Invitation email is an unthrottled relay: comma-separated recipients, no rate limit.
- Space images accept SVG: stored cross-site scripting for other members.
- Document transfer between libraries loses images in production (the link rewriter matches
  `/images/<id>`; production writes `/api/images/<id>`), ignores a live session on the
  Document, discards unsynced local edits, bypasses the image quota, and its state machine
  has dead ends with no cancel. Large transfers stall sync for everyone.
- Space deletion cannot be cancelled. Invites and transfers are unbounded.
- Several routes reveal whether a space or user exists.
- The invariant sweep runs over all spaces on every mutation; the connection cache is
  unbounded and opens eagerly.
- A removed member keeps a full local copy of the space, and the whole subscribe request is
  rejected after one revocation.

Live sessions (`LIVE_SESSIONS_ENABLED`):

- Undo and redo are not sent to other participants; leaving does not reset the editor;
  recoverable rejections drop the session; a theme change unbinds the editor from the session.
- Resolving a commit conflict can wipe or duplicate text. Emoji, IME input and CRLF line
  endings corrupt positions.
- Two tabs of one browser share a site id.
- No per-process cap on sessions; every update re-encodes the whole Document; the recovery
  sweep compresses synchronously.
- The Collaborate button is shown where it cannot work.
