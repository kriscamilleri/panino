# DX-03 — Agent Instruction Architecture

> Give Claude and GitHub Copilot each a native entry point, fix the broken cross-references,
> and split instructions by how often they need to be read.
> Status: done — verified 2026-08-16. `CLAUDE.md` and `.github/copilot-instructions.md` both
> exist, `.claude/skills` is committed as mode `120000`, `AGENTS.md` is 143 lines with every
> named path resolving, and the `agents.md` grep is clean outside `docs/agent-logs/` (the one
> remaining hit is prose inside this spec describing the rename).
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P0 — cheap, mechanical, and currently wasting work that is already written
> Depends on: nothing
> Related: [DX-05](dx-05-architecture-knowledge-base.md) receives the reference material trimmed out of `AGENTS.md`

---

## 1) Summary

The repo has three `AGENTS.md` files and two well-written skills, but neither Claude Code
nor GitHub Copilot loads them through its native mechanism, two of the cross-references
are broken on a case-sensitive filesystem, and one instruction tells agents to call a tool
that does not exist.

This spec is almost entirely mechanical. It is the highest return-per-hour item in the set.

---

## 2) Problem & Evidence

### 2.1 Neither tool has its native entry point

| Tool | Native file | Present? |
|---|---|---|
| Claude Code | `CLAUDE.md` | **No** |
| GitHub Copilot | `.github/copilot-instructions.md` | **No** |
| Generic | `AGENTS.md` | Yes (root, `frontend/`, `backend/api-service/`) |

Both tools are relying on incidental discovery of `AGENTS.md`.

### 2.2 Skills are invisible to Claude

`.github/skills/feature-development/SKILL.md` (8.5 KB) and
`.github/skills/prod-server-debug/SKILL.md` (5.9 KB) are substantive and encode real
operational knowledge — the secret-masking `awk` snippets, the
`frontend/.env.production.local` gotcha that prevents checkout drift, the phased
utilities → store → UI implementation order.

Claude Code loads project skills from `.claude/skills/`. `.claude/` contains only
`settings.json` and `settings.local.json`. Roughly half the value of that authoring effort
is unreachable.

### 2.3 Broken cross-references

`AGENTS.md:5`:

> For layer-specific details, also read `backend/api-service/AGENTS.md` or `frontend/AGENTS.md` as needed.

`AGENTS.md:246`:

> See `backend/api-service/AGENTS.md` for backend-specific conventions and `frontend/AGENTS.md` for frontend-specific conventions.

The actual filenames are `AGENTS.md` (uppercase). On this Linux host these reads fail. The
same lowercase reference is repeated in `frontend/AGENTS.md:4` and
`backend/api-service/AGENTS.md:4`, and again in `docs/specs/shipped/sync-note-delete-fk-fix.md:163`.

### 2.4 An instruction to call a nonexistent tool

`AGENTS.md:67`:

> Prefer delegating independent sub-tasks to sub-agents when the current tool supports it.

The named delegation call is not a tool in Claude Code or in Copilot. Agents either
fabricate a call, or silently ignore the whole delegation instruction.

### 2.5 Read-everything mandate on a 13.8 KB file

`AGENTS.md:4` — "Read this file in full before starting any task." The file includes the
complete DB schema, the sync wire contract, type-conversion helper descriptions, Docker
volume names, and Nginx routing. That is situational reference, loaded on every session
including one-line CSS changes.

---

## 3) Goals

1. Claude and Copilot each load project instructions through their native mechanism.
2. One source of truth — no content is maintained in two places by hand.
3. Both existing skills are available to both tools.
4. Every file path and tool name referenced in an instruction file actually exists.
5. The always-read surface is small; deep reference is one hop away and clearly signposted.

## 4) Non-Goals

- Not rewriting the *content* of the layer-specific `AGENTS.md` files — they are accurate
  and useful. Only their headers and cross-references change.
- Not authoring new skills (see §6 Phase 5 for the one exception, which is deferred to DX-05).
- Not changing `.claude/settings.json` permissions (see [DX-08](dx-08-agent-permissions.md)).

---

## 5) Proposed Structure

```
CLAUDE.md                          # thin pointer → @AGENTS.md
AGENTS.md                          # ~150 lines: rules + routing table
.github/
  copilot-instructions.md          # thin pointer → AGENTS.md
  skills/                          # canonical skill location
.claude/
  skills -> ../.github/skills      # symlink; both tools, one source
docs/architecture/                 # reference material moved out of AGENTS.md (DX-05)
```

The organising principle: **read-frequency determines depth.** Read every session → root,
short. Read when working in an area → one level down. Read once → `docs/architecture/`.

---

## 6) Implementation Steps

