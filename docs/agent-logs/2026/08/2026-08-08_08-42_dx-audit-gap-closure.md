# DX implementation audit and gap closure

**Agent:** Claude Code (Opus 5)
**Started:** 2026-08-08 08:42
**Status:** completed

## Objective

Audit the DX-01…DX-08 implementation (commits `0c523b8`, `9a8a2a3`, `92f10dc`) against the
specs in `docs/specs/dx/`, then close whatever gaps the audit found.

## Progress

- [x] Verify every DX spec's validation checklist against the repo, running commands rather
      than reading the implementation log.
- [x] Report findings: 7 gaps, 1 real miss, 2 process deviations.
- [x] Put the two maintainer decisions to the maintainer instead of re-deciding them.
- [x] DX-02 step 4 — add the CI gate to the feature-development skill.
- [x] Fix the skill's self-contradictory integration-test location.
- [x] Reconcile DX-03's grep checklist with DX-04's rule on historical logs.
- [x] Exercise the doctor script's failure branch.
- [x] Split `0c523b8` so redaction and the polyfill move are separate commits.
- [x] Adopt ESLint (DX-01 Phase 5 Option A) and clear the baseline.
- [x] Re-verify: lint, both suites, frontend build.

## What the audit confirmed

Verified by running, not by reading the previous log:

| Check | Result |
|---|---|
| `npm run test:be` | 14 files, 152 tests pass on a Node 24 host via Docker |
| `npm run test:fe` | 14 files, 220 tests pass |
| `npm run doctor` | reports runtime, bindings, env files, dev stack; exits 0 |
| DX-04 redaction greps | no production IPs, no full user UUIDs |
| `docs/agent-logs/README.md` | all 10 listed paths resolve |
| `AGENTS.md` | 139 lines, all 12 linked paths resolve |
| `docs/specs/shipped/*` | all 26 `Shipped:`/`Implementation:` paths resolve |
| `.claude/skills` | committed as mode `120000`, resolves to both skills |
| `crsqlite-sync.md` claims | spot-checked against `db.js:608`, `sync.js:360`, `CRR_TABLES` |

DX-01 through DX-08 were substantially implemented. The gaps below are what was missing.

## Gaps found and closed

1. **DX-02 step 4 was never done** — the only outright miss. The feature-development skill
   said nothing about CI; the word "CI" did not appear in it. Agents had no way to know a
   gate existed. Added a "CI runs on the PR" section naming all three jobs and requiring the
   agent to check the result before reporting a PR complete.

2. **Two maintainer decisions had been made unilaterally.** `dx-00-overview.md` §6 says
   "ask rather than assume" and DX-01 Phase 5 / DX-08 Phase 2 repeat it. Both were decided
   without asking. Put to the maintainer this session:
   - **DX-01 Phase 5 → Option A, adopt ESLint.** Reverses the earlier silent Option B.
   - **DX-08 Phase 2 → Option A, ratified unchanged.** Production SSH stays local-only.

   Both spec files now carry a `DECIDED 2026-08-08 by the maintainer` block, so the next
   agent sees a ratified decision rather than an open question.

3. **`0c523b8` was mislabelled** — "redact sensitive identifiers from agent logs" also
   carried the 921 KB `lib/` → `vendor/` polyfill move, the one thing DX-04 §6 Phase 1
   step 3 asks to keep out of the redaction commit. Split into `8601c5f` (redaction) and
   `91dc900` (move). Verified the rebuilt history is byte-identical to the original tree,
   and `git log --follow` still traces through the rename.

4. **The skill contradicted itself** on integration-test location — corrected in one place
   and left stale in the reference table.

5. **DX-03 and DX-04 gave conflicting instructions.** DX-03's checklist demanded zero
   `agents.md` hits repo-wide; nine remain in a 2026-02 log literally titled "Expand
   agents.md into comprehensive handbook". DX-04 says never rewrite historical logs. DX-04
   wins; DX-03's grep is now scoped to exclude `docs/agent-logs/`, with the reasoning
   recorded inline.

