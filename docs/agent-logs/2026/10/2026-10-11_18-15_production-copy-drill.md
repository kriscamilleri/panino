# Production-copy drill for the collaboration branch

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-11 18:15 (+02:00)
- Status: complete; branch pushed; not merged

## Objective

The last open gate before merging `feature/collab` with both flags off: take a fresh production
backup and confirm that the new build opens and migrates every real database, that `main` can
take the data back, and that nothing in a library changes. The developer approved the push and
the drill in this conversation.

## Production access

Read-only, through the documented backup tool only (`prod-server-debug` skill loaded first):

| Step | What ran on production |
|---|---|
| `backup-production-databases.sh --list` | Names, sizes and modification times, summarised locally to counts |
| `backup-production-databases.sh` | One read-only online snapshot per database in the container's RAM disk, streamed out and removed |

No file on the server was written, nothing was restarted, and the API stayed up. Everything else
ran on this machine in containers with no network. Output was filtered so that no address and
no user id reached the terminal or this log.

## Result

The estate: 12 user databases, 16.5 MiB, the largest 10.6 MiB, all with lowercase-UUID names, no
shared-space data. 533 Documents, 147 folders, 383 image rows, 710 revisions.

| Check | Result |
|---|---|
| Archive checksum, 14 entries, manifest present | pass |
| Staged and validated by the new restore tool (after the fix below) | 13 files, 0 spaces, every database intact |
| New build opens and migrates every database | 12/12, slowest 12 ms; content schema 2 and revision actor columns on all |
| Change tracking works on each (a tracked write, rolled back) | 9/9 libraries with Documents; 3 are empty |
| Maintenance code sees every database | 12 keys for 12 files |
| Authentication database | switched to write-ahead logging; `email_verified_at` and `email_verifications` added; 12 users, none verified |
| Every stored address is one mailbox; none differ only by case | 12/12; 0 |
| Shared-space metadata database | created at schema 3 with `keep_source` |
| New API, flags off: `/me` and a full `/sync` pull as every account | 12/12 answer 200; slowest pull 26 ms; largest reply 2 MiB |
| Flag-gated routes (`/spaces`, `/space-transfers`, `/space-invitations`, `/account/email-verification`) | 404 for every account |
| Revision maintenance pass at start-up | no errors; 710 revisions before and after |
| **Rollback:** `main`'s build on the migrated copy | 12/12 answer 200; same Documents and changes per account as the new build |
| New build again after `main` ran | 12/12 open |
| Documents, folders and images compared with the backup at every stage | identical in 12/12 |

CI on the pushed head (`46aadce`): lint, shared, frontend, backend and build all pass. The
`shared` and `build` jobs ran on GitHub for the first time.

## Found by the drill

**The restore tool's documented command did not work.** `stage-production-restore.mjs --archive
… --staging-dir …` failed with "archivePath and stagingDir are required" whatever it was given:
the command line passed its parsed flags (`archive`, `checksum`) to a function whose parameters
are `archivePath` and `checksumPath`. Every test called the functions; none ran the command. Its
first use on a real archive was this drill. Fixed, with tests that run the tool as a process for
all three modes. `--verify-dir` and `--verify-installed` were not affected.

**A rehearsal must run without a network and with a different secret.** A `/sync` from an account
with GitHub backup configured starts that account's daily backup (this is the same on `main`).
Two accounts have it. The pull I sent as each account triggered it; it failed at decrypting the
stored token, because the drill's secret is not production's, and the containers had no network
in any case. Had the copy been run with production's secret and a network, the rehearsal would
have pushed two users' Documents to their repositories. The runbook now has a rehearsal section
that says so. In the working copy those two accounts' backup settings now record a failed backup.

## Observed in the data, not caused by this branch

One Document in one account has change-tracking entries only for its text and modification
time: no title, no creation time, no owner. A full pull offers 36 of that account's 37 rows,
under both builds. This is the shape the stranded-upload defect leaves (a device uploaded an
edit but never the creation), which `fix/sync-stranded-writes` (in this branch) addresses by
having each device offer its own changes again on first sync. It may heal then; I did not verify
that it will, and nothing was changed.

## Changes Made

- `scripts/production-database-backup/stage-production-restore.mjs`: the command line maps its
  flags to the function's parameters; staging refuses `--data-dir`/`--uploads-dir`.
- `backend/api-service/tests/unit/production-restore.test.js`: three tests that run the tool as a
  command (18 in the file).
- `docs/runbooks/deployment.md`: "Rehearse a release on a copy of production".

## Tests

| Command | Result |
|---|---|
| `./scripts/test-backend.sh tests/unit/production-restore.test.js` | 18 passed |
| `npm run lint` | clean |
| CI on `46aadce` | 5 of 5 jobs pass |

## Open Items / Notes

- **Not merged.** Merging is the developer's, and a push to `main` deploys.
- Not rehearsed: the deploy script itself. It runs only on the server, during a deploy.
- Not covered by any backup, as before: personal images.
- Left on this machine, holding real user data, for the developer to remove when done:
  `~/backups/panino/panino-databases-20261011T161715Z.tar.gz` with its checksum, and
  `~/backups/panino/drill-20261011T161715Z/` (`staging/`, `work/`, `inspect/`, `reports/`). The
  reports hold counts and digests only. Two stopped drill containers hold no data.
- Still open from earlier logs: rotating the production SSH password; the scripted checks that
  produced these numbers live in the session's scratch directory, not in the repository.