### Phase 1 — Fix what is outright broken (do this first, standalone)

1. In `AGENTS.md`, `frontend/AGENTS.md`, and `backend/api-service/AGENTS.md`, replace every
   occurrence of lowercase `AGENTS.md` references with the actual uppercase filename. Verify with:

   ```bash
   grep -rn "agents\.md" --include="*.md" . | grep -v node_modules | grep -v docs/agent-logs
   ```

   Expect zero results afterwards (also fix the occurrence in
   `docs/specs/shipped/sync-note-delete-fk-fix.md:163`).

   `docs/agent-logs/` is excluded deliberately. Historical logs describe the repo as it was
   at the time — `2026/02/2026-02-15_12-00_expand-agents-handbook.md` is literally about
   creating the then-lowercase `agents.md`. [DX-04](dx-04-agent-log-lifecycle.md) §6 Phase 2
   step 5 says to leave old logs alone; rewriting them to match today's filenames would
   falsify the record. Instruction files must be fixed; the logs must not.

2. Replace `AGENTS.md:65-70` ("Distribute work across agents") with tool-accurate guidance:

   ```markdown
   ### Distribute work across agents

   Delegate independent sub-tasks when the tool you are running supports it — Claude Code
   exposes a Task/Agent tool, Copilot exposes its own delegation surface. Do not invent a
   delegation call if your tool does not offer one; just do the work sequentially.

   Good candidates for delegation: research and context gathering, writing tests for code
   that already exists, validating frontend flows via Chrome DevTools MCP, running lint or
   type checks.

   When delegating, give the sub-agent a self-contained prompt — it cannot see your
   conversation. After it completes, verify its results yourself before marking the task
   done.
   ```

### Phase 2 — Native entry points

3. Create `CLAUDE.md` at repo root:

   ```markdown
   # Panino — Claude Code Instructions

   The canonical agent handbook for this repository is [AGENTS.md](AGENTS.md). Read it
   first.

   @AGENTS.md

   ## Claude-specific notes

   - Project skills live in `.claude/skills/` (a symlink to `.github/skills/`, which is the
     canonical location shared with GitHub Copilot). Do not edit through the symlink path;
     edit `.github/skills/<name>/SKILL.md` directly.
   - Backend tests run in Docker — see AGENTS.md §4 "Verifying your work". A host-native
     `npm test` in `backend/api-service` will fail with a Node ABI error on Node 21+; that
     is an environment condition, not a code defect.
   - Before proposing production changes, load the `prod-server-debug` skill.
   ```

   > The `@AGENTS.md` line is an import directive; if the running Claude Code version does
   > not support it, the prose link above it still routes correctly. Verify which applies
   > and drop the `@` line if it renders literally.

4. Create `.github/copilot-instructions.md`:

   ```markdown
   # Panino — Copilot Instructions

   The canonical agent handbook for this repository is [AGENTS.md](../AGENTS.md). Read it
   before starting any task, plus the layer file for the area you are working in:
   [frontend/AGENTS.md](../frontend/AGENTS.md) or
   [backend/api-service/AGENTS.md](../backend/api-service/AGENTS.md).

   ## Non-negotiables

   - Every feature includes tests. A feature without tests is incomplete.
   - Log substantive work under `docs/agent-logs/` — see AGENTS.md §1 for the threshold
     and template.
   - Never construct SQL by string concatenation; always use parameterised queries.
   - Never trust `req.body.userId` for authorization — use `req.user.user_id` from the JWT
     middleware.
   - Schema changes must be applied in **both** `frontend/src/store/syncStore.js`
     (`DB_SCHEMA`) and `backend/api-service/db.js` (`BASE_SCHEMA` + `CRR_TABLES`).
   - Backend tests run via `npm run test:be` (Docker, Node 20). Host-native runs fail on
     Node 21+ with an ABI mismatch.

   Reusable workflows live in [.github/skills/](skills/).
   ```

   Keeping this file a pointer plus a short non-negotiables list — rather than a copy of
   `AGENTS.md` — is what prevents the two from drifting.

### Phase 3 — Share the skills

5. Create the symlink and commit it:

   ```bash
   ln -s ../.github/skills .claude/skills
   git add .claude/skills
   ```

   Git stores symlinks natively. Verify with `git ls-files -s .claude/skills` — mode
   `120000` confirms it was committed as a link, not as a copied directory.

6. Verify Claude Code lists `feature-development` and `prod-server-debug` as available
   project skills after the symlink lands. If the running version does not traverse
   symlinks, fall back to making `.claude/skills/` canonical and symlinking
   `.github/skills` → `../.claude/skills` instead. **One of the two directions must be a
   symlink; do not duplicate the files.**

