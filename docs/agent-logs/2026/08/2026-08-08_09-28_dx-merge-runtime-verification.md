# DX merge runtime verification before promotion to main

**Agent:** Claude Code (Opus 5)
**Started:** 2026-08-08 09:28
**Status:** completed

## Objective

Close the gap between "the suites pass" and "the app still works" for the `develop` merge
`887e0d0`, concentrating on commit `374000b` (the ESLint baseline clearance, ~30 runtime
source files). Confirm the deployment risks in `.dockerignore` and the production checkout,
then give a promote / do-not-promote recommendation.

The unit suites, lint, and the frontend build were already green and were not re-run.

## Progress

- [x] Static audit of every runtime hunk in `374000b`.
- [x] Drove the real UI on the dev stack for all six named areas.
- [x] Built and booted the production image against mounted volumes.
- [x] Confirmed the CI result for all three jobs.
- [x] Inspected the production checkout read-only.

## What the static audit established

The risk ESLint and `vite build` both miss is a **template** referencing a binding deleted
from `<script setup>` — neither tool checks that. Grepped each touched component for the
identifier that was removed: `authStore` (AuthForm), `docStore` (Navbar,
SidebarWithResizer), `router` (TemplatePickerModal), `Save`/`RotateCcw`/`BaseButton`
(RevisionPanel), `Hammer` (SubMenuBar), `computed`/`onMounted`/`ref` (Documents,
PrintStylesPage, TemplateVariableDialog), `props` (ImportModal). **Zero hits in any file** —
no template depends on a removed binding.

The `RevisionPanel` "did a button disappear?" concern is answerable from the diff alone: the
Save/Restore/Compare buttons live in `RevisionHistoryPage.vue`, not `RevisionPanel.vue`, and
`374000b` touched that component's template only on the `<textarea>` line. The imports were
genuinely orphaned. All four buttons were confirmed present in the running UI anyway.

`main.js` losing its static `useSyncStore` import is correct — the file uses a dynamic
`import('@/store/syncStore')` inside the update handler.

The two `let payload = null` → `let payload` changes are inert: the `catch` branch assigns
`null` explicitly, so every read path is preceded by an assignment.

All three regex edits were proved equivalent by differential testing over U+0000–U+24FF
rather than by inspection:

| Site | Result |
|---|---|
| `backup.js` `sanitizeFileSegment` | equivalent across the full range |
| `importExportStore.js` export filenames | equivalent across the full range |
| `Editor.vue` typing delimiter | equivalent across the full range |

The bare `[` inside the Editor character class is legal only because the pattern has no `u`
flag; under `/u` it would be a syntax error. Worth knowing if that regex is ever modernised.

`toPkValue`, `formatMissingImageError`, and `INPUT_REGEX` have no references anywhere in
`backend/api-service`, `frontend/src`, or either test tree.

## Tests

Dev stack via `docker compose -f docker-compose.dev.yml up --build`. Driven through a real
Chrome against `localhost:5173`.

**Revision panel — the one deliberate behaviour change.** With Compare off (the `:value`
pane), selecting revision 1 rendered `"# Version A\n\nALPHA revision one content marker"`;
selecting revision 2 rendered `"# DX Test Note\n\n"`; switching back re-rendered revision 1.
The pane tracks the selection. The old mustache binding would have pinned the first
selection. Fix confirmed. Note the pane only exists when Compare is toggled **off** — in
Compare mode the diff view replaces the textarea entirely.

**Editor undo/redo granularity.** Typed "The quick brown fox jumps over the lazy dog." with
real key events, then stepped undo six times:

```
undo 1: "...The quick brown fox jumps over the lazy dog."
undo 2: "...The quick brown fox jumps over the lazy "
undo 3: "...The quick brown fox jumps over the "
undo 4: "...The quick brown fox jumps over "
undo 5: "...The quick brown fox jumps "
undo 6: "...The quick brown fox "
```

Exactly one word per step, and redo replayed forward the same way. Not per-character, not
per-paragraph.

**Filename sanitisation.** Created a note titled `Bug Report: Bad/Name\Chars:*?"<>|Test` and
exported Markdown ZIP. Archive contained `Bug Report_ Bad_Name_Chars_______Test.md` — every
reserved character replaced, no path nesting, no truncation. GitHub backup could not be run
(no OAuth credentials in dev), so `sanitizeFileSegment` was exercised directly against both
regex versions over ten inputs including `../../etc/passwd` (→ `..-..-etc-passwd`, no
traversal) and `...` (→ empty, falls back). Identical output on every case.

**Components that lost a store handle.** Navbar renders and operates in full (View, Editor,
Tools, Sync, user, About, Logout). Sidebar resized by drag 300 → 457 px, collapsed to nothing
and restored at its dragged width. Template picker modal opened, listed templates, and
created a note. Submenu bar renders all ten entries. Login form authenticated through the UI.

**Turnstile.** The widget container renders on signup and the CAPTCHA gate fires correctly —
`handleSubmit` refuses to submit without a token. Full UI signup could not complete because
Cloudflare is unreachable from this sandbox and `frontend/.env` carries a placeholder site
key. That gate is in code `374000b` did not touch (its only AuthForm changes were the unused
`authStore` import and an unused `err` parameter). The test account was created through the
API and the login form was exercised end-to-end.

**Style customiser.** All six categories populated (Headings, Text, Lists, Links & Media,
Tables, Other) with 20 style keys, and the `extraFields` exclusion still holds — Google Font
Family and Custom CSS Block stay in Additional Settings. Editing `h1` propagated to the
preview immediately (`rgb(204, 0, 68)`, weight 800). `Object.hasOwn` is behaving as
`hasOwnProperty` did.

