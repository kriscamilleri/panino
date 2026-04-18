---
name: feature-development
description: "Use when implementing a new feature end-to-end from spec to PR. Covers the full SDLC: creating a feature branch from main, user journey validation, spec review, phased implementation (utilities first, then store layer, then UI), unit/integration/e2e testing, security review checklist, code review checklist, patching, and PR creation. Never merges — that is the developer's responsibility. Use for any feature that touches multiple files or layers (util, store, component)."
---

# Feature Development Lifecycle

Use this skill when implementing any new feature in Panino that spans multiple files or layers. This codifies the full SDLC pipeline from branch creation to PR.

## Scope

- New features that require utility functions, store changes, and UI work
- Features that need unit, integration, and/or e2e tests
- Any work that will result in a pull request

## Non-Scope

- Hotfixes or single-line patches (just fix and commit)
- Pure refactors with no user-facing change (use judgment)
- Production server debugging (use `prod-server-debug` skill)

---

## Phase 0: Preparation

### 0.1 Create Feature Branch

Always start from an up-to-date `main`:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feature/<short-descriptive-name>
```

### 0.2 Keep Branch Current

Periodically throughout development:

```bash
git fetch origin
git merge origin/main
```

Resolve conflicts by preserving both sides unless there is direct feature overlap. Stop and ask the user only on true overlap or merge-risk uncertainty.

### 0.3 Create Agent Log

Create `docs/agent-logs/YYYY-MM-DD_HH-MM_<short-slug>.md` per the AGENTS.md handbook. Update it as work progresses.

---

## Phase 1: User Journey Validation

Before writing any code, define user journeys as a table:

| # | Persona | Journey | Acceptance Criteria |
|---|---------|---------|---------------------|
| U1 | ... | ... | ... |

Each journey must be testable. These become the basis for e2e test cases later.

---

## Phase 2: Spec Review

If a spec exists in `docs/specs/`, read it fully before starting. Check for:

- [ ] Goals and non-goals are clear
- [ ] Design decisions are made (no unresolved "TBD")
- [ ] Security review section exists with threat analysis
- [ ] Edge cases are documented
- [ ] Open questions that block implementation are resolved (ask the user if not)

If no spec exists, create one following the pattern in existing specs before implementing.

---

## Phase 3: Implementation (Phased)

Always implement in this order. Each phase must pass its tests before moving to the next.

### 3.1 Pure Utility Functions

- Create new utility files (e.g., `src/utils/<feature>Utils.js`)
- Zero dependencies on stores or components
- Export named functions with JSDoc
- Write unit tests immediately (see Phase 4)

**Why first:** Pure functions are easiest to test, de-risk the feature logic, and have no side effects.

### 3.2 Store Layer

- Add new functions to the relevant Pinia store
- Call Phase 3.1 utilities for business logic
- Interact with `syncStore` for database operations
- All database writes in transactions (`BEGIN` / `COMMIT` / `ROLLBACK`)
- Expose new functions via facade store (`docStore`) if needed
- Write unit tests with mocked stores

### 3.3 UI Components

- Modify or create Vue components
- Wire up to store functions from Phase 3.2
- Follow existing component patterns (Tailwind, Lucide icons, etc.)
- Show user feedback via `uiStore.addToast()`
- Handle loading states and errors gracefully

### 3.4 Integration Verification

- Docker compose up full stack (`docker compose -f docker-compose.dev.yml up --build`)
- Test the feature manually through the UI
- Verify sync works (changes reach the server)
- Verify backup compatibility (if applicable)
- Test at 375px and 1280px viewports

---

## Phase 4: Testing Strategy

### Unit Tests

- **Location:** `frontend/tests/unit/<feature>.test.js`
- **Framework:** Vitest
- **Coverage:** Every exported utility function, every store function
- **Security tests:** XSS payloads, path traversal, boundary conditions (see spec's security section)
- Run: `cd frontend && npx vitest run --reporter=verbose <testfile>`

### Integration Tests

- **Location:** `frontend/tests/integration/<feature>.test.js` or `backend/api-service/tests/integration/`
- **Scope:** Store ↔ database interactions, multi-component flows
- Run: same Vitest runner

### E2E Tests (via Chrome DevTools MCP)

- Performed against the Docker dev stack
- Document steps and expected results in the agent log
- Check console for errors after each action
- Test responsive viewports (375px, 1280px)

### Test Checklist

- [ ] All new utility functions have unit tests
- [ ] All new store functions have unit tests  
- [ ] Security-specific test cases from the spec are covered
- [ ] Integration tests verify cross-layer behavior
- [ ] E2E flow verified via MCP (documented in agent log)
- [ ] Existing test suite still passes: `cd frontend && npm test` / `cd backend/api-service && npm test`

---

## Phase 5: Security Review

Before the PR, verify every item from the spec's security requirements:

- [ ] No string concatenation in SQL — all queries parameterized
- [ ] User input sanitized at appropriate boundaries (render-time for XSS, import-time for paths)
- [ ] Resource limits enforced (file counts, sizes)
- [ ] No new dependencies with known CVEs (`npm audit`)
- [ ] No secrets, tokens, or credentials in committed code
- [ ] Error messages don't leak internal details to the user

Run a targeted grep to verify:

```bash
# Check for SQL concatenation (should find zero matches in new code)
grep -rn "exec(\`" frontend/src/
grep -rn "exec('" frontend/src/ | grep -v "exec('"  # look for template literals
```

---

## Phase 6: Code Review Checklist

- [ ] All new functions have JSDoc comments
- [ ] No `console.log` in production code (only `console.warn` for non-critical warnings)
- [ ] Error messages are user-friendly
- [ ] All imports used; no dead code
- [ ] Transaction handling correct (`BEGIN` → `COMMIT` in try, `ROLLBACK` in catch)
- [ ] Existing tests pass
- [ ] New tests pass
- [ ] Lint clean (no ESLint errors)
- [ ] UI visually correct at 1280px and 375px
- [ ] Feature works end-to-end in Docker dev stack
- [ ] Agent log updated with all changes

---

## Phase 7: Patching & Final Checks

1. Run the **full existing test suite** — ensure no regressions
2. Fix any failing tests
3. Address any unchecked security items from Phase 5
4. Performance spot-check: test with a realistic data volume
5. Final diff review: `git diff main..HEAD --stat` — no unintended changes

---

## Phase 8: Pull Request

```bash
git fetch origin
git merge origin/main          # Final sync
# Resolve conflicts if any
git push origin feature/<branch-name>
```

Create PR with:
- **Title:** `feat: <concise feature description>`
- **Description:** Link to spec, summary of changes, test results
- **Labels:** Appropriate labels (`feature`, `frontend`, `backend`, etc.)
- **Checklist:** Paste Phase 5 + Phase 6 checklists with checked boxes
- **Screenshots:** If UI changes, include before/after at 1280px and 375px

### CRITICAL: The PR is never merged by the agent.

The developer reviews and merges at their discretion. The agent's job ends at PR creation.

---

## Quick Reference: File Locations

| What | Where |
|------|-------|
| Utility functions | `frontend/src/utils/` |
| Pinia stores | `frontend/src/store/` |
| Vue components | `frontend/src/components/` |
| Frontend unit tests | `frontend/tests/unit/` |
| Frontend integration tests | `frontend/tests/integration/` |
| Backend unit tests | `backend/api-service/tests/unit/` |
| Backend integration tests | `backend/api-service/tests/integration/` |
| Specs | `docs/specs/` |
| Agent logs | `docs/agent-logs/` |

## Anti-Patterns

- **Skipping to UI first** — always build utilities → store → UI in order
- **Writing tests last** — write tests alongside each phase, not as a final afterthought
- **Merging the PR** — never. That's the developer's job.
- **Skipping Docker verification** — unit tests alone aren't enough. Always verify in the full stack.
- **Ignoring existing test failures** — if `npm test` fails before your changes, note it in the PR but don't ignore it
- **Large uncommitted changes** — commit at each phase boundary, not just at the end
