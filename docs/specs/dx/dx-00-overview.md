# DX-00 — Agent Developer Experience: Overview & Sequencing

> Index for the DX spec set. Read this before picking up any individual DX spec.
> Status: proposed
> Created: 2026-08-08
> Last updated: 2026-08-08
> Source: repository and implementation-log analysis, 2026-08-08

---

## 1) Why this set exists

An analysis of the repository, the three `AGENTS.md` files, both skills, the 82 agent logs,
the 15 specs, and the test/CI configuration found one dominant problem and several
compounding ones:

**Agents cannot verify their own work on the most dangerous code in the project.** The Node
ABI mismatch has blocked the backend test suite in at least four recorded sessions, all of
them touching `sync.js` or `db.js` — the two files responsible for both 2026 production
incidents. There is no CI gate either, so nothing catches it downstream.

Everything else follows from a second pattern: **knowledge is produced but not retained.**
Investigations are logged in a flat 82-file directory with no index; the same CR-SQLite
facts were re-derived four separate times in two weeks; specs never get their status
updated so shipped features still read as `Draft`; two well-written skills sit in a
directory Claude does not load; and the incident-response tooling written in July was never
committed.

---

## 2) The specs

| # | Spec | Priority | Effort | Depends on |
|---|---|---|---|---|
| 01 | [Backend Test Runnability](dx-01-backend-test-runnability.md) | **P0** | ~½ day | — |
| 02 | [CI Test Gate](dx-02-ci-test-gate.md) | **P0** | ~2 hrs | 01 |
| 03 | [Agent Instruction Architecture](dx-03-agent-instruction-architecture.md) | **P0** | ~3 hrs | 05 (for Phase 4 only) |
| 04 | [Agent Log Lifecycle](dx-04-agent-log-lifecycle.md) | P1 | ~½ day | — |
| 05 | [Architecture Knowledge Base](dx-05-architecture-knowledge-base.md) | P1 | ~1 day | — |
| 06 | [Repository Hygiene & Context](dx-06-repo-hygiene-context.md) | P1 | ~3 hrs | — |
| 07 | [Spec Lifecycle & Status](dx-07-spec-lifecycle.md) | P2 | ~3 hrs | — |
| 08 | [Agent Permissions](dx-08-agent-permissions.md) | P2 | ~1 hr | — |

Effort estimates assume an agent with repo context, and include the validation checklist.

---

## 3) Suggested sequence

```
DX-01 ──────────────► DX-02
(tests runnable)      (CI gate)

DX-03 Phase 1 ──► DX-05 ──► DX-03 Phases 2-5
(fix broken refs)  (arch docs)  (entry points, trim AGENTS.md)

DX-06 Phase 1 ──► DX-04 ──► DX-07
(commit tooling)   (logs)     (specs)

DX-08 (independent, any time)
```

Three ordering constraints are real; the rest is preference:

1. **DX-02 after DX-01.** A CI gate on tests nobody can run locally is a wall, not a gate.
2. **DX-03 Phase 4 after DX-05.** Do not delete sections from `AGENTS.md` until
   `docs/architecture/` exists to receive them.
3. **DX-05 Phase 3 after DX-06 Phase 1.** The incident runbook references
   `db-repair.js` and `repair-orphan-image-clocks.mjs`, which are currently untracked.

**DX-03 Phase 1** (fix the lowercase `AGENTS.md` references, remove the nonexistent
delegation-call instruction) is fifteen minutes and has no dependencies. Ship it first
regardless of what else happens.

---

## 4) If only three things get done

1. **DX-01** — make `npm run test:be` work. Root cause behind unverified changes to
   incident-prone code.
2. **DX-03 Phases 1–3** — fix the broken references, add `CLAUDE.md` and
   `.github/copilot-instructions.md`, symlink the skills. Three hours, and it doubles the
   reach of documentation that is already written.
3. **DX-05 Phase 1** — write `docs/architecture/crsqlite-sync.md`. That knowledge currently
   exists only as narrative buried in a flat log directory, and it has been re-derived four
   times.

---

## 5) Target structure

What the repo looks like once the set is complete:

```
CLAUDE.md                          # thin → AGENTS.md
AGENTS.md                          # ~150 lines: rules + routing table          [DX-03]
.nvmrc                                                                          [DX-01]
.github/
  copilot-instructions.md                                                       [DX-03]
  skills/                          # canonical, shared with Claude via symlink  [DX-03]
  workflows/
    test.yml                       # NEW — gates deploy                         [DX-02]
    deploy.yml
.claude/
  skills -> ../.github/skills                                                   [DX-03]
  settings.json                    # shared safe permissions                    [DX-08]
scripts/
  doctor.sh  test-backend.sh  test-frontend.sh                                  [DX-01]
docs/
  architecture/                    # NEW — how it actually works                [DX-05]
    README.md  crsqlite-sync.md  data-model.md  auth-and-jwt.md  pdf-pipeline.md
  runbooks/                        # NEW                                        [DX-05]
    deployment.md  sync-incident-response.md
  specs/
    README.md  proposed/  active/  shipped/  dx/                                [DX-07]
  agent-logs/
    README.md  2026/MM/  archive/                                               [DX-04]
backend/api-service/
  vendor/                          # quarantined blobs                          [DX-06]
```

The organising principle throughout: **read-frequency determines depth.** Read every
session → root, and short. Read when working in an area → one level down. Read once → an
archive.

---

## 6) Notes for whoever picks these up

- Each spec is self-contained: problem, evidence with file and line references, goals,
  numbered implementation steps, a validation checklist, and risks. They are written to be
  handed to an agent without additional context.
- **Two specs contain decisions that are not the agent's to make.** DX-01 Phase 5 (adopt
  ESLint or delete the lint requirement) and DX-08 Phase 2 (keep or remove production SSH
  access). Both are marked; ask rather than assume.
- Every spec's validation checklist is meant to be pasted into the PR description, per
  `.github/skills/feature-development/SKILL.md` Phase 8.
- These specs live at the top level of `docs/specs/` for now. DX-07 moves them into
  `docs/specs/dx/` as part of its own restructure.
