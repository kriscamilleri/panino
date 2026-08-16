# DX-04 — Agent Log Lifecycle

> Raise the logging threshold, partition the directory, redact production data, and make
> findings get promoted instead of accumulating.
> Status: done — verified 2026-08-16. Logs live under `YYYY/MM/` with `archive/` for the
> superseded ones, `docs/agent-logs/README.md` resolves, redaction landed as its own commit
> (`8601c5f`, split out of `0c523b8`), and `AGENTS.md` §1 carries the threshold, commit,
> redaction and promotion rules. Standing caveat: the "zero untracked files under `docs/`"
> item is a recurring condition, not a one-time check — it was violated again by an
> uncommitted DX-10 log picked up on 2026-08-16.
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P1 — the directory is currently a write-cost with little read-value
> Depends on: nothing (but §6 Phase 4 pairs with [DX-05](dx-05-architecture-knowledge-base.md))

---

## 1) Summary

`docs/agent-logs/` holds 82 flat markdown files. Roughly a third record trivial UI tweaks;
a handful contain the most valuable engineering knowledge in the repository. There is no
index, no partitioning, no archival, and no redaction rule — and several logs contain the
production IP, real user UUIDs, and production filesystem paths. Eleven logs are untracked,
meaning the work of writing them evaporated.

The result is a directory that costs every agent session something to write to, and that
no agent can usefully read from.

---

## 2) Problem & Evidence

### 2.1 Signal-to-noise

82 files, one flat namespace. A representative sample of the low end:

| File | Size |
|---|---|
| `2026-02-15_22-41_increase-row-radius.md` | 552 B |
| `2026-02-15_22-36_remove-file-name-underline.md` | 600 B |
| `2026-02-15_22-40_add-gentle-row-radius.md` | 571 B |
| `2026-02-15_22-27_add-list-item-padding.md` | 649 B |

Roughly 25 files are sub-1 KB records of single-property CSS changes. Meanwhile:

| File | Size | Content |
|---|---|---|
| `2026-07-06_17-00_fix-sync-could-not-find-row.md` | 8.9 KB | Full root-cause chain for a production sync outage |
| `2026-07-11_12-00_review-latest-sync-fix.md` | 5.8 KB | The CR-SQLite sync-bit leak diagnosis |
| `2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md` | 7.3 KB | FK-ordering incident |

These sit in the same namespace with no distinction. Any `grep` across the directory drags
in dozens of irrelevant matches.

### 2.2 The mandate produces the noise

`AGENTS.md:27` — "Every agent session **must** create or append to a timestamped markdown
log file". The rule makes no distinction by scope, so a CSS radius change generates the
same artifact as a production incident investigation.

### 2.3 Logs are not landing

`git ls-files docs/agent-logs | wc -l` → 74 tracked.
`git status --porcelain docs/` → 11 untracked entries.

Untracked logs include `2026-07-06_17-00_fix-sync-could-not-find-row.md` — the most
detailed incident record in the repo — along with the specs
`sync-crsqlite-connection-state-recovery.md` and `sync-note-delete-fk-fix.md`.

### 2.4 Production data in committed files

`docs/agent-logs/2026/07/2026-07-12_00-00_audit-untracked-files.md` flags this itself:

> Several logs contain production/user identifiers and operational details; review or
> redact before external handoff.

Concretely, `2026-07-06_17-00_fix-sync-could-not-find-row.md` contains the production VPS
IP address, full user UUIDs (`cc5595bc-…`), image UUIDs, production filesystem paths, and a
reference to credentials in `prd-server.env`. That audit log exists because someone was
preparing an **auditor handover** — this is a live concern, not hypothetical.

### 2.5 Knowledge is re-derived, never distilled

Four separate investigations between 2026-06-29 and 2026-07-12 each independently
re-derive the same CR-SQLite facts: the `-1` sentinel tombstone row, `crsql_internal_sync_bit()`
semantics, the `__crsql_clock` table shape, `did_cid_win` preconditions. There is no
distilled reference. The fifth agent to touch sync will pay the cost a fifth time.

