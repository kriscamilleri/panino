# Spec GitLab Backup Support

**Agent:** GitHub Copilot GPT-5.4
**Started:** 2026-03-22 18:04
**Status:** completed

## Objective
Write a concrete implementation spec for adding GitLab backup support while leaving Forgejo for later.

## Progress
- [x] Review the existing GitHub backup spec and current implementation shape
- [x] Verify GitLab OAuth and REST API details against upstream documentation
- [x] Draft a GitLab backup support spec with scope, UX, backend design, data model changes, and testing requirements

## Changes Made
- `docs/specs/gitlab-backup.md` — added a focused spec for implementing GitLab backup support on top of the existing backup system.
- `docs/agent-logs/2026-03-22_18-04_spec-gitlab-backup.md` — recorded this spec-writing session.

## Tests
- No code changes; tests not run.

## Open Items / Notes
- The spec assumes GitHub backup remains supported and recommends a provider abstraction rather than a GitLab-only fork of the current backup module.
- The spec keeps Forgejo out of scope and treats self-managed GitLab as a deployment-level configuration rather than a per-user instance selector.