# DX-05 — Architecture Knowledge Base

> Distil four re-derived investigations into durable reference docs, so agents stop paying
> the same discovery cost repeatedly.
> Status: proposed
> Created: 2026-08-08
> Last updated: 2026-08-08
> Priority: P1 — highest-value single document in the set is `crsqlite-sync.md`
> Depends on: nothing
> Blocks: [DX-03](dx-03-agent-instruction-architecture.md) Phase 4 (needs these files to exist before trimming `AGENTS.md`)

---

## 1) Summary

The repo documents what it *plans* to build (`docs/specs/`) and what agents *did*
(`docs/agent-logs/`), but not how the system actually works. The gap is most expensive
around CR-SQLite sync, where four separate investigations over two weeks each
independently re-derived the same protocol facts — and where both 2026 production
incidents originated.

This spec creates `docs/architecture/` and populates it, starting with the sync document.

---

## 2) Problem & Evidence

### 2.1 The same facts, derived four times

| Date | Log | Facts re-derived |
|---|---|---|
| 2026-06-29 | `investigate-sync-500-fk-on-note-delete.md` | CRR vs local table distinction; `merge_delete` timing inside the apply transaction |
| 2026-07-06 | `fix-sync-could-not-find-row.md` | `-1` sentinel tombstone rows; `__crsql_clock` shape; `did_cid_win` preconditions; `get_local_cl_stmt` COALESCE behaviour |
| 2026-07-11 | `review-latest-sync-fix.md` | `crsql_internal_sync_bit()` semantics; delete-trigger `WHEN` guard; connection caching interaction |
| 2026-07-11 | `sync-connection-recovery.md` | Connection-state invalidation |

The 2026-07-06 log records an agent reading CR-SQLite's Rust source
(`rs/core/src/changes_vtab_write.rs`, `tableinfo.rs:306-324`) to establish the failure
precondition. That is expensive work, done once, stored only as narrative inside a log
file that is not indexed.

### 2.2 The knowledge is load-bearing and non-obvious

The final root cause is a genuinely subtle interaction:

> A failed CR-SQLite merge leaves `crsql_internal_sync_bit()` set to `1` on the **cached**
> per-user connection after rollback. The `images` delete trigger is guarded by
> `WHEN crsql_internal_sync_bit() = 0`, so the next ordinary `DELETE` on that same cached
> connection — in this case the daily orphan-image prune, a full day later — deletes the
> base row without writing a `-1` tombstone. A client sync days after that hits the orphan
> clock row and fails with `could not find row to merge with`.

Nothing in `AGENTS.md`, either layer file, or any spec would let an agent anticipate this.
It spans connection caching, trigger guards, transaction rollback semantics, and a
background job — four areas no single file currently connects.

### 2.3 Specs are the wrong home for it

`docs/specs/active/sync-crsqlite-connection-state-recovery.md` and
`docs/specs/shipped/sync-note-delete-fk-fix.md` describe *changes to make*. Once implemented, they
describe a past state. An agent reading them cannot tell which parts are current
behaviour. (See [DX-07](dx-07-spec-lifecycle.md) — every spec in the repo currently says
`Status: Draft`, including shipped ones.)

---

## 3) Goals

1. An agent modifying `sync.js` or `db.js` can learn the failure modes before writing code,
   from one file, in one read.
2. Each durable fact has exactly one home.
3. `AGENTS.md` has somewhere to move its reference sections (DX-03 Phase 4).
4. A documented, low-friction promotion path from log → architecture doc.

## 4) Non-Goals

- Not documenting every module. Start where the cost is proven: sync, then data model.
  `auth-and-jwt.md` and `pdf-pipeline.md` are stubs to fill on demand.
- Not duplicating the layer `AGENTS.md` files — those describe *conventions*; these
  describe *mechanisms*.
- Not writing new specs for unfixed issues (the open items in the sync logs stay in
  `docs/specs/`).

---

## 5) Proposed Structure

```
docs/architecture/
  README.md              # what belongs here vs specs vs agent-logs
  crsqlite-sync.md       # P0 — write this first
  data-model.md          # schema + sync wire contract (moved from AGENTS.md §5)
  auth-and-jwt.md        # stub
  pdf-pipeline.md        # stub
docs/runbooks/
  deployment.md          # moved from AGENTS.md §8
  sync-incident-response.md
```

