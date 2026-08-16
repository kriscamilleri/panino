# DX-02 — CI Test Gate Before Deploy

> Run the test suite in CI and stop unverified code from auto-deploying to production.
> Status: done — verified 2026-08-16. `.github/workflows/test.yml` runs
> `lint`/`frontend`/`backend`, `deploy.yml` has `needs: test` and the dirty-checkout
> pre-flight, and `scripts/test-backend.sh` is the only definition of the backend test
> command. §8's deploy-path items are confirmed by the run history rather than by inspection:
> on 2026-08-08, `51ffcf1` on `main` shows `Tests` **success** followed by `Deploy to VPS`
> **success**, and the preceding `Deploy to VPS` failure at 07:06 is the diverged-checkout
> pre-flight doing its job before the server was repaired. The four SSH secrets are valid —
> that deploy used them. §7's branch-protection rule was **declined by the maintainer on
> 2026-08-16** as unnecessary at this stage; the checks remain advisory by choice, so this
> spec is complete as scoped.
> Created: 2026-08-08
> Last updated: 2026-08-16
> Priority: P0 — currently nothing runs tests at any point in the path to production
> Depends on: [DX-01](dx-01-backend-test-runnability.md) (tests must be runnable before they can gate)

---

## 1) Summary

`.github/workflows/deploy.yml` triggers on every push to `main`, SSHes to the VPS, and runs
`git pull && sudo ./deploy.sh`. No tests run. Combined with the ABI blocker described in
DX-01 — which prevents agents from running backend tests locally — there is currently **no
point in the lifecycle at which backend tests are reliably executed** before code reaches
users.

This spec adds a CI workflow that runs both suites on pull requests and on pushes to
`develop`/`main`, and makes the deploy job depend on it.

---

## 2) Problem & Evidence

### 2.1 The only workflow is a deploy

`.github/workflows/deploy.yml` in full:

```yaml
on:
  push:
    branches: [main]
jobs:
  deploy:
    steps:
      - Set up SSH Agent
      - run: ssh ... "cd $PROJECT_PATH && git pull origin main && sudo ./deploy.sh"
```

There is no `test.yml`, no build check, no lint step.

### 2.2 The gap has already been exercised

`docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md` records a production
`/sync` 500 affecting a real user, with the fix developed against a *manually built*
Docker image because the host suite would not run. The same log notes the patched
`sync.js` was **not deployed** at the time of writing — an unverified state that CI would
have made visible.

`docs/agent-logs/2026/04/2026-04-18_12-50_pr-thread-followup.md:46` records a deploy failure
(remote `git pull` blocked by local modified files on the VPS) discovered only *after* the
push to `main`.

### 2.3 The deploy is unguarded in a second way

`deploy.yml` runs `git pull origin main` on the server. If the server checkout is dirty —
which `prod-server-debug/SKILL.md` explicitly documents as a recurring situation, with a
whole "Deploy failed during `git pull`" workflow devoted to it — the deploy fails
*partway*. There is no pre-flight check and no notification on failure.

---

## 3) Goals

1. Both test suites run automatically on every PR targeting `develop` or `main`.
2. A red suite blocks the merge, and blocks the deploy if it somehow reaches `main`.
3. CI uses the exact same runner as local development, so "passes locally" and "passes in
   CI" cannot diverge.
4. Deploy failures are visible rather than silent.

## 4) Non-Goals

- No e2e / browser automation in CI. Chrome DevTools MCP validation stays a local,
  agent-driven step (see `feature-development/SKILL.md` Phase 4).
- No deployment to a staging environment.
- No change to `deploy.sh` itself or to the VPS topology.
- No branch-protection *policy* changes — this spec produces the required status check;
  enabling it as required is a repo-settings action for the maintainer (§7).

---

## 5) Proposed Change

### 5.1 New workflow: `.github/workflows/test.yml`

Two jobs, run in parallel:

| Job | Runner | Command |
|---|---|---|
| `frontend` | `ubuntu-latest`, Node 20 | `npm ci && npm test` in `frontend/` |
| `backend` | `ubuntu-latest`, Docker | `./scripts/test-backend.sh` (from DX-01) |

The backend job deliberately reuses `scripts/test-backend.sh` rather than duplicating the
setup in YAML. One definition of "run the backend tests", used by agents and CI alike.

### 5.2 Gate the deploy

`deploy.yml` gains a `needs:` dependency on a reusable call to the test workflow, so a push
to `main` with failing tests does not reach the VPS.

---

## 6) Implementation Steps