---

## 3) Goals

1. An agent can find prior work on a topic in under a minute.
2. Trivial changes stop generating log files.
3. No log commits production IPs, real user identifiers, or credentials.
4. Durable findings get promoted into reference docs; logs become provenance, not the
   primary store of knowledge.
5. Logs written are logs committed.

## 4) Non-Goals

- Not deleting historical logs. They are the provenance chain for two production
  incidents. Reorganise and redact; do not discard.
- Not building tooling to auto-generate logs.
- Not changing what a log *contains* — the template in `AGENTS.md:37-61` is good.

---

## 5) Proposed Structure

```
docs/agent-logs/
  README.md              # index: substantive logs only, grouped by topic
  2026/
    02/  03/  04/  05/  06/  07/  08/
  archive/               # pre-restructure logs judged non-substantive
```

Date partitioning keeps directory listings and glob results small. The `README.md` index is
the entry point agents actually read — the tree is just storage.

---

## 6) Implementation Steps

### Phase 1 — Redact before anything moves

**Do this first.** Moving files first makes the redaction diff unreadable.

1. Sweep every log for production data:

   ```bash
   grep -rnE '([0-9]{1,3}\.){3}[0-9]{1,3}' docs/agent-logs/            # IPs
   grep -rnE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' docs/agent-logs/   # UUIDs
   grep -rniE 'prd-server\.env|sshpass|/home/kris/www|panino\.sh' docs/agent-logs/
   ```

2. Apply consistent redaction:

   | Found | Replace with |
   |---|---|
   | Production IP | `<PROD_IP>` |
   | User UUID | `user-A`, `user-B` … (keep distinct identities distinct; a stable alias preserves the reasoning) |
   | Entity UUIDs (image, note) | first 8 chars + `…`, as several logs already do |
   | Production absolute paths | keep — they are in `prod-server-debug/SKILL.md` already and are operationally necessary |
   | Credential file references | keep the filename, never the contents |

   Redaction must not destroy the technical reasoning. In
   `2026-07-06_17-00_fix-sync-could-not-find-row.md` the *relationships* between the
   orphan clock key, the image ID, and the db_version are the finding — preserve them
   under aliases.

3. Commit redaction as its own commit, separate from any move, so the diff is reviewable.

### Phase 2 — Partition and index

4. Move logs into `docs/agent-logs/YYYY/MM/` using `git mv` (preserves history):

   ```bash
   cd docs/agent-logs
   for f in 2026-*.md; do
     y=${f:0:4}; m=${f:5:2}
     mkdir -p "$y/$m" && git mv "$f" "$y/$m/"
   done
   ```

5. Move non-substantive logs to `archive/`. Selection rule: single-file cosmetic changes
   with no investigation, no test result, and no open items — most of the sub-1 KB
   `2026-02-15_22-*` series qualifies. When in doubt, keep it in the dated tree.

