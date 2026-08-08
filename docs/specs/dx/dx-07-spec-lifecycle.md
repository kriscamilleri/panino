# DX-07 — Spec Lifecycle & Status

> Every spec in the repo says `Status: Draft`, including the shipped ones. Encode status in
> the path so it cannot drift.
> Status: proposed
> Created: 2026-08-08
> Last updated: 2026-08-08
> Priority: P2 — low risk, removes a recurring source of agent confusion
> Depends on: nothing

---

## 1) Summary

`docs/specs/` contains 15 specs. An agent reading any of them cannot tell whether it
describes a proposal, work in progress, or shipped behaviour — because the status header
was written once and never updated. Several specs marked `Draft` describe features that
have been live for months.

The fix is to encode status in the directory path, where it cannot silently go stale, and
to record what shipped it.

---

## 2) Problem & Evidence

### 2.1 Uniform, inaccurate status

Every spec carrying a status line says `Status: Draft`:

| Spec | Header says | Actually |
|---|---|---|
| `github-backup.md` | `Status: Draft — 2026-03-21` | **Shipped** — `githubBackupStore.js`, `GitHubBackupModal.vue`, `backup.js`, tests all exist |
| `dictate.md` | `Status: Draft — 2026-03-22` | **Shipped** — `useDictation.js` + `useDictation.test.js` |
| `document-templates.md` | `Status: Draft — 2026-05-03` | **Shipped** — `templateStore.js`, `TemplateManagerPage.vue` |
| `markdown-import.md` | `**Status:** Draft` | **Shipped** — `importUtils.js`, `markdownImport.test.js` |
| `image-management.md` | (no status; "Last updated") | **Shipped** — `imageManagerStore.js`, `ImageManagerPage.vue` |
| `revision-history-proposal.md` | (no status; "Last updated") | **Shipped** — `revisionStore.js`, `revision.js`, `RevisionHistoryPage.vue` |
| `advanced-search.md` | `Status: Draft — 2026-03-21` | Genuinely not built |
| `calendar-sync.md`, `ai-editor-pane.md`, `gitlab-backup.md`, `tag-system.md` | `Status: Draft` | Genuinely not built |

So the field is right about a third of the time, which is worse than absent — an agent that
learns the field is unreliable stops reading it, and then misses the cases where it matters.

### 2.2 This has already cost time

`docs/agent-logs/2026/05/2026-05-03_16-26_feature-implementation-audit.md` exists specifically to
determine which specced features were actually implemented. That audit was necessary only
because the specs do not say.

### 2.3 Two specs are untracked

`docs/specs/active/sync-crsqlite-connection-state-recovery.md` and
`docs/specs/shipped/sync-note-delete-fk-fix.md` are now tracked in git, despite being the design
documents for two production fixes. See [DX-06](dx-06-repo-hygiene-context.md).

### 2.4 Formats are inconsistent

Three different header conventions are in use: `> Status: Draft — DATE`,
`**Status:** Draft`, and `> Last updated: DATE`. Two specs have no status at all. Nothing
records the commit or PR that shipped a feature.

---

## 3) Goals

1. An agent can tell a spec's status from its path, without reading the file.
2. Shipped specs point at the code and the change that shipped them.
3. One header format.
4. Status cannot silently rot — moving a file is a visible action; editing a header line is
   not.

## 4) Non-Goals

- Not rewriting spec content. Only paths and headers change.
- Not deleting superseded specs.
- Not introducing spec templates or approval workflow.

---

## 5) Proposed Structure

```
docs/specs/
  README.md
  proposed/     # not started; may never be built
  active/       # currently being implemented
  shipped/      # live in production
  dx/           # the DX-01..DX-08 specs in this set
```

Path-as-status beats a header field because moving a file between directories is a visible,
reviewable action in a diff, whereas failing to update a header is invisible. That
invisibility is precisely what produced the current state.

The `dx/` subdirectory keeps this meta-work from cluttering the product-spec lifecycle;
these specs are about the repository, not the product.

---

## 6) Implementation Steps

### Phase 1 — Determine actual status

1. For each spec, verify implementation status against the codebase rather than trusting
   the header. Use `docs/agent-logs/2026/05/2026-05-03_16-26_feature-implementation-audit.md` as a
   starting point but re-verify — it is three months old.

   Evidence for "shipped" is code plus tests, e.g. `dictate.md` →
   `frontend/src/composables/useDictation.js` + `frontend/tests/unit/useDictation.test.js`.

2. Record findings in a scratch table before moving anything. Some specs may be **partially**
   shipped — `document-templates-extensions.md` ("dynamic titles & default folders") needs
   a real check; if partial, it goes in `active/` with the delta stated in its header.

### Phase 2 — Move

