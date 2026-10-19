# Phone: remove the Inbox, add sorting

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-19 16:30 (+02:00)
- Status: complete on `feature/phone-sort-no-inbox`; not yet released

## Objective

Kris found the Inbox confusing and asked for it to go, and for sorting (alphabetical, date
created, date modified; ascending or descending) on the list and card views, working in the
current folder.

## Changes Made

- Inbox removed everywhere on phones: Home chip and count, Drawer row, All folders row,
  `docStore.countInbox`, the `inbox` Home filter (old `?filter=inbox` links show All notes), and
  the "New notes in a folder go to" setting. A note in no folder shows no chip; Move, capture and
  search results call it "No folder"; the editor status reads "Saved".
- Sorting: `uiStore.noteSort` (persisted in `uiSettings`), a sort button beside the Home chips
  and above a folder's notes, a sort sheet (`?sheet=sort`), and the same controls in Settings.
  `getRecentDocuments` / `getFolderDocuments` accept `{ sort }` and order in SQL from an
  allow-list; desktop calls are unchanged. `homeView.sortDocuments` merges across databases.
- The floating install card no longer shows on phones: in a headless run it covered the sort
  sheet's buttons, and Android Chrome users would meet the same. Settings offers install.

## Tests

- Unit: sort helpers, SQL ordering (allow-list, injected text ignored, merge keeps the sorted
  rows), Inbox filter gone. Frontend 63 files, 810 tests; lint clean.
- Browser at 390px (Puppeteer, local stack), 15/15: no Inbox on Home, Drawer, All folders or
  Settings; Title A–Z and Z–A, Created and Modified oldest first match an independently sorted
  list; the sort survives a reload; a folder follows it; a note in no folder has no chip;
  capture defaults to "No folder".

## Open Items / Notes

- Sorting applies to Home and folders; Search keeps relevance-free newest-first order.
- Subfolder tiles stay alphabetical whatever the note sort.