The distinction, stated in `README.md` so it survives:

| Directory | Answers | Tense |
|---|---|---|
| `docs/architecture/` | How does it work? | Present |
| `docs/specs/` | What should we build? | Future |
| `docs/agent-logs/` | What happened, and how do we know? | Past |
| `docs/runbooks/` | What do I do when X? | Imperative |

---

## 6) Implementation Steps

### Phase 1 — `crsqlite-sync.md` (the priority)

1. Create `docs/architecture/crsqlite-sync.md`. Source material, in order of value:
   - `docs/agent-logs/2026/07/2026-07-11_12-00_review-latest-sync-fix.md` (the confirmed root cause
     and the reproduction)
   - `docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md` (clock table shape,
     CR-SQLite source references)
   - `docs/agent-logs/2026/06/2026-06-29_07-35_investigate-sync-500-fk-on-note-delete.md`
   - `docs/specs/active/sync-crsqlite-connection-state-recovery.md` (the confirmed-root-cause section)
   - `backend/api-service/sync.js`, `backend/api-service/db.js` — verify every claim against
     current code

2. Required sections:

   ```markdown
   # CR-SQLite Sync — How It Works

   ## Mental model
   Local-first: each client owns a full DB; the server is a per-user merge point, not a
   source of truth. Changes flow as rows through the `crsql_changes` virtual table.

   ## Vocabulary
   site_id, db_version, col_version, cl (causal length), cid, the `-1` sentinel.
   Define each precisely — these are the terms every sync log uses.

   ## Table anatomy
   For a CRR table `foo`: the base table, `foo__crsql_clock`, and the insert/update/delete
   triggers. Show the actual trigger definition including the
   `WHEN crsql_internal_sync_bit() = 0` guard — that guard is the crux of the 2026-07
   incident.

   ## Deletes and tombstones
   A healthy delete writes a `cid = '-1'`, `cl = 2` sentinel clock row. A clock row without
   a sentinel and without a base row is the corruption shape. Explain how
   `get_local_cl_stmt`'s COALESCE turns that into `row_exists_locally = true`, which routes
   the merge into `did_cid_win` and raises `could not find row to merge with`.

   ## The sync bit  ← the most important section
   `crsql_internal_sync_bit()` suppresses base-table triggers while a merge is applying.
   **It is not reset by transaction rollback**, and backend connections are cached per user
   in `db.js`. A failed merge therefore poisons the connection for every subsequent caller
   until the process restarts or the connection is invalidated.

   ## Failure modes seen in production
   | Symptom | Root cause | Fix | Evidence |
   |---|---|---|---|
   | `constraint failed` on note delete | `note_revisions` FK without `ON DELETE CASCADE`; child rows outlive the parent inside the apply transaction | cascade FK + `PRAGMA defer_foreign_keys` | 2026-06-29 log |
   | `could not find row to merge with for tbl images` | orphan clock rows, no `-1` sentinel — caused by the sync bit staying set after the FK failure above, suppressing the delete trigger during the next day's prune | fail-closed on merge failure + connection invalidation + repair script | 2026-07-06 and 2026-07-11 logs |

   ## Rules when changing sync or schema
   - Any local (non-CRR) table with an FK to a CRR parent MUST use `ON DELETE CASCADE`.
   - Schema changes go in BOTH `syncStore.js` `DB_SCHEMA` and `db.js` `BASE_SCHEMA`; new
     CRR tables also go in `CRR_TABLES`.
   - NOT NULL columns on CRR tables need `DEFAULT` values (see commit 021b140).
   - Never mutate a CRR base table from a connection that may have a poisoned sync bit —
     validate or use a fresh connection for background jobs.
   - Background jobs (orphan-image prune) must not share cached connections with the sync
     path.

   ## Diagnosing a live incident
   Point to `docs/runbooks/sync-incident-response.md`.

   ## Provenance
   Link the four agent logs. This document is the answer; those are the evidence.
   ```

3. **Verify every claim against current code before publishing.** Several source logs were
   written mid-investigation and contain superseded hypotheses — the 2026-07-06 log
   concludes the root cause is "not known for certain", which the 2026-07-11 log then
   resolves. Do not carry the earlier speculation forward as fact.

### Phase 2 — `data-model.md`