1. Create `.github/workflows/test.yml`:

   ```yaml
   name: Tests

   on:
     pull_request:
       branches: [develop, main]
     push:
       branches: [develop, main]
     workflow_call:        # so deploy.yml can depend on this

   jobs:
     frontend:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version-file: '.nvmrc'
             cache: npm
             cache-dependency-path: frontend/package-lock.json
         - run: npm ci
           working-directory: frontend
         - run: npm test
           working-directory: frontend

     backend:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - name: Run backend suite in the Node 20 test image
           run: ./scripts/test-backend.sh
   ```

   `node-version-file: '.nvmrc'` ties CI to the same pin DX-01 introduces — one source of
   truth for the Node version.

2. Modify `.github/workflows/deploy.yml` to depend on the tests:

   ```yaml
   name: Deploy to VPS

   on:
     push:
       branches: [main]

   jobs:
     test:
       uses: ./.github/workflows/test.yml

     deploy:
       needs: test
       runs-on: ubuntu-latest
       steps:
         - name: Set up SSH Agent
           uses: webfactory/ssh-agent@v0.9.0
           with:
             ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
         - name: Check server checkout is clean
           env:
             SSH_USER: ${{ secrets.SSH_USER }}
             SSH_HOST: ${{ secrets.SSH_HOST }}
             PROJECT_PATH: ${{ secrets.PROJECT_PATH }}
           run: |
             ssh -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
               "cd \"$PROJECT_PATH\" && git status --porcelain" > /tmp/dirty.txt
             if [ -s /tmp/dirty.txt ]; then
               echo "::error::Server checkout is dirty; deploy would fail on git pull:"
               cat /tmp/dirty.txt
               exit 1
             fi
         - name: Deploy to server
           env:
             SSH_USER: ${{ secrets.SSH_USER }}
             SSH_HOST: ${{ secrets.SSH_HOST }}
             PROJECT_PATH: ${{ secrets.PROJECT_PATH }}
           run: |
             ssh -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
               "cd \"$PROJECT_PATH\" && git pull origin main && sudo ./deploy.sh"
   ```

   The dirty-checkout pre-flight turns the recurring failure documented in
   `prod-server-debug/SKILL.md` into a clear CI error naming the offending files, instead
   of a half-finished deploy.

3. Confirm the pre-existing `sync.revision.test.js` failures are resolved or skipped
   (DX-01 Phase 7). **Do not merge this spec while the suite is red** — a permanently
   failing required check gets routed around and is worse than no check.

4. Update `.github/skills/feature-development/SKILL.md` Phase 8 to state that CI runs both
   suites on the PR, and that the agent should check the CI result before reporting the PR
   as complete.

---

## 7) Maintainer Actions (outside the agent's scope)

These require repo admin and cannot be done by an agent editing files:

- **Branch protection — declined 2026-08-16 by the maintainer.** Not needed at this stage.
  A protection rule on `main` requiring the `lint`/`frontend`/`backend` checks was the
  original proposal; the checks still run on every push and PR, they are simply advisory
  rather than enforced. Revisit if more than one person starts pushing to `main`.
- [x] Confirm `SSH_PRIVATE_KEY`, `SSH_USER`, `SSH_HOST`, `PROJECT_PATH` secrets still
      exist and are valid. Verified 2026-08-16: the 2026-08-08 `Deploy to VPS [main]` run
      for `51ffcf1` succeeded using all four.
- [ ] Decide whether deploy failures should notify (GitHub already emails on workflow
      failure for the actor; a Slack/email step is optional).

---

## 8) Validation Checklist

- [ ] `test.yml` runs on a PR into `develop` and both jobs pass.
- [ ] Breaking a frontend test on a branch causes the `frontend` job to fail and the PR to
      show a red check.
- [ ] Breaking a backend test causes the `backend` job to fail.
- [ ] A push to `main` runs tests *before* the deploy job starts (verify job ordering in
      the Actions UI).
- [ ] With the server checkout artificially dirtied, the pre-flight step fails with a
      readable error naming the files, and the deploy step does not run.
- [ ] A clean push to `main` still deploys successfully end to end.
- [ ] `scripts/test-backend.sh` is the only definition of the backend test command — no
      duplicated Docker setup in YAML.

---

## 9) Risks & Rollback

| Risk | Mitigation |
|---|---|
| Backend Docker build in CI is slow (no local layer cache) | Acceptable at current suite size; if it exceeds ~8 min, add `docker/build-push-action` with GHA cache |
| A flaky test blocks deploys | Quarantine flakes with `.skip` + a linked agent log rather than disabling the gate |
| Deploy gate makes hotfixes slower | Documented escape hatch: run `deploy.sh` manually on the VPS via the `prod-server-debug` skill; note it in the agent log |

Rollback: revert `deploy.yml` to its current form. `test.yml` can remain independently —
it is additive and harmless on its own.

---

## 10) Handover Notes

Land `test.yml` first and let it run green on a few PRs before wiring the `needs:` gate
into `deploy.yml`. Gating a deploy on a check nobody has observed passing is how you
discover CI problems at the worst possible moment.
