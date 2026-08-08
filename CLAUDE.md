# Panino — Claude Code Instructions

The canonical agent handbook for this repository is [`AGENTS.md`](AGENTS.md). Read it first,
then read the layer file for the area you are working in:
[`frontend/AGENTS.md`](frontend/AGENTS.md) or
[`backend/api-service/AGENTS.md`](backend/api-service/AGENTS.md).

@AGENTS.md

## Claude-specific notes

- Project skills live in `.claude/skills/`, a symlink to `.github/skills/`, which is the
  canonical shared location. Edit `.github/skills/<name>/SKILL.md` directly.
- Backend tests run in Docker — use `npm run test:be`. A host-native run on Node 21+ can fail
  with a native-binding ABI error; that is an environment condition, not a code defect.
- Before proposing production changes, load the `prod-server-debug` skill.
