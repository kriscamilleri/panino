# Assess GitLab And Forgejo Backups

**Agent:** GitHub Copilot GPT-5.4
**Started:** 2026-03-22 17:59
**Status:** completed

## Objective
Assess how difficult it would be to extend the existing GitHub backup feature to support GitLab and Forgejo as additional backup providers.

## Progress
- [x] Read project-level and backend agent instructions
- [x] Identify the current backup implementation files and GitHub-specific coupling points
- [x] Summarize effort, risks, and a pragmatic migration path for GitLab and Forgejo support

## Changes Made
- `docs/agent-logs/2026-03-22_17-59_assess-gitlab-forgejo-backups.md` — created the required task log for this analysis session.

## Tests
- No code changes; tests not run.

## Open Items / Notes
- The snapshot builder itself is reusable, but auth, repository operations, status routes, frontend store, modal wiring, query params, and tests are all GitHub-specific today.
- GitLab support is a medium-sized extension if the backup core is refactored behind a provider interface first.
- Forgejo support is feasible after that, but it likely needs instance/base-URL configuration and a provider separate from GitHub because its API shape is closer to Gitea/Forgejo than GitHub.