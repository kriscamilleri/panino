# Agent Logs

Chronological record of substantive agent work. Logs are provenance — when a log establishes
a durable fact about how the system behaves, that fact belongs in `docs/architecture/`, and
the log stays as the evidence trail.

## When to write a log

Write one for investigations, production incidents, features spanning multiple files or
layers, anything with a test result worth recording, and anything you could not finish.

Do not write one for single-property style changes, copy edits, or one-line fixes with an
obvious diff. The commit message is the record for those.

## Layout

`YYYY/MM/YYYY-MM-DD_HH-MM_<slug>.md` — use the template in `AGENTS.md` §1.

`archive/` contains pre-2026-08 logs judged non-substantive. They remain in git for history,
but are not part of the normal investigation context.

## Redaction

Never commit production IPs, real user UUIDs, or credential values. Use `<PROD_IP>` and
`user-A` style aliases; credential file names may be mentioned without their contents.
Production paths and container names are operational context and may remain.

## Key logs by topic

### CR-SQLite sync incidents (2026-06 → 2026-07)

Read [`docs/architecture/crsqlite-sync.md`](/home/kris/Development/panino/docs/architecture/crsqlite-sync.md)
first; these logs are the underlying evidence.

- `2026/06/2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md` — FK violation on note
  delete; `note_revisions` had no `ON DELETE CASCADE`.
- `2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md` — orphan
  `images__crsql_clock` rows with no `-1` sentinel; server-side skip and repair tooling.
- `2026/07/2026-07-11_12-00_review-latest-sync-fix.md` — root cause: a failed merge left
  `crsql_internal_sync_bit()` set on the cached connection, suppressing delete triggers for
  the next caller.
- `2026/07/2026-07-11_00-00_sync-connection-recovery.md` — connection-state recovery work.

### Features

- `2026/02/2026-02-17_09-48_image-management-v1-implementation.md`
- `2026/03/2026-03-21_15-20_github-backup.md`
- `2026/05/2026-05-03_14-11_template-manager.md`
- `2026/04/2026-04-18_10-00_markdown-directory-import.md`

### Audits and reviews

- `2026/05/2026-05-03_16-26_feature-implementation-audit.md`
- `2026/07/2026-07-12_00-00_audit-untracked-files.md`

## Promotion rule

When an investigation establishes something durable about how the system behaves, promote it
to the relevant file in `docs/architecture/` in the same change. The log is the evidence; the
architecture document is the answer.
