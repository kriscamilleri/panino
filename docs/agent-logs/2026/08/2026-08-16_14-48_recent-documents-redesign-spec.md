# Recent Documents redesign spec

- **Agent:** Copilot CLI
- **Start:** 2026-08-16 14:48 CEST
- **Status:** Complete

## Objective

Create an implementation-ready proposed specification for updating the Recent Documents home
view and selected-folder document views to match the supplied dashboard reference.

## Progress

Reviewed the current root-route composition, the special `__recent__` `FolderPreview` branch,
the selected-folder preview branch, the recent-document store query and normalization helper,
existing document creation/search flows, the design-system contracts, and the existing
recent-document unit tests.

## Changes Made

- Added `docs/specs/proposed/recent-documents-redesign.md`.
- Captured the visual layout, exact local data behavior, persistent pin schema requirements,
  filtering/sorting/grouping rules, accessibility/responsive requirements, implementation
  boundaries, risks, and test/validation checklist.
- Linked the supplied reference image from the proposed spec.
- Expanded the dashboard scope to selected folders. Folder views share the dashboard header,
  creation action, filtering, grouped document rows, and folder navigation, while Recent
  Documents alone keeps the global Continue Writing rail.
- Defined `Pinned` scope precisely: Recent Documents includes pins from all folders; a selected
  folder includes only pins on notes directly assigned to that folder, never descendants.

## Tests

No code changed; tests were not required. The specification's test plan identifies the focused
unit, store, component, and browser validation required when implementation starts.

## Open Items / Notes

- The current application has neither a `pinned` note field nor a shared-document ownership
  model. The spec therefore includes a synced pin migration and deliberately excludes the
  reference's otherwise no-op `My notes` control.
- The header filter is scoped accurately to loaded recent documents. Full workspace/tag/body
  search remains the separate Advanced Search proposal.
- Folder filtering is direct-folder scoped (`notes.folder_id = ?`) so a descendant's pinned note
  cannot leak into an ancestor's Pinned results.
