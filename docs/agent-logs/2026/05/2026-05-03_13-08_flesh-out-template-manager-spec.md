# Flesh out Template Manager Spec

**Agent:** assistant (session 1)
**Started:** 2026-05-03 13:08
**Status:** completed

## Objective
Take an existing high-level `document-templates.md` spec and flesh it out into a comprehensive implementation-ready spec at the same level of detail as `image-management.md`.

## Progress
- [x] Read project AGENTS.md, router, syncStore.js, db.js, and existing specs
- [x] Read ImageManagerPage.vue (reference pattern — "similar to Images manager")
- [x] Read SubMenuBar.vue, AccountLayout.vue, SettingsPage.vue for integration patterns
- [x] Read image.js (backend CRUD pattern), imageManagerStore.js (frontend store pattern)
- [x] Read test patterns (subMenuBarToolsMenu.test.js, testHelpers.js)
- [x] Rewrote `docs/specs/document-templates.md` with comprehensive detail

## Changes Made
- `docs/specs/document-templates.md` — Complete rewrite from 71 lines to ~600+ lines covering:
  - Problem statement with current gaps
  - Goals and non-goals (v1 scope)
  - UX/UI: Tools menu entry, Template Picker Modal, Template Variable Dialog, dedicated management page with inline editor
  - Data model: `templates` table schema, CRR registration on both frontend and backend
  - Template variables: `{{input:Label}}`, `{{today}}`, `{{now}}` with regex patterns and resolution order
  - 4 bundled starter templates (Meeting Notes, Project Brief, Journal Entry, Bug Report) with seeding logic
  - API contract: frontend-only CR-SQLite (no backend routes needed)
  - Full Pinia store (`templateStore.js`) and utility functions (`templateVariables.js`)
  - File manifest (8 new files, 7 modified files)
  - Router, SubMenuBar, and sidebar integration details
  - Security considerations (sanitization, injection prevention, offline support)
  - 13-step implementation plan
  - Test matrix: 6 categories, 28 individual test cases
  - Open questions with resolved decisions

## Tests
- N/A — spec-only change, no code to test

## Open Items / Notes
- The old `document-templates.md` already existed as a draft from 2026-03-21. The new version supersedes it entirely.
- Ready for an implementation agent to pick up as a follow-up task.
