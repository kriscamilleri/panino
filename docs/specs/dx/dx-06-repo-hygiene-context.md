# DX-06 — Repository Hygiene & Context Pollution

> Remove dead files, quarantine vendored blobs, commit the orphaned incident tooling, and
> make `.llmignore` reflect what agents should actually skip.
> Status: done — verified 2026-08-16. `pdf.backup.js`, `combined_content.txt` and `prompt.md`
> are gone with no remaining code references; `paged.polyfill.js` sits under
> `backend/api-service/vendor/` with a README; `.llmignore` excludes `data/`, `uploads/`,
> `vendor/` and `docs/agent-logs/archive/`; `.dockerignore` excludes `data/` and `uploads/`;
> `db-repair.js`, `scripts/repair-orphan-image-clocks.mjs` and `tests/unit/db-repair.test.js`
> are committed and passing.
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P1 — low risk, immediate reduction in wasted context
> Depends on: nothing. Overlaps [DX-01](dx-01-backend-test-runnability.md) Phase 1 (`.dockerignore`)

---

## 1) Summary

Several large files in the working tree exist only to mislead: a 921 KB vendored polyfill,
a 36 KB dead duplicate of `pdf.js`, a 219 KB stale LLM context dump, and 28 MB of real user
databases. Meanwhile the incident-response tooling that two agent logs describe in detail
has never been committed, so it does not exist for the next agent who needs it.

---

## 2) Problem & Evidence

### 2.1 Files that waste or mislead

| Path | Size | Tracked | Problem |
|---|---|---|---|
| `backend/api-service/lib/paged.polyfill.js` | 921 KB | yes | Vendored third-party bundle. A single accidental `Read` consumes most of a context window |
| `backend/api-service/pdf.backup.js` | 36 KB | yes | Dead duplicate of `pdf.js` (23 KB). Nothing imports it; an agent grepping for PDF logic gets two plausible hits and no way to tell which is live |
| `combined_content.txt` | 219 KB | no (gitignored) | Generated LLM dump, last written Oct 2025. Stale, and greppable |
| `prompt.md` | 0 B | no (gitignored) | Empty file, no purpose |
| `backend/api-service/data/` | 28 MB, 118 files | no (gitignored) | Real user SQLite DBs + WAL/SHM in the working tree |
| `backend/api-service/uploads/` | 2.6 MB | no (gitignored) | Real user images |
| `.vscode/.chrome-debug-profile/` | 37 subdirs | no (gitignored) | Browser profile committed to the working tree by a debug session |

Gitignored is not the same as invisible: agents `glob`, `grep`, and `find` the working
tree, and these all match.

### 2.2 The incident tooling is untracked

`git status` shows these as untracked, months after they were written:

```
?? backend/api-service/db-repair.js
?? backend/api-service/scripts/repair-orphan-image-clocks.mjs
?? backend/api-service/tests/unit/db-repair.test.js
```

`docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md` explicitly asks for them
to be shipped:

> Files added (db-repair.js, scripts/...mjs) are ops utilities — ship them so future
> incidents can be responded to without re-deriving the corruption shape.

That did not happen. The next incident starts from zero. The same log also references
`docs/inspect_sync.js`, `docs/inspect_sync2.cjs`, and `docs/verify-prod.cjs` as "kept for
future incidents" — none of these exist in the repo at all.

### 2.3 `.llmignore` is inert and wrong

`.llmignore` only affects `combine-files.cjs`. Agents never read it. Its contents are also
stale for the purpose: it excludes `README.md` (useful to an agent) while **not** excluding
`backend/api-service/data/`, `uploads/`, `lib/`, or `docs/agent-logs/`.

### 2.4 Docker build context includes user data

`backend/api-service/.dockerignore` contains only `node_modules`, log globs, `.git`, and
`.gitignore`. `data/` and `uploads/` are copied into both the test image and the
**production** image. Covered in DX-01 Phase 1; repeated here because it belongs to the
same cleanup and whichever spec lands first should do it.

---

## 3) Goals

1. No file in the working tree misleads an agent about what code is live.
2. Large blobs cannot be accidentally read into context.
3. Incident-response tooling is committed, tested, and referenced from a runbook.
4. A single, accurate statement of "directories agents should not read", in a place agents
   actually see.

## 4) Non-Goals

- Not deleting user data from `data/`/`uploads/` — that is the local dev database.
- Not refactoring `paged.polyfill.js` or replacing the vendored dependency.
- Not restructuring `docs/` (see [DX-04](dx-04-agent-log-lifecycle.md), [DX-05](dx-05-architecture-knowledge-base.md), [DX-07](dx-07-spec-lifecycle.md)).

---

## 5) Implementation Steps

### Phase 1 — Commit the orphaned tooling

**Highest value in this spec. Do it first.**

1. Review `backend/api-service/db-repair.js` and
   `backend/api-service/scripts/repair-orphan-image-clocks.mjs` for correctness against
   current `db.js`, and for any embedded production identifiers (the log shows they were
   developed against a specific user DB).

2. Run `backend/api-service/tests/unit/db-repair.test.js` via `npm run test:be` (DX-01).
   The log claims 6/6 passing; verify that still holds.

