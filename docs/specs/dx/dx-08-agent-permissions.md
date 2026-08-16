# DX-08 — Agent Permissions Configuration

> Share the safe permissions so a fresh checkout does not re-prompt through the whole set,
> and make production SSH access a deliberate choice rather than an inherited default.
> Status: done — verified 2026-08-16. `.claude/settings.json` is committed with the shared
> safe set and a `deny` list, `.claude/settings.local.json` is gitignored and holds the
> machine-specific entries, and no production-reaching permission appears in the committed
> file. Phase 2 was ratified as Option A (production SSH stays local-only) on 2026-08-08.
> The production-access decision now lives in `AGENTS.md` §4 rather than §7 — the checklist's
> section number predates the DX-03 rewrite.
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P2 — small friction fix with a security decision attached
> Depends on: nothing

---

## 1) Summary

`.claude/settings.json` — the shared, committed file — allows only `docker ps` and
`docker restart`. Every permission an agent actually needs lives in the untracked
`settings.local.json`. The result is that any fresh clone, second machine, or new
contributor re-prompts through the whole set.

The same local file also allowlists `sshpass:*`, which grants agents credentialed SSH
access to the production VPS. That may well be intentional, but it should be an explicit
decision rather than something that accumulated.

---

## 2) Problem & Evidence

### 2.1 The useful permissions are not shared

`.claude/settings.json` (committed):

```json
{ "permissions": { "allow": ["Bash(docker ps:*)", "Bash(docker restart:*)"] } }
```

`.claude/settings.local.json` (untracked):

```json
{ "permissions": { "allow": [
  "Bash(sshpass:*)", "Bash(docker exec:*)", "Bash(curl:*)",
  "Bash(docker compose:*)", "Bash(node test-pdf.js:*)", "Bash(tee:*)"
] } }
```

`docker compose` is the documented way to run the dev stack (`AGENTS.md` §4) and appears in
`.vscode/tasks.json` as six separate tasks. It is not in the shared file.

### 2.2 Production SSH is allowlisted

`Bash(sshpass:*)` combined with credentials in `prd-server.env` means an agent can reach
production non-interactively. `docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md`
records exactly this: an agent SSHed to the production VPS, inspected user databases, and
ran a repair script with `--apply` against live user data.

That produced a good outcome. It is still worth being deliberate about, particularly given
`.github/skills/prod-server-debug/SKILL.md` opens with "Default to read-only inspection
unless the user explicitly asks for a server-side change" — a rule enforced only by the
agent's own compliance.

### 2.3 No hooks, no commands

`.claude/` contains only the two settings files. There are no `commands/` and no hooks,
though several repeated workflows are good candidates.

---

## 3) Goals

1. A fresh clone can run the dev stack and the test suite without a permission prompt storm.
2. Read-only and local-development permissions are shared; anything reaching production is
   opt-in and local.
3. The production-access posture is a recorded decision.

## 4) Non-Goals

- Not restricting what a human can do. This is about default agent permissions.
- Not building a secrets-management solution for `prd-server.env`.
- Not adding hooks in this spec (see §7 for candidates).

---

## 5) Implementation Steps

### Phase 1 — Promote the safe permissions

1. Rewrite `.claude/settings.json`:

   ```json
   {
     "permissions": {
       "allow": [
         "Bash(docker ps:*)",
         "Bash(docker restart:*)",
         "Bash(docker compose:*)",
         "Bash(docker build:*)",
         "Bash(docker logs:*)",
         "Bash(docker inspect:*)",
         "Bash(npm run test:*)",
         "Bash(npm test:*)",
         "Bash(npm run doctor:*)",
         "Bash(npm run lint:*)",
         "Bash(npm ci:*)",
         "Bash(npm install:*)",
         "Bash(./scripts/test-backend.sh:*)",
         "Bash(./scripts/test-frontend.sh:*)",
         "Bash(./scripts/doctor.sh:*)",
         "Bash(git status:*)",
         "Bash(git diff:*)",
         "Bash(git log:*)",
         "Bash(git show:*)",
         "Bash(curl:*)"
       ]
     }
   }
   ```

   These are local, reversible, or read-only. `docker exec` is deliberately excluded — it
   is fine locally but the same verb reaches production containers under the prod-debug
   workflow, so it stays a prompt.