### Phase 4 — Trim `AGENTS.md`

7. Move these sections out of `AGENTS.md` into `docs/architecture/` (created by
   [DX-05](dx-05-architecture-knowledge-base.md)):

   | Current section | Destination |
   |---|---|
   | §3 "Critical concept: CR-SQLite sync" | `docs/architecture/crsqlite-sync.md` |
   | §5 Database & Sync (schema, sync contract, type helpers) | `docs/architecture/data-model.md` |
   | §8 Deployment & Infrastructure | `docs/runbooks/deployment.md` |

8. What **stays** in `AGENTS.md` (target: under 150 lines):

   - §1 Agent workflow and logging rules (amended by [DX-04](dx-04-agent-log-lifecycle.md))
   - §2 Project overview (short)
   - §3 The three-tier ASCII diagram and tech-stack table only
   - §4 Development environment **including the new "Verifying your work" block** from DX-01
   - §6 Code conventions
   - §7 Security guidelines — these are non-negotiable and belong in the always-read set
   - §9 File-level cheat sheet — this is the routing table and is the single most valuable
     part of the file
   - A new §5 "Where to find deeper detail", replacing the material moved in step 7:

     ```markdown
     ## 5) Where to find deeper detail

     Read these when working in the relevant area — not upfront.

     | Topic | File |
     |---|---|
     | CR-SQLite sync internals, sync-bit semantics, clock tables | `docs/architecture/crsqlite-sync.md` |
     | Database schema, sync wire contract, type-conversion helpers | `docs/architecture/data-model.md` |
     | Auth, JWT, and WebSocket handshake | `docs/architecture/auth-and-jwt.md` |
     | PDF pipeline and SSRF protections | `docs/architecture/pdf-pipeline.md` |
     | Deployment, Nginx, Docker volumes | `docs/runbooks/deployment.md` |
     | Production incident response | `.github/skills/prod-server-debug/SKILL.md` |
     | Full feature SDLC | `.github/skills/feature-development/SKILL.md` |
     ```

9. Change `AGENTS.md:4` from "Read this file in full before starting any task" to:

   ```markdown
   > Read this file before starting any task, then the layer file for the area you are
   > working in. Deeper reference material is linked from §5 — read it when the task
   > touches that area, not upfront.
   ```

### Phase 5 — Reconcile the skills with reality

10. Update `.github/skills/feature-development/SKILL.md`:
    - Phase 4 "Running tests" commands → the DX-01 commands (`npm run test:be`, etc.).
    - Phase 4 references `frontend/tests/integration/` — that directory does not exist
      (only `frontend/tests/unit/`). Either create it or change the reference to state
      that frontend integration tests currently live alongside unit tests.
    - Phase 6 "Lint clean" → resolve per the DX-01 Phase 5 decision.
    - Phase 0.3 log instruction → align with the DX-04 threshold and path scheme.

---

## 7) Validation Checklist

- [ ] `grep -rn "agents\.md" --include="*.md" . | grep -v node_modules | grep -v docs/agent-logs`
      returns nothing. (Hits inside `docs/agent-logs/` are historical and stay — see Phase 1 step 1.)
- [ ] No instruction file mentions the nonexistent delegation call.
- [ ] `CLAUDE.md` exists and resolves to `AGENTS.md` (confirm the import renders, or that
      the prose link is used instead).
- [ ] `.github/copilot-instructions.md` exists.
- [ ] `git ls-files -s .claude/skills` shows mode `120000`.
- [ ] Claude Code lists both project skills.
- [ ] Copilot picks up `.github/copilot-instructions.md` (visible in its context panel).
- [ ] `AGENTS.md` is under 150 lines and every path it names exists — verify by extracting
      backtick-quoted paths and `ls` each one.
- [ ] No content appears verbatim in both `AGENTS.md` and `.github/copilot-instructions.md`
      beyond the short non-negotiables list.

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| Trimming `AGENTS.md` loses information | Nothing is deleted — content moves to `docs/architecture/` and is linked from §5. Do Phase 4 only after DX-05 has created the destination files |
| Symlink behaves unexpectedly on a Windows checkout | Note in `CLAUDE.md`; `core.symlinks=true` handles it on modern Git for Windows. If it proves a problem, invert the symlink direction |
| Two instruction files drift | Structural: the Copilot file is a pointer, not a copy |

Every phase is independently revertable. Phase 1 is safe to land alone and immediately.

---

## 9) Handover Notes

Phase 1 is fifteen minutes and should ship today regardless of what happens to the rest.
Phase 4 has a hard ordering dependency on DX-05 — do not delete sections from `AGENTS.md`
until the files that receive them exist and are populated.
