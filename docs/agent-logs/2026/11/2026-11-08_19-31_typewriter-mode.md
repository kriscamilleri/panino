# Typewriter mode

- **Agent:** Claude (Opus 5.5), one of four parallel spec agents
- **Started:** 2026-11-08 19:00
- **Status:** in progress
- **Branch:** `feature/typewriter-mode` (from `develop` at `10b06f4`)
- **Spec:** [`docs/specs/active/typewriter-mode.md`](../../../specs/active/typewriter-mode.md)

## Objective

Build typewriter mode as the spec describes: one mode with sub-options (typewriter scrolling,
current-line highlight, context lines, paragraph or sentence dimming), drawn in a Panino overlay
inside OverType's wrapper, with settings in a synced `settings` row and entry points on desktop
(Editor menu, Ctrl/Cmd+Shift+Enter) and phone (Document menu, Settings → Writing).

## Progress

### Phase 0 — prototype checks (§12)

Throwaway harness: `frontend/tests/spike/typewriter/` (`index.html`, `spike.js`), served by my own
Vite on port 5181 and driven by headless Chromium (Puppeteer from the main checkout's
`backend/api-service/node_modules`). The driver script lived in the session scratchpad.

| # | Result |
|---|---|
| P1 | **Pass.** Fixture of 43 lines (front matter, ATX and setext headings, nested/ordered/task lists, fence, table, blockquote with bare `>`, `---`, `\pagebreak`, spaces-only line, long URL, tabs, CJK, emoji, trailing spaces, inline syntax): 43 flattened elements, 1:1, desktop and phone fonts. Each element's `offsetTop` is the row top; the whole-prefix mirror's marker sits a constant 3 px (desktop, 22.4 px rows) / 4 px (phone, 28 px rows) lower, which is the marker's half-leading, not a misalignment. |
| P2 | **Pass, with one finding.** 194 samples per form factor: the one-line mirror agrees with the whole-prefix mirror in every sample (0 mismatches). Against a Range on the highlight layer: 0 mismatches on desktop; on phone 2 in the CJK line, both exactly at a soft-wrap point, where a zero-width marker lands at the end of the earlier row while the character itself starts the next. The production code therefore wraps the **next character** in the marker (downstream position) and measures from a Range on the highlight layer first. |
| P3 | Done after Phase 3 in the harness, see below. |
| P4 | Chrome reveals the caret natively when it leaves the visible area (arrow keys and typing): scroll events before and after `input`. While attached in typewriter style the caret is held at the anchor, so this never fires. When detached and the caret is off screen, the controller scrolls synchronously in the `input` handler (instant), so the browser has nothing to reveal (the §12 fallback). |
| P5 | Not possible here (real iOS/Android keyboards). On the checklist for Kris. |
| P6 | OverType's own per-keystroke work dwarfs the overlay's. p50/p95 ms, headless Chrome, this laptop: 4,000 lines / 157 KB: OverType 42.9 / 50.5, measurement 0.67 / 2.09. 908 KB / 20,000 lines: OverType 228 / 249, measurement 2.6 / 5.1 (≈2 %, within the 10 % budget). One 50,000-character line: OverType 5.3 / 15.2, one-line mirror 2.8 / 5.2 (over the 2 ms budget). Decision: measure from a Range on the highlight layer (the browser lays it out anyway) and keep the one-line mirror only as the fallback; re-measured in Phase 3, below. |
| P7 | Not possible here (Japanese IME, Gboard). On the checklist. |
| P8 | **`findNext` does not reveal the match.** With the match on line 250 of 300, focus + `setSelectionRange` scrolled the pane to its maximum (6,149 px) while the match's row is at 5,617 px, above the visible area; `textarea.scrollTop` stays 0. So F2 is a real bug. In typewriter mode the controller follows the selection head, which fixes it while the mode is on. |
| P9 | Node 24 ICU pinned by unit tests (`e.g. the` not split, `Dr. Smith` split, quotes and brackets after the terminator, CJK). Chrome uses the same ICU data; Safari and Firefox not checked here (checklist). |
| P10 | Headless Chrome on Linux: Ctrl+Shift+Enter reaches the textarea's `keydown`, and `preventDefault` stops the newline. OverType's smart-list Enter handler skips Ctrl/Meta/Shift, so the key reaches `onKeydown`. Other OSes on the checklist. |
| P11 | Needs a human with a mouse and trackpad; kept 350 ms (the spec's starting value). On the checklist. |

### Phase 1 — utilities

`typewriterSettings.js`, `textFocus.js`, `typewriterScroll.js`, `focusGeometry.js` with unit tests.

## Changes Made

(filled in at the end)

## Tests

(filled in at the end)

## Open Items / Notes

(filled in at the end)
