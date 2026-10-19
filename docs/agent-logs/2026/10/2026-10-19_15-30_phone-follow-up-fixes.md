# Phone follow-up fixes: keyboard, back loop, styles pages

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-19 15:30 (+02:00)
- Status: complete on `fix/phone-keyboard-viewport`; released through `develop` to `main`

## Objective

Three problems Kris found on an iPhone after the phone redesign shipped
(`2026-10-19_10-44_mobile-ui-redesign.md`): the editor's text vanished when tapping to type
until a second tap; Styles and the editor sent each other back in a loop; and the Styles and
Print styles pages were still the desktop layout on a phone.

## Changes Made

| Commit | What |
| --- | --- |
| `1c8396f` | Phone screens and sheets pinned to `visualViewport` (top and height) instead of `100dvh` minus an inset from `innerHeight`; docked key row at the bottom of its screen; re-measure after focus changes |
| `a8bef1a` | Styles pages' Back returns to the opener; phone back arrows go back only to a list screen, otherwise up to the parent (`utils/phoneNavigation.js`) |
| this commit | `StyleCustomizer` phone branch: one top bar, Preview / Styles switch, full-width fields at 16px, no Editor pane; Print styles links the full PDF on phones |

## Tests

- Keyboard: replayed iOS viewport numbers in Chrome (stubbed `visualViewport` and
  `innerHeight`). Before: when `innerHeight` grew mid-animation the shell shrank to 205px and the
  key row sat under the Write / Preview switch, matching the device screenshot; the next event
  restored it, like the second tap. After: 324px of editor throughout, key row at the keyboard,
  shell following a panned viewport, full height back on close, capture sheet ending at the
  keyboard.
- Back loop: scripted Document → Export → Edit style → Back → ←. Before: Print styles and the
  Document alternated indefinitely. After: Back returns to the Document and ← reaches Home; the
  same through ⋯ → Styles.
- Styles pages at 390px: no sideways scroll, one pane at a time, 16px fields, PDF link; at
  1280px both pages render the desktop layout.
- Unit: `useViewport.test.js`, `phoneNavigation.test.js`; frontend suite 63 files, 805 tests;
  lint clean.

## Open Items / Notes

- The keyboard behaviour is reproduced from simulated viewport numbers; confirm on the iPhone.
- Desktop styles pages now return to the opener on Back instead of always pushing the Document
  or Home; that also ends the same ping-pong with desktop browser back.