3. Create the directories and `git mv` each spec into the right one. Expected placement
   based on the evidence above:

   - `shipped/` — `github-backup.md`, `dictate.md`, `document-templates.md`,
     `markdown-import.md`, `image-management.md`, `revision-history-proposal.md`,
     `global-variables.md`, `sync-note-delete-fk-fix.md`
   - `active/` — `sync-crsqlite-connection-state-recovery.md`,
     `document-templates-extensions.md` (pending Phase 1 verification)
   - `proposed/` — `advanced-search.md`, `ai-editor-pane.md`, `calendar-sync.md`,
     `gitlab-backup.md`, `tag-system.md`
   - `dx/` — `dx-01`…`dx-08`

4. Commit the two untracked sync specs as part of this move.

5. Fix inbound references. At minimum:

   ```bash
   grep -rn "docs/specs/" --include="*.md" . | grep -v node_modules
   ```

   Known referrers: `.github/skills/feature-development/SKILL.md` (Phase 2),
   `AGENTS.md`, several agent logs, and `document-templates-extensions.md` which references
   `docs/specs/shipped/document-templates.md`. Agent logs are historical records — update the
   skill and `AGENTS.md`; leave old logs alone (they describe where the file was at the
   time, and rewriting history in logs is worse than a stale link).

### Phase 3 — Standardise headers

6. Apply one format to every spec, directly under the H1:

   ```markdown
   # <Title> — Spec

   > <One-line description>
   > Status: proposed | active | shipped
   > Created: YYYY-MM-DD
   > Last updated: YYYY-MM-DD
   > Shipped: <commit sha or PR #>        # shipped only
   > Implementation: <key files>           # shipped only
   ```

   Example for a shipped spec:

   ```markdown
   > Status: shipped
   > Created: 2026-03-22
   > Shipped: 2026-03-22 (see docs/agent-logs/2026/03/2026-03-22_18-33_implement-dictate.md)
   > Implementation: frontend/src/composables/useDictation.js, frontend/src/components/SubMenuBar.vue
   ```

   The `Implementation:` line is what makes a shipped spec worth keeping — it becomes a map
   from intent to code.

### Phase 4 — Document the lifecycle

7. Create `docs/specs/README.md`:

   ```markdown
   # Specs

   | Directory | Meaning |
   |---|---|
   | `proposed/` | Designed, not started. May never be built. Do not assume any of this exists |
   | `active/` | Being implemented now. Partially true of the current codebase — check the header |
   | `shipped/` | Live in production. The `Implementation:` line maps it to the code |
   | `dx/` | Developer-experience specs about this repository, not the product |

   A spec describes what we intend to build. For how the system **currently works**, read
   `docs/architecture/`. For what an agent **did**, read `docs/agent-logs/`.

   ## Lifecycle

   `proposed/` → `active/` when implementation starts → `shipped/` when it is live.
   Move the file with `git mv` and update the header in the same commit. If you implement
   a spec and do not move it, the next agent will not know it is done — that is how every
   spec in this repo ended up saying "Draft".
   ```

8. Add to `.github/skills/feature-development/SKILL.md` Phase 8 (Pull Request): "`git mv`
   the spec to `docs/specs/shipped/` and fill in its `Shipped:` and `Implementation:`
   lines as part of the PR."

   Without this hook the same drift recurs. The skill is where the rule has to live,
   because that is what an agent actually follows during feature work.

---

## 7) Validation Checklist

- [ ] Every spec is in `proposed/`, `active/`, `shipped/`, or `dx/`; none left at the top
      level except `README.md`.
- [ ] Placement was verified against code, not against the old header.
- [ ] Every spec uses the standard header block.
- [ ] Every `shipped/` spec has `Shipped:` and `Implementation:` lines with paths that resolve.
- [ ] The two previously-untracked sync specs are committed.
- [ ] `docs/specs/README.md` exists and states the lifecycle.
- [ ] `feature-development/SKILL.md` Phase 8 includes the spec-move step.
- [ ] `grep -rn "docs/specs/"` — no broken paths outside `docs/agent-logs/`.
- [ ] `git log --follow` works on three sample moved specs.

---

## 8) Risks & Rollback

| Risk | Mitigation |
|---|---|
| A spec is misclassified as shipped | Require code + tests as evidence, not just a matching filename. When uncertain, use `active/` and note the uncertainty |
| Moves break external links (PRs, issues) | GitHub renders a 404 for moved paths; acceptable for internal docs. `git log --follow` preserves history |
| Directory churn on partially-shipped specs | `active/` absorbs these; the header states the delta |

Fully revertable via `git mv`.

---

## 9) Handover Notes

Phase 1 is the real work — everything else is mechanical. Do not shortcut it by trusting
the existing headers or the three-month-old audit log; the entire point of this spec is
that those sources are unreliable. Budget time to actually look for the code.
