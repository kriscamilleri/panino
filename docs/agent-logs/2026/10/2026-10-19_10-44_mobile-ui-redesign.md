# Phone UI redesign: all four releases

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-19 10:44 (+02:00)
- Status: complete on `feature/mobile-ui`; nothing pushed, no PR

## Objective

Kick off the phone redesign in `docs/specs/shipped/mobile-ui/panino-mobile-ui-spec.md` on a new
branch, write a proper implementation spec first, then build and test it locally, committing as
work progresses, and remove classes and functions the new UI makes unnecessary.

## Progress

1. Branched `feature/mobile-ui` from `origin/main` (`d2f5ed5`, which already contains
   `feature/collab`).
2. Resolved the design spec's open questions against the code and wrote
   `implementation-spec.md`: Inbox is `folder_id IS NULL` (no new row), no note colours, no
   Trash (delete with confirmation), sharing is per space with editors only, one print style
   (no preset tiles), snippets stripped at render time, no schema change anywhere.
3. Built the four releases in the spec's order, each through utilities, then stores, then
   components, and checked each in the browser before committing.
4. Removed the code that only ran below 768 px once phones had their own screens.

## Changes Made

| Commit | What |
| --- | --- |
| `f1c7a02` | Design spec, mockups and the implementation spec |
| `412cfd0` | Release 1: single-pane Write / Preview editor, key row, tappable Preview checkboxes, Document menu, Appearance gains System |
| `922785c` | Fix: Write mode was blank after Preview (opaque textarea over OverType's text layer; stale size while hidden) |
| `cdbbdf9` | Releases 2–3: card Home, Quick capture, Drawer, folder screens, All folders, Search, Move with Undo, multi-select |
| `1c087f4` | Cleanup: MobileMenu, OfflineIndicator (unmounted), Navbar mobile button and `md:` variants, sidebar and ContentArea phone branches, dashboard phone-only metadata |
| `d8ff3de` | Release 4: Collaborate and Export sheets, remote carets, phone Settings, install prompt, deep-link return after loading |

Also removed: `uiStore.collapseDocumentsOnMobile`, which collapsed the sidebar setting that
desktop shares. Shared helpers replace three duplicates: `useSyncToggle` (Navbar and the deleted
MobileMenu), `utils/pdfExport.js` (print styles page and Export sheet), `usePwaInstall` (install
banner and Settings).

## Tests

- `npx vitest run` in `frontend/`: 61 files, 800 tests pass (baseline 56 files, 733). New:
  `phoneEditorUtils`, `phoneHomeUtils`, `phoneSearchUtils`, `pdfExport`, `phoneComponents`, and
  additions to `themeStore`, `toastContainer`, `docStoreDocuments`, `unifiedTree`.
- `npx eslint frontend/src frontend/tests`: clean.
- Production build (`vite build` into the scratchpad): succeeds.
- Backend: not changed, not rerun.
- Browser (desktop Chrome, app in a same-origin 390 × 712 iframe because the window would not
  resize; isolated stack: API in Docker on 127.0.0.1:8011 with both collab flags on, own
  volumes, Vite on 127.0.0.1:5181, disposable account):
  - Preview opens existing Documents; Write and Preview never show together; tapping a box
    wrote `- [x] Rail pass` to the database and stayed in Preview without focusing the text.
  - Key row: `#` and `[ ]` applied at the caret line with focus kept; undo stepped back twice and
    the database matched.
  - Capture: bar → typing → Save created an Inbox Document titled from its first line without
    markdown, opened it in Write, and back returned to Home.
  - Drawer → Travel → Japan 2027 → search "rail" with the folder chip preset and the match
    marked; Move to Work, then to Inbox, then Undo, all reflected in the database and the editor
    status line.
  - All folders swipe actions through the ⋯ button; Export rendered a Letter PDF (200) and
    produced `Packing list.pdf` (link click stubbed, nothing saved to disk); Settings layout
    choice saved to `uiSettings`; offline banner, grey dot and polite announcements across
    screens; live session on a space Document showed "Live · 1 editing" and "Editing now";
    an injected participant drew a named caret before "Rail".
  - Dark mode on Home and the menu; long-press selection; a reload returned to the open Document.
  - At 1240 px the desktop layout matched the old one (Navbar, tree, editor beside preview,
    disabled checkboxes) and the Navbar sync toggle still turned sync off and on.

### Pre-merge run (same day)

- `npm run lint && npm test` from the root: lint clean; shared, frontend (61 files, 800 tests)
  and backend in Docker (30 files, 437 tests) pass.
- Frontend built with the server's Node 22.14.0 / npm 10.9.2 from a clean `git archive`.
- `develop` reset to `main` (`d2f5ed5`, lease on the old tip `522ac91`, whose three commits were
  already on `main` as `a26a051`, `4166b4c`, `8d4eb4f`).
- Two real devices (Puppeteer, separate fresh profiles; owner on a 390 px phone, a second
  member invited through MailHog on a 1280 px desktop), runbook
  `live-session-recovery.md` steps 1, 2 and 4, 14/14 checks: both join and see each other,
  interleaved typing converges with nothing lost or doubled, the phone draws the desktop
  member's caret, killing the API container and starting it again restores the acknowledged
  text and editing continues, Save version from the phone stores the session text, leaving
  ends the session and solo edits sync to the other device. Step 5's overlapping save opened the
  conflict resolver on the phone. Steps 3 and 6 test server code this branch does not touch.
- Found and fixed by that run: phone sheets sat above app dialogs (z-index 60 over 50), so the
  Save version dialog, and any conflict dialog, opened hidden behind the Collaborate sheet and
  the click landed on the sheet. Sheets and the Drawer now sit at 45.
- Harness traps, for next time: a graceful `docker restart` closes sessions on purpose (the
  runbook kills the container); a reused Chrome profile restores old tabs and hangs on the shared
  local database; and a run that edits a Document outside a session leaves the next run's
  Save version in conflict, so each run needs a fresh Document.

## Open Items / Notes

- **Security, existing, not changed here:** `backend/api-service/pdf.js` interpolates
  `printStyles.pageSize` and `customCSS` unescaped into the HTML Puppeteer renders, with
  JavaScript enabled and no request interception. A signed-in user can close the `<style>` and
  run script in the renderer, including requests to internal addresses. The phone Export sheet
  only ever sends `A4` or `Letter`. Worth its own fix: allow-list `pageSize`, escape `</style`
  in CSS, and disable JavaScript or intercept requests in the PDF page.
- Not verified on real phones: key row docking above the keyboard (iOS Safari, Android Chrome,
  rotation), VoiceOver and TalkBack.
- Remote carets use the character offset last sent, not Yjs relative positions.
- The build's service-worker copy step writes `frontend/dist/service-worker.js` regardless of
  `--outDir`; a check build here overwrote that generated file.
- syncStore still shows its own "You're offline" toast, which repeats the phone banner.
- Crossing 768 px (rotation, split screen) remounts the Editor, which saves pending text and
  ends a live session.
- Not built: iOS PNG icons, find and replace on phones, moving folders on phones.
- The stack is still running for further checks: `docker compose -p panino-mobileui` (API on
  127.0.0.1:8011, MailHog UI on 127.0.0.1:8026) and Vite on 127.0.0.1:5181.