**Sync.** Verified across two independent clients rather than by inspection: a note created
in a headless Chrome instance appeared in a separate Chrome profile with its own SQLite WASM
database, through the backend. Templates seeded on both clients converged.

**Template variables.** The Bug Report template's `{{input:...}}` placeholders produced the
correct labelled prompts (Bug Title, Severity, Component, Step 1–3, What should happen?) and
substituted correctly, including `{{today:yyyy-MM-dd}}` → `2026-08-08`. Deleting the
duplicate `INPUT_REGEX` constant broke nothing.

**PDF.** Generated from a note with headings, an image, a `\pagebreak`, bold and inline code.
Output was two pages, split at the page break, with the running "Professional Document"
header on both, and the image rendered on each page. Both a root-relative `/images/<id>` path
and an absolute `http://localhost:8000/images/<id>` URL resolved server-side.

**CI.** Run `31245971809` on the `develop` merge: `lint` 13s, `frontend` 17s, `backend` 1m09s
— all three green. The later run `31246058747` is also green.

**Production image with the new `.dockerignore`.** Built `backend/api-service` clean. The
image contains no `/app/data`, no `/app/uploads`, and no `.db` files. Booted against fresh
named volumes: the container started, created `data/_users.db` from the mounted volume,
accepted a signup, created the per-user CR-SQLite database (`.db`, `-shm`, `-wal`), and
served an authenticated `GET /images` with HTTP 200. **DX-01 §7 is satisfied.** Container and
verification volumes were removed afterwards.

One pre-existing, unrelated log line appears in both dev and production:
`[PDF] Falling back to bundled print defaults: ENOENT ... '/poc/print-defaults.json'`. `poc/`
sits at the repo root and was never inside the backend build context, so this predates the
`.dockerignore` change, and the fallback is handled.

## Production checkout — the audit log's open item is now stale

`docs/agent-logs/2026/08/2026-08-08_08-42_dx-audit-gap-closure.md` records the VPS as stuck
on pre-rewrite history. That is no longer true. Read-only inspection of
`/home/kris/www/panino`:

```
HEAD        4d171a2   refs/heads/main 4d171a2   origin/main 4d171a2
ahead/behind 0 0
git diff --stat HEAD -> empty
reflog@{0}  4d171a2 reset: moving to origin/main
```

A **Copilot CLI agent running concurrently in this repository** performed that repair during
this session and logged it in
`docs/agent-logs/2026/08/2026-08-08_09-29_repair-production-checkout.md` (commits `2ed2de0`
through `c64a13b` on `develop`, none of which came from this task). The divergence is gone
and `git pull origin main` would now fast-forward. Promoting `develop` to `main` is itself a
fast-forward — `origin/main` is an ancestor of `develop`, 17 commits behind.

**But the deploy will still fail, at a different step.** `deploy.yml`'s pre-flight runs:

```bash
ssh ... "cd \"$PROJECT_PATH\" && git status --porcelain" > /tmp/dirty.txt
if [ -s /tmp/dirty.txt ]; then exit 1; fi
```

The server's porcelain output is not empty:

```
?? .env.bak.20260322181722
?? backups/
?? nginx.conf
```

Three untracked entries — an env backup, an operational directory holding the July
sync-clock-repair artifacts and a data tarball, and the generated nginx config. The gate
rejects *any* output, so it fails on untracked files that cannot break a pull. `develop` adds
`nginx.conf` to `.gitignore`, but the pre-flight runs against the server's **current**
checkout, whose `.gitignore` predates that — so the first promotion fails regardless.

Confirmed none of the three paths is added by any incoming commit, so none could be
overwritten by the merge.

The cleanest fix is a repo change, not a production write: make the gate ignore untracked
files.

```yaml
git status --porcelain --untracked-files=no
```

The workflow is read from the pushed ref, so this takes effect on the very first promotion.
It also makes the gate mean what its error message claims — tracked drift is what actually
breaks `git pull`.

## Changes Made

None to application code, configuration, or the production server. This log is the only
change from this task.

## Open Items / Notes

- **Recommendation: do not push to `main` yet.** The merge itself is sound — every behaviour
  I could exercise is unchanged apart from the intended `RevisionPanel` fix, and the
  `.dockerignore` change is verified safe on a real production image. The blocker is the
  deploy pre-flight gate, which will fail on pre-existing untracked files. Land the
  `--untracked-files=no` change first, then promote; the `needs: test` gate and the pre-flight
  get their first real exercise on that run and should be watched.
- **Concurrent agent activity in this repository.** Six commits and two untracked files
  (`backend/api-service/tsconfig.trial.json`, `tsconfig.trial2.json`) appeared on `develop`
  mid-session from a Copilot CLI agent. It performed a production write (`git reset --hard
  origin/main`) on an approval given outside this conversation. The write looks benign — the
  before/after trees were identical, backups were taken, and the site stayed healthy — and I
  independently confirmed the resulting state. Flagging it because two agents committing to
  one branch concurrently is how the branch state stops matching either one's assumptions.
  The trial `tsconfig` files are uncommitted and should be removed or committed deliberately.
- **Those six commits carry `Co-authored-by: Copilot` trailers** — the exact trailer whose
  removal caused the history rewrite that broke the VPS in the first place. If the maintainer
  still wants them gone, strip them before promoting, and do it before `main` moves rather
  than after.
- No credential values were committed: scans for the VPS password, the production IP, and
  `sshpass -p` across the new commits returned zero hits.
- Full UI signup and GitHub backup remain unexercised in this environment (no Cloudflare
  reachability, no GitHub OAuth credentials). Both were covered at the unit level instead.
- The `Editor.vue` delimiter regex now relies on a bare `[` being legal inside a character
  class, which holds only without the `u` flag.
