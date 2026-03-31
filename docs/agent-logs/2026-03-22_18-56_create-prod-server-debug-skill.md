# Create Prod Server Debug Skill

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 18:56
**Status:** completed

## Objective
Create a reusable workspace skill for debugging and quickly navigating the Panino production server.

## Progress
- [x] Load the customization guidance skill
- [x] Inspect the repo for any existing customization layout
- [x] Create a workspace skill for production server debugging and navigation
- [x] Record the task in the required agent log

## Changes Made
- `.github/skills/prod-server-debug/SKILL.md` — added a workspace skill covering safe VPS navigation, Docker/log inspection, env masking, deployment drift checks, and Panino-specific production paths.
- `docs/agent-logs/2026-03-22_18-56_create-prod-server-debug-skill.md` — recorded this skill-creation task.

## Tests
- Verified the repo had no pre-existing `.github/skills/` structure, so the new skill uses the standard workspace location.
- Included required YAML frontmatter with `name` and `description` for skill discovery.

## Open Items / Notes
- The skill intentionally avoids hardcoding SSH passwords or other secrets.
- If you want, this can be extended with companion prompts or agents for common production tasks like deploy triage or log collection.