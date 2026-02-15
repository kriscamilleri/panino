# Expand agents.md into comprehensive handbook

**Agent:** GitHub Copilot (Claude Opus 4.6)
**Started:** 2026-02-15 12:00
**Status:** completed

## Objective
Replace the minimal 4-rule agents.md with a comprehensive handbook covering all project architecture, conventions, patterns, testing, security, deployment, and agent workflow rules.

## Progress
- [x] Read existing agents.md and copilot-instructions.md
- [x] Explore full project structure
- [x] Analyze all backend modules (index, auth, signup, passwordReset, sync, image, pdf, db, mailer)
- [x] Analyze all frontend stores (syncStore, authStore, structureStore, docStore, markdownStore, uiStore, draftStore, editorStore, historyStore, globalVariablesStore, importExportStore)
- [x] Analyze key components (Editor.vue, Preview.vue, AppShell.vue)
- [x] Review testing setup, helpers, fixtures, and existing test patterns
- [x] Review Docker, deployment, and infrastructure config
- [x] Write comprehensive 12-section agents.md with progress logging requirement
- [x] Create `docs/agent-logs/` directory for agent progress logs
- [x] Split agents.md into root (cross-cutting) + backend/frontend layer-specific files

## Changes Made
- `agents.md` — Root handbook with 9 cross-cutting sections (workflow, overview, architecture, dev env, DB & sync, conventions, security, deployment, cheat sheet). Pointers to layer-specific files.
- `backend/api-service/agents.md` — Backend-specific: module map, route mounting, auth pattern, DB architecture, WebSocket, PDF generation, testing framework/helpers/conventions.
- `frontend/agents.md` — Frontend-specific: entry points, route protection, all Pinia stores with deps, DB access patterns, Editor→Preview→DB data flow, component patterns, toast system, variable substitution, frontend conventions.
- `docs/agent-logs/.gitkeep` — Created directory for agent progress log files

## Tests
- N/A (documentation-only change)

## Open Items / Notes
- The copilot-instructions.md file (`.github/instructions/copilot-instructions.md`) largely mirrors the new agents.md content. Consider whether to keep both in sync or make one reference the other.