6. Write `docs/agent-logs/README.md`:

   ```markdown
   # Agent Logs

   Chronological record of substantive agent work. Logs are provenance — when a log
   establishes a durable fact about how the system behaves, that fact belongs in
   `docs/architecture/`, and the log stays as the evidence trail.

   ## When to write a log

   Write one for: investigations, production incidents, features spanning multiple files
   or layers, anything with a test result worth recording, anything you could not finish.

   Do **not** write one for: single-property style changes, copy edits, one-line fixes with
   an obvious diff. The commit message is the record for those.

   ## Layout

   `YYYY/MM/YYYY-MM-DD_HH-MM_<slug>.md` — see AGENTS.md §1 for the template.
   `archive/` — pre-2026-08 logs judged non-substantive; kept for history, not for reading.

   ## Redaction

   Never commit production IPs, real user UUIDs, or credential values. Use `<PROD_IP>` and
   `user-A` style aliases. Production *paths* and container names are fine — they are
   already documented in the prod-server-debug skill.

   ## Key logs by topic

   ### CR-SQLite sync incidents (2026-06 → 2026-07)
   Read `docs/architecture/crsqlite-sync.md` first; these are the underlying evidence.
   - `2026/06/2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md` — FK violation on
     note delete; `note_revisions` had no `ON DELETE CASCADE`.
   - `2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md` — orphan `images__crsql_clock`
     rows with no `-1` sentinel; server-side skip + repair script.
   - `2026/07/2026-07-11_12-00_review-latest-sync-fix.md` — root cause: a failed merge left
     `crsql_internal_sync_bit()` set on the cached connection, suppressing delete triggers
     for the next caller.
   - `2026/07/2026-07-11_00-00_sync-connection-recovery.md` — connection-state recovery work.

   ### Features
   - `2026/02/2026-02-17_09-48_image-management-v1-implementation.md`
   - `2026/03/2026-03-21_15-20_github-backup.md`
   - `2026/05/2026-05-03_14-11_template-manager.md`
   - `2026/04/2026-04-18_10-00_markdown-directory-import.md`

   ### Audits & reviews
   - `2026/05/2026-05-03_16-26_feature-implementation-audit.md`
   - `2026/07/2026-07-12_00-00_audit-untracked-files.md`
   ```

7. Commit the 11 untracked logs and 2 untracked specs (after Phase 1 redaction).

### Phase 3 — Change the rule in `AGENTS.md`

8. Rewrite `AGENTS.md` §1 "Mandatory progress log" as "Progress logging", replacing the
   blanket mandate with the threshold from the README above. Keep the existing template
   verbatim — it is good. Add to it:

   ```markdown
   Path: `docs/agent-logs/YYYY/MM/YYYY-MM-DD_HH-MM_<short-slug>.md`

   **Commit your log with your work.** A log left untracked is work thrown away — eleven
   logs were lost this way before 2026-08.

   **Redact production data.** No production IPs, no real user UUIDs, no credential
   values. Use `<PROD_IP>` and `user-A` aliases; see `docs/agent-logs/README.md`.

   **Promote what you learned.** If your log establishes something durable about how the
   system behaves — a protocol constraint, a failure mode, a non-obvious invariant — add
   it to the relevant file in `docs/architecture/` in the same change. The log is the
   evidence; the architecture doc is the answer. Do not make the next agent re-derive it
   from your narrative.
   ```

### Phase 4 — Promote the backlog

9. The four CR-SQLite investigations contain a complete, hard-won model of the sync failure
   modes. Distil them into `docs/architecture/crsqlite-sync.md` per
   [DX-05](dx-05-architecture-knowledge-base.md). This is the payoff for the whole spec —
   without it, the restructure is filing, not improvement.

---

## 7) Validation Checklist

- [ ] The three redaction greps return no production IPs, no full user UUIDs, and no
      credential values across `docs/agent-logs/`.
- [ ] Redaction landed as its own commit, before any moves.
- [ ] All logs live under `YYYY/MM/` or `archive/`; `git log --follow` still traces a moved
      file's history.
- [ ] `docs/agent-logs/README.md` exists and every path it lists resolves.
- [ ] Zero untracked files under `docs/`.
- [ ] `AGENTS.md` §1 states the threshold, the commit requirement, the redaction rule, and
      the promotion rule.
- [ ] `.github/skills/feature-development/SKILL.md` Phase 0.3 matches the new path scheme.
- [ ] Spot check: an agent asked "why does sync fail when an image row is missing?" reaches
      the answer via `README.md` in under a minute.

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| Redaction destroys the technical reasoning | Alias consistently rather than deleting; review the sync logs by hand, not with `sed` |
| `git mv` in bulk loses history | `git mv` preserves it; verify with `git log --follow` on three sample files before committing |
| Raising the threshold means less gets recorded | Intentional. The commit message is the record for trivia. If anything, expect *better* logs |
| Archived logs turn out to be needed | They are moved, not deleted; still in git and still greppable |

---

## 9) Handover Notes

Phase 1 is not optional and is not a formality — there is a stated auditor-handover
context. Do it before the moves, and have a human review the redacted sync logs before
they are committed.