3. Commit all three files.

4. Also commit `backend/api-service/tests/integration/sync.revision.test.js` (currently
   modified) — or revert it if the modification was exploratory. Do not leave it dirty.

5. Reference the repair script from `docs/runbooks/sync-incident-response.md`
   ([DX-05](dx-05-architecture-knowledge-base.md) Phase 3).

### Phase 2 — Remove dead code

6. Delete `backend/api-service/pdf.backup.js`. Confirm nothing imports it first:

   ```bash
   grep -rn "pdf.backup" --include="*.js" --include="*.json" . | grep -v node_modules
   ```

   Git retains the history; a `.backup.js` file in the working tree does not.

7. Delete `combined_content.txt` and `prompt.md` from the working tree. `combined_content.txt`
   is regenerable with `npm run llm`.

8. Delete `.vscode/.chrome-debug-profile/` from the working tree and add
   `.vscode/.chrome-debug-profile/` explicitly to `.gitignore` so a future debug session
   does not recreate it as a surprise.

### Phase 3 — Quarantine the vendored blob

9. Move `backend/api-service/lib/paged.polyfill.js` to
   `backend/api-service/vendor/paged.polyfill.js` (`git mv`) and update the import in
   `pdf.js`. Verify the PDF integration tests still pass.

10. Add `backend/api-service/vendor/README.md`:

    ```markdown
    # Vendored dependencies

    Third-party bundles copied into the repo. **Do not read or edit these files** — they
    are generated output, often several hundred KB, and reading one will consume most of an
    agent's context window for no benefit.

    | File | Source | Why vendored |
    |---|---|---|
    | `paged.polyfill.js` | Paged.js | Pagination polyfill injected into the Puppeteer page during PDF rendering |
    ```

    A `vendor/` path is a convention agents already recognise, which is the point — the
    directory name does the work.

### Phase 4 — Make the ignore files honest

11. Rewrite `.llmignore` to reflect what agents should skip, and add a header explaining
    that it is advisory:

    ```
    # Paths agents and context-generation tools should not read.
    # Enforced by combine-files.cjs; advisory for AI agents (also stated in AGENTS.md).

    node_modules
    dist
    dist-ssr
    *.local
    coverage

    # Logs
    logs
    *.log

    # Real user data — never read, never include
    backend/api-service/data
    backend/api-service/uploads

    # Generated / vendored — large, no signal
    backend/api-service/vendor
    combined_content.txt
    package-lock.json
    pnpm-lock.yaml
    frontend/dist
    .vscode/.chrome-debug-profile

    # Historical narrative; read docs/architecture/ instead. See docs/agent-logs/README.md
    docs/agent-logs/archive
    ```

    Note `README.md` is deliberately no longer excluded — it is useful context for an agent.

12. Apply the `.dockerignore` fix from [DX-01](dx-01-backend-test-runnability.md) Phase 1 if
    it has not already landed.

13. Add a short "Directories not to read" block to `AGENTS.md` §4, since `.llmignore` is not
    something agents load:

    ```markdown
    ### Directories not to read

    | Path | Why |
    |---|---|
    | `backend/api-service/data/`, `uploads/` | Real user data. Never read, never include in context |
    | `backend/api-service/vendor/` | Vendored bundles, hundreds of KB, zero signal |
    | `frontend/dist/`, `combined_content.txt` | Build/generated output |
    | `docs/agent-logs/archive/` | Superseded logs; read `docs/architecture/` instead |
    ```

---

## 6) Validation Checklist

- [ ] `db-repair.js`, `scripts/repair-orphan-image-clocks.mjs`, and
      `tests/unit/db-repair.test.js` are committed and their tests pass under `npm run test:be`.
- [ ] `git status --porcelain` is clean apart from intentional work in progress.
- [ ] `pdf.backup.js`, `combined_content.txt`, `prompt.md` are gone from the working tree.
- [ ] `grep -rn "pdf.backup"` returns no code references.
- [ ] `paged.polyfill.js` lives under `vendor/` with a README; PDF integration tests pass.
- [ ] `.llmignore` excludes `data/`, `uploads/`, `vendor/`, and no longer excludes `README.md`.
- [ ] `.dockerignore` excludes `data/` and `uploads/`.
- [ ] `AGENTS.md` §4 lists the do-not-read directories.
- [ ] `npm run llm` still produces a usable dump and is measurably smaller than before.

---

## 7) Risks & Rollback

| Risk | Mitigation |
|---|---|
| `pdf.backup.js` turns out to be a needed fallback | Check imports first; git retains it. If genuinely needed, that is a bug to fix properly, not a file to keep |
| Moving the polyfill breaks PDF rendering | Single import to update; PDF integration tests cover it. Verify in the dev stack, not just unit tests |
| The repair script contains prod-specific assumptions | Review in Phase 1 step 1; it was written against one user's DB |

All changes are individually revertable. Phase 1 is purely additive.

---

## 8) Handover Notes

Phase 1 is the only phase with real stakes — the rest is tidying. If the agent runs short
on time, commit the repair tooling and stop; the deletions can wait. Do not delete anything
in Phase 2 without running the grep check first.