2. Confirm `.gitignore` keeps `settings.local.json` untracked and `settings.json` tracked.
   The current `.gitignore` does not mention `.claude/` at all, so both are trackable —
   add an explicit rule to prevent the local file being committed by accident:

   ```
   .claude/settings.local.json
   ```

### Phase 2 — Make production access a decision

> **DECIDED 2026-08-08 by the maintainer: Option A.** Credentialed production SSH stays
> available per-machine via `.claude/settings.local.json` and is deliberately absent from
> committed settings. The read-only default, explicit-approval requirement, backup-first
> rule, and agent-log requirement are recorded in `AGENTS.md` §4 ("Production access").
> An earlier pass implemented this without asking; the posture is unchanged, but it is now
> a ratified decision rather than an assumed one.

3. **Ask the maintainer**, then implement one of:

   - **Option A (recommended) — keep prod access, local-only, documented.** Leave
     `Bash(sshpass:*)` in `settings.local.json` only. Add to `AGENTS.md` §7 (Security
     Guidelines):

     ```markdown
     ### Production access

     Agents may hold credentialed SSH access to the production VPS via `sshpass` and
     `prd-server.env`. This is granted per-machine in `.claude/settings.local.json` and is
     deliberately **not** shared in the committed settings.

     When touching production, load the `prod-server-debug` skill first. Default to
     read-only inspection. Any write, repair, or restart requires explicit user approval
     in the current conversation, must be preceded by a timestamped backup, and must be
     recorded in an agent log.
     ```

   - **Option B — remove it.** Drop `Bash(sshpass:*)` and accept a prompt per production
     session. Higher friction; a clearer boundary.

4. Optionally add a `deny` block for commands that should never run unprompted regardless
   of other rules:

   ```json
   "deny": [
     "Bash(rm -rf:*)",
     "Bash(git push --force:*)",
     "Bash(sudo ./deploy.sh:*)"
   ]
   ```

   `deploy.sh` is worth listing explicitly: it rebuilds and restarts production, and
   `deploy.yml` already runs it automatically on push to `main`. An agent should never
   invoke it directly without being asked.

### Phase 3 — Trim the prompt surface with real data

5. Run the `/fewer-permission-prompts` skill against recent transcripts to find repeatedly
   prompted read-only commands that are missing above. Add what it finds; it derives from
   actual usage rather than guesswork.

---

## 6) Validation Checklist

- [ ] `.claude/settings.json` contains the shared safe set and is committed.
- [ ] `.claude/settings.local.json` is gitignored and still holds machine-specific entries.
- [ ] No production-reaching permission (`sshpass`, `docker exec` against prod) is in the
      committed file.
- [ ] A fresh clone can run `npm run test:be` and `docker compose -f docker-compose.dev.yml up`
      with no permission prompt.
- [ ] The production-access decision is recorded in `AGENTS.md` §7.
- [ ] `deny` list, if adopted, blocks `sudo ./deploy.sh`.
- [ ] `.gitignore` has an explicit `.claude/settings.local.json` rule.

---

## 7) Follow-on Candidates (not in scope)

Recorded so they are not lost:

- **Hook** — a `Stop` hook running `git status --porcelain docs/` to warn about uncommitted
  agent logs, addressing the eleven lost logs in [DX-04](dx-04-agent-log-lifecycle.md) §2.3.
- **Command** — `/verify` running doctor + both suites and summarising.
- **Command** — `/log` scaffolding a correctly-pathed agent log from the `AGENTS.md` template.
- **Skill** — `sync-debugging`, wrapping `docs/architecture/crsqlite-sync.md` and the
  incident runbook from [DX-05](dx-05-architecture-knowledge-base.md).

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| A broad allowlist entry permits something unintended | Scope to specific verbs; avoid bare `Bash(npm:*)` or `Bash(git:*)` |
| Shared `curl:*` enables arbitrary network access | Already in local settings and needed for API testing; the `deny` list plus review is the control. Drop it if the maintainer prefers |
| Removing prod access slows incident response | That is the trade-off Option B accepts; Option A is recommended for this reason |

Rollback: revert `settings.json`. Local settings are unaffected either way.

---

## 9) Handover Notes

Phase 1 is safe and mechanical. Phase 2 requires a maintainer answer before any change —
**do not silently promote or remove `sshpass` access.** Present both options and wait.