6. **The doctor's ABI diagnostic was unexercised** — it reports `better-sqlite3: OK` on this
   host, so the branch DX-01 cares about never ran. Exercised it directly against a broken
   module path: it prints the BROKEN line plus the `use: npm run test:be` hint, and the
   script exits 0 (a report, not a gate) and mutates nothing.

7. **Unrequested Prettier reformat** in `sync.revision.test.js` (`9a8a2a3`) — ~95% of that
   502-line diff is quote/wrapping churn. Checked whether tests had been weakened to get CI
   green: they had not. `it` blocks went 9 → 11 and `expect` calls 25 → 35. **Left as-is** —
   it is committed and passing, and reverting would add a second round of churn. Noted here
   so the next reader knows the diff is noise, not substance.

## ESLint adoption (DX-01 Phase 5, Option A)

`eslint.config.mjs` at root — `.mjs` because the root `package.json` has no
`"type": "module"`, so `eslint.config.js` would parse as CommonJS. `eslint:recommended` +
`vue3-recommended` with stylistic rules off, per the spec.

Three rule decisions worth knowing about:

- **`no-console` off for the backend.** The backend has no logger abstraction; console *is*
  the logging mechanism, and several of those lines are the structured sync logs that
  `docs/runbooks/` tells operators to grep for. Kept as a warning for frontend code.
- **`vue/multi-word-component-names` off.** Editor/Navbar/Documents/Preview predate this
  config and are referenced by name throughout. Renaming is a refactor, not a lint fix.
- **`vue/no-v-html` kept as a warning, not silenced.** Three uses, each fed by
  DOMPurify-sanitized output. It should stay visible in review.

Baseline was 145 problems; config decisions accounted for ~47, leaving 58 real errors, fixed
in `842f32a` (separate commit, per the spec's risk table).

**Two genuine defects surfaced:**

- `RevisionPanel.vue` rendered revision content as a mustache inside `<textarea>`. Vue does
  not reactively update interpolated textarea content, so the pane kept displaying whichever
  revision was selected first. Now bound with `:value`.
- `db.js` discarded the underlying resolver error when `@vlcn.io/crsqlite` could not be
  resolved, making a missing package indistinguishable from a broken native build — on the
  exact dependency behind the DX-01 ABI problem. Now rethrown with `{ cause }`.

The rest was dead code: 47 unused imports/vars/args, three dead functions, one dead constant,
two empty catches, two redundant initialisers, four needless regex escapes, and
`hasOwnProperty` → `Object.hasOwn`.

## Tests

- `npm run lint` — 0 errors, 41 advisory warnings, exit 0.
- `npm run test:be` — 14 files, 152 tests pass (before and after the lint fixes).
- `npm run test:fe` — 14 files, 220 tests pass (before and after).
- `npx vite build` — succeeds. Run deliberately: Vitest would not catch a `.vue` template
  still referencing an import removed from its `<script setup>`.
- Doctor failure branch — verified by simulation; exit 0, no mutations.
- History split — `git diff 92f10dc HEAD` empty before replaying, `git log --follow` intact.

## Open Items / Notes

- **`test.yml` and `deploy.yml` have still never executed.** Every item in DX-02's validation
  checklist requires observing a real CI run. The workflows match the spec on disk, but
  "CI works" is unverified until something is pushed. DX-02's own handover note advises
  letting `test.yml` run green before relying on the `needs:` gate — that ordering was not
  followed, and the lint job I added is likewise unobserved.
- **DX-02 §7 maintainer actions remain open** — branch protection requiring the `lint`,
  `frontend` and `backend` checks, and confirming the four SSH secrets are still valid.
- One mid-task error worth recording: a bulk find/replace hit 7 occurrences in
  `image.test.js` where only 1 was flagged. Caught by re-reading the replacement counts,
  reverted the three affected files, and redid them line-targeted. Bulk string replacement
  across test files is not safe when the target line is a common idiom.
- A stale `eslint-disable` directive was already present in `FolderPreview.vue`, so ESLint
  had been configured here at some point before.
- `backup-pre-split` branch retained locally as a safety net for the history rewrite; delete
  it once the branch is pushed and reviewed.
