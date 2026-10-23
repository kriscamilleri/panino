# Phone: new-note buttons, autosaving capture, new folder from capture

- **Agent:** Claude Code (Opus 5.5)
- **Started:** 2026-10-23 11:30
- **Status:** Done, not committed

## Objective

On phones: replace the bottom capture bar with two buttons (new note, new note from template);
allow creating a folder while capturing; save the capture draft as soon as the body has any
text, titled from the typed title or else the body's first three words (at most 50 characters).

## Progress

- `CaptureBar` replaced on Home and in folders by `NewNoteButtons` (floating, bottom right,
  6px control radius). Folders gain the template button; the template is created in that folder.
- `QuickCaptureSheet` autosaves. The first write happens on the first body character; later
  writes wait for a 500 ms pause. Every write goes through one promise queue per opening of the
  sheet, holding what the database has (`saved`), and reconciles folder (move), title (rename) and
  content (update). A destination in another database creates the note there and then deletes
  the first copy. Header is now Discard / status / Done. Done, swipe-down and back flush and keep
  the note; Done stays open if the write failed. Discard (confirmed) deletes it; a note emptied
  before closing is deleted.
- A title alone is not autosaved while typing (the trigger is body text), but it is saved on close.
- "Save to" list has a "New folder" row: a top-level personal folder, chosen at once.
- `titleFromBody` in `utils/markdownSnippet.js`: up to three words, words that would pass 50
  characters are left off, a single longer word is cut at 50.
- Scroll padding raised to clear the buttons; phone toasts moved from `bottom-28` to `bottom-40`.

## Changes Made

- `frontend/src/components/phone/NewNoteButtons.vue` (new)
- `frontend/src/components/phone/QuickCaptureSheet.vue`, `PhoneHome.vue`, `PhoneFolderView.vue`
- `frontend/src/utils/markdownSnippet.js`, `frontend/src/components/ToastContainer.vue`
- `frontend/tests/unit/quickCaptureSheet.test.js`, `frontend/tests/unit/phoneHomeUtils.test.js`
- `frontend/AGENTS.md` (phone layout section)

## Tests

- `npm run test:fe`: 64 files, 826 tests pass. `npm run lint`: clean.
- Browser, Puppeteer at 390 px against the local dev stack, disposable account, 17/17: no bar on
  Home or in a folder, both buttons present; note exists after the first character; title
  "Hello there wonderful" from "Hello there wonderful world, how are you"; content follows typing;
  one Document only; New folder from "Save to" chosen and the saved note moved into it; Done
  closes with no `sheet=` in the URL; Discard deletes (1 → 2 → 1); back keeps the latest text;
  template picker opens. Screenshots checked (styles loaded).

## Open Items / Notes

- `CaptureBar.vue` is no longer used but still on disk: it carried uncommitted style edits, so it
  was not removed here.
- Done now returns to the list rather than opening the note in the editor.
