# Recent Documents Redesign — Implementation

- Agent: Claude Code (Opus 5)
- Start: 2026-08-16 15:05
- Branch: `feat/recent-documents-redesign`
- Spec: [`docs/specs/proposed/recent-documents-redesign.md`](../../../specs/proposed/recent-documents-redesign.md)
- Status: in progress

## Objective

Implement the Recent Documents / folder-document dashboard redesign: shared
`DocumentDashboard` for the global `__recent__` route and real folder routes, a global-only
Continue Writing rail, quick filter, type filter, sort, time grouping, and a synced `pinned`
note attribute.

## User journeys

| # | Persona | Journey | Acceptance |
|---|---|---|---|
| U1 | Returning writer | Opens the app at root, sees Continue Writing cards for the three most recently edited notes, clicks one | The exact note opens through the existing `selectFile` + `doc` route flow |
| U2 | Writer with many notes | Types part of a title, folder path, or excerpt into the header quick filter | The cards and grouped list narrow live; a clear control restores the unfiltered set |
| U3 | Writer keeping a working set | Pins a note from a card or a row, then filters to `Pinned` | The pin persists across reloads and devices; the filter shows only pinned notes |
| U4 | Writer inside a project folder | Opens a folder, uses the same header/filters/list, and filters to `Pinned` | Only notes directly in that folder appear; descendant notes never leak in |
| U5 | Writer starting fresh | Presses `New Note` on Recent Documents and on a folder view | A root note and a folder note are created respectively, then opened |
| U6 | Keyboard / screen-reader user | Tabs to a row or card and presses Enter/Space; tabs to a pin button | The note opens; the pin toggles without opening the note; names and `aria-pressed` are announced |
| U7 | Phone user (375px) | Scans the list | Metadata stacks below the excerpt, the pin stays top-right, nothing scrolls horizontally |
| U8 | Multi-device user | Edits/pins on device A while a dashboard is mounted on device B | `recentDocVersion` bumps after sync and the dashboard reloads without a manual refresh |

## Progress

(updated as work lands)

## Changes Made

(see final section)

## Tests

(see final section)

## Open Items / Notes

(see final section)