4. Move from `AGENTS.md` §5: the CRR table schema, the auth DB schema, settings-table
   conventions, the `POST /sync` wire contract, and the `toBufferLike` / `toSiteIdBlob` /
   `toSqliteScalar` helper descriptions.

5. Verify the schema block against `db.js` `BASE_SCHEMA` and `syncStore.js` `DB_SCHEMA` —
   `AGENTS.md` lists six tables, but the codebase also has `templates`, `note_revisions`,
   and `note_revision_meta`. The current documentation is incomplete. Mark each table
   clearly as **CRR (synced)** or **local (backend-only)**; that distinction is exactly
   what the 2026-06-29 incident turned on.

### Phase 3 — Runbooks

6. Create `docs/runbooks/deployment.md` from `AGENTS.md` §8 (Docker Compose files,
   `deploy.sh` steps, volumes, Nginx routing, Dockerfile notes).

7. Create `docs/runbooks/sync-incident-response.md` from the operational procedure in the
   2026-07-06 log: how to inspect a user DB with the CR-SQLite extension loaded, how to
   detect the orphan-clock shape, how to back up before repair, how to run
   `scripts/repair-orphan-image-clocks.mjs` dry-run then `--apply`, and how to verify
   sentinel counts afterwards. Redact per [DX-04](dx-04-agent-log-lifecycle.md) §6 Phase 1.

   > This runbook depends on `backend/api-service/db-repair.js` and
   > `scripts/repair-orphan-image-clocks.mjs` being committed — see
   > [DX-06](dx-06-repo-hygiene-context.md). Both are currently untracked. A runbook
   > referencing tools that do not exist in the checkout is worse than no runbook.

### Phase 4 — Stubs and index

8. Create `auth-and-jwt.md` and `pdf-pipeline.md` as short stubs — a summary paragraph and
   a "not yet documented in depth; see `backend/api-service/AGENTS.md`" pointer. Stubs
   prevent the next agent from wondering whether they missed a file.

9. Create `docs/architecture/README.md` with the four-directory distinction table from §5,
   plus the promotion rule:

   ```markdown
   ## How this directory gets updated

   When an investigation establishes something durable about how the system behaves,
   promote it here in the same change that writes the log. The log keeps the narrative and
   the evidence; this directory keeps the conclusion. If you find yourself re-deriving
   something an old log already established, that is the signal it should have been
   promoted — promote it then.
   ```

10. Hand off to [DX-03](dx-03-agent-instruction-architecture.md) Phase 4 to trim
    `AGENTS.md` and add the §5 pointer table.

---

## 7) Validation Checklist

- [ ] `docs/architecture/crsqlite-sync.md` exists and covers: vocabulary, table anatomy,
      tombstones, the sync bit, both production failure modes, and the schema rules.
- [ ] Every technical claim in it is verified against current `sync.js` / `db.js`, not just
      copied from a log.
- [ ] No superseded hypothesis from the 2026-07-06 log is presented as the conclusion.
- [ ] `data-model.md` lists **all** tables including `templates`, `note_revisions`,
      `note_revision_meta`, each marked CRR or local.
- [ ] `docs/runbooks/sync-incident-response.md` exists and every script it references is
      committed and runnable.
- [ ] `docs/architecture/README.md` states the architecture / specs / logs / runbooks
      distinction.
- [ ] `AGENTS.md` §5 links to these files (DX-03 Phase 4).
- [ ] Comprehension check: hand `crsqlite-sync.md` alone to a fresh agent and ask what
      breaks if a background job reuses a cached connection after a failed merge. It
      should answer correctly without reading any log.

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| Architecture docs drift from code | Keep them mechanism-level, not line-level. Add "verify `docs/architecture/` is still accurate" to the feature-development skill's Phase 6 checklist for changes touching sync or schema |
| Distillation introduces errors | Verify against code, not against the logs. Cite the specific source file for each non-obvious claim |
| A fourth doc location adds confusion | The `README.md` distinction table is the mitigation and is not optional |

Rollback is trivial — these are additive files. DX-03 Phase 4 must not run before this
spec completes.

---

## 9) Handover Notes

Phase 1 is the whole point; if only one thing from this entire DX set gets done after
DX-01, make it `crsqlite-sync.md`. Budget real time for it — it is a synthesis task
requiring the agent to read four logs, two specs, and the relevant parts of `sync.js` and
`db.js`, then reconcile contradictions between them. It is not a copy-paste job.
