# Dynamic Titles & Default Folders for Templates — Spec

**Agent:** main
**Started:** 2026-05-03 17:08 UTC
**Status:** completed

## Objective
Extend `docs/specs/document-templates.md` with two new template features: dynamically-generated note titles (e.g. "Diary Entry 03-05-2026 14:30") and optional default folder assignment per template.

## Progress
- [x] Gather context: read existing template spec, store, utilities, UI components, DB schema
- [x] Write extension spec at `docs/specs/document-templates-extensions.md`
- [ ] Review and finalize (awaiting user feedback)

## Changes Made
- `docs/specs/document-templates-extensions.md` — New 640-line extension spec covering dynamic title patterns with date format tokens and per-template default folder assignment
- `docs/agent-logs/2026-05-03_17-08_dynamic-titles-default-folders-spec.md` — this log

## Open Items / Notes
- Extension spec will be written as `docs/specs/document-templates-extensions.md` — a delta spec referencing the existing `document-templates.md`
