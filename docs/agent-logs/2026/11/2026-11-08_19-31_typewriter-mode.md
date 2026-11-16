# Typewriter mode

- **Agent:** Claude (Opus 5.5), one of four parallel spec agents
- **Started:** 2026-11-08 19:00
- **Status:** implementation complete on the branch; real-app and real-device checks listed
  below remain for a human
- **Branch:** `feature/typewriter-mode` (from `develop` at `10b06f4`)
- **Spec:** [`docs/specs/active/typewriter-mode.md`](../../../specs/active/typewriter-mode.md)
  (moved from `proposed/`; §19 records how the build differs from the text)

## Objective

Build typewriter mode as the spec describes: one mode with sub-options (typewriter scrolling,
current-line highlight, context lines, paragraph or sentence dimming), drawn in a Panino overlay
inside OverType's wrapper, with settings in a synced `settings` row and entry points on desktop
(Editor menu, Ctrl/Cmd+Shift+Enter) and phone (Document menu, Settings → Writing).

## Progress

### Phase 0 — prototype checks (§12)

Throwaway harness: `frontend/tests/spike/typewriter/index.html` + `spike.js`, served by my own
Vite on port 5181 and driven by headless Chromium (Puppeteer from the main checkout's
`backend/api-service/node_modules`). Driver scripts lived in the session scratchpad.

| # | Result |
|---|---|
| P1 | **Pass.** Fixture of 43 lines (front matter, ATX and setext headings, nested/ordered/task lists, fence, table, blockquote with bare `>`, `---`, `\pagebreak`, spaces-only line, long URL, tabs, CJK, emoji, trailing spaces, inline syntax): 43 flattened elements, 1:1, desktop and phone fonts. Each element's `offsetTop` is the row top; the whole-prefix mirror's marker sits a constant 3 px (desktop, 22.4 px rows) / 4 px (phone, 28 px rows) lower, which is the marker's half-leading, not a misalignment. |
| P2 | **Pass, with one finding.** 194 samples per form factor: the one-line mirror agrees with the whole-prefix mirror every time. Against a Range on the highlight layer: 0 mismatches on desktop; on phone 2 in the CJK line, both exactly at a soft-wrap point, where a zero-width marker lands at the end of the earlier row while the character starts the next. The production code measures from a Range on the highlight layer and, in the mirror fallback, wraps the **next character** in the marker. |
| P3 | **Pass** (harness, after Phase 3). Band and scrim paint over the text and under the caret and selection, over code-block lines, light and dark, desktop and phone. Screenshots below. Phone remote carets not checked (needs a live session). |
| P4 | Chrome reveals the caret natively when it leaves the visible area (arrow keys and typing). Attached in typewriter style the caret is held at the anchor, so this never fires. When detached, the controller scrolls synchronously from OverType's `onChange` after the `input` (instant), so there is one move, not two. |
| P5 | Not possible here (real iOS/Android keyboards). Emulated by resizing the viewport: re-anchors above the key row. On the checklist. |
| P6 | Spike, p50/p95 ms, headless Chrome on this laptop. 4,000 lines / 157 KB: OverType's own keystroke 42.9 / 50.5, measurement 0.67 / 2.09. 908 KB: OverType 228 / 249, measurement 2.6 / 5.1. One 50,000-character line: OverType 5.3 / 15.2, one-line mirror 2.8 / 5.2 (over budget), hence the Range measurement. **Re-measured with the real controller** (whole rAF frame, the browser's own layout flushed first): 4,000 lines 0.70 / 1.01 (paragraph), 0.74 / 1.04 (sentence) — within 2 ms; 1 MB 3.2 / 3.3 (paragraph), 3.2 / 5.6 (sentence) — about 2 % of OverType's 228 ms rebuild, within the 10 % rule; 50,000-character line 0.13 / 0.22 (paragraph), 0.47 / 1.02 (sentence). |
| P7 | Not possible here (Japanese IME, Gboard). On the checklist. |
| P8 | **`findNext` does not reveal the match.** Match on line 250 of 300: focus + `setSelectionRange` scrolled the pane to its maximum (6,149 px) while the match's row is at 5,617 px, above the visible area; `textarea.scrollTop` stays 0. F2 is a real bug for everyone with the mode off. With the mode on, the controller follows the selection head and the match lands on the anchor. |
| P9 | Node 24 ICU pinned by unit tests (`e.g. the` not split, `Dr. Smith` split, closing quotes and brackets, CJK). Chrome shares ICU; Safari and Firefox on the checklist. |
| P10 | Headless Chrome on Linux: Ctrl+Shift+Enter reaches the textarea's `keydown`, `preventDefault` stops the newline, and OverType's smart-list Enter handler skips Ctrl/Meta, so the key reaches `onKeydown`. Other OSes on the checklist. |
| P11 | Needs a human with a mouse and trackpad; kept 350 ms. In the harness a relaxed double-click (two clicks 250 ms apart) selected the word with no scroll. Finding: `PointerEvent.detail` is 0 in Chrome, so the click count comes from `mousedown`. |

### Phases 1–4

1. **Utilities** — `typewriterSettings.js`, `textFocus.js`, `typewriterScroll.js`,
   `focusGeometry.js`, each with unit tests.
2. **Store** — `typewriterStore.js`: row `typewriter`, desktop and phone profiles, 500 ms
   debounce, reloads after each sync round.
3. **Controller and layer** — `useTypewriter.js` (+ `createDomLayout`,
   `createTypewriterController`), `TypewriterLayer.vue`, Editor wiring, provides in ContentArea and
   PhoneEditor, `onViewportSettled` in `useViewport.js`, CSS tokens.
4. **Entry points** — `TypewriterMenuControls.vue` + `TypewriterOptions.vue` in the Editor menu,
   the shortcut, the Document menu switch, `PhoneTypewriterSettings.vue` in Settings → Writing.

### Phase 5 — browser checks in the harness

`frontend/tests/spike/typewriter/app.html` mounts the **real** ContentArea + SubMenuBar (desktop)
or PhoneEditor / PhoneSettingsPage (`?phone=1`, `&page=settings`) with the real Editor, stores
and overlay, and a Document held in memory. No database, no backend: the harness stubs
`docStore.updateFileContent` and `addonsStore.fetchAddons`, and the driver aborts every request
that is not to my Vite on 5181. (Two early runs, before the stub, each sent one unauthenticated
`GET http://localhost:8000/addons` from SubMenuBar's add-on fetch to the running dev backend; both
were refused with 403. Read-only, no token; nothing else reached port 8000.)

Desktop 1280×800, light and dark (anchor 389 px, rows 22.4 px):

| §13.3 | Result |
|---|---|
| 1 | Button and Ctrl+Shift+Enter both toggle; toast "Typewriter mode off" shown. Six Enter + typing rounds: band top 388.6–389.5 (±1 px). |
| 2 | Ctrl+Home: scrollTop 0, band 389. Ctrl+End: band 389. |
| 3 | Click far from the anchor: band moved at once (679.8), no scroll at 40/250/330 ms, glide 420–560 ms, ends 388.8. Reduced motion: band 97.7 at 300 ms, 388.7 at 360 ms (instant). |
| 4 | Double-click, relaxed double-click (250 ms apart), triple-click, drag across paragraphs, Shift+click, right-click: scrollTop unchanged in every case; the intended word / 141-character line selected; band hidden with a selection. |
| 5 | Wheel away (band 657.7), ArrowDown → 389.1. Wheel away, click → 388.6. |
| 6 | Find Next "term": selection head row at 389.4. |
| 7 | Undo and redo while scrolled away (band at 88.8): both end at 388.8. |
| 8 | Paragraph, Sentence, Off; Subtle and Strong; screenshots. |
| 9 | Scroll Sync on: the Preview follows typing (213 → 301 px); scrolling the Preview moves the editor away (band −356); the next keystroke re-anchors (388.8). |
| 10 | Theme switch while on: overlay back in the new wrapper, scrim `rgba(44, 44, 44, 0.6)` = the dark wrapper background. |
| 11 | Margin style, N = 3, mid-Document: the band stops at 710 px = 800 − 4 rows. At the end of the Document it gets closer, as §5.3 allows. |
| 14 | Off: the wrapper's children are exactly OverType's two again (the layer is teleported into a host div that is removed, because Vue's Teleport leaves its anchor text nodes behind), and the editor container has no `style` attribute. |
| 15 | No console errors from the app in any run (only the aborted favicon request). |
| 8.4/8.5 | 60,000-character line: band 389. Empty Document: band on the anchor, no scrim, placeholder not dimmed. |

Phone 375×812 (`isMobile`, touch), light and dark (anchor 302 px with the 49 px key row; 126 px
with the viewport cut to 460 px):

| Check | Result |
|---|---|
| Tap with the keyboard closed (textarea not focused) | Band moves at once (520); no scroll at 100/400/650 ms; on the anchor (303 → 302) after the viewport settles. |
| "Keyboard up" (viewport 460 px) | Re-anchored above the key row: band 126 = anchor. |
| Tap while focused | Re-centred after the click delay: 42 → 126. Found and fixed along the way: a touch browser places the caret after `pointerup`, so the first version, which checked the row at `pointerup`, saw the old caret and did nothing. |
| Swipe, long-press | No re-centre. (Puppeteer's touch swipe did not scroll the pane in headless Chrome, so the swipe case is only half-tested.) |
| Typing | Band 126 = anchor after each Enter. |
| Preview and back | No errors; back in Edit the band is on the anchor. |
| Document menu switch | Turns the mode on, closes the sheet, focus back in the editor, layer drawn. |
| Settings → Writing | Line position Higher and Dim strength Subtle change the phone profile only (desktop unchanged). |

Screenshots (left untracked in the worktree, not committed — no agent log in the repo commits
images): `docs/agent-logs/2026/11/typewriter-assets/` — `desktop-on-light`, `desktop-typing-light`,
`desktop-end-light`, `desktop-selection-light`, `desktop-dim-{paragraph,sentence,off}-light`,
`desktop-strength-{subtle,strong}-light`, `desktop-code-band-{light,dark}`,
`desktop-dim-sentence-dark`, `desktop-scroll-sync-light`, `desktop-empty-document-light`,
`desktop-options-popover-{light,dark}`, `phone-on(-dark)`, `phone-keyboard-up(-dark)`,
`phone-typing(-dark)`, `phone-document-menu`, `phone-settings-writing` (all `.png`).

## Changes Made

New: `frontend/src/utils/{typewriterSettings,textFocus,typewriterScroll,focusGeometry}.js`,
`frontend/src/store/typewriterStore.js`, `frontend/src/composables/useTypewriter.js`,
`frontend/src/components/{TypewriterLayer,TypewriterOptions,TypewriterMenuControls}.vue`,
`frontend/src/components/phone/PhoneTypewriterSettings.vue`, `docs/architecture/editor.md`,
the harness in `frontend/tests/spike/typewriter/`, and tests (below).

Changed (all additive): `Editor.vue` (wrapper ref, `useTypewriter`, teleport, shortcut, one call
in `onChange`), `SubMenuBar.vue` (one import, one tag), `ContentArea.vue` and `PhoneEditor.vue`
(provides), `DocumentMenuSheet.vue` (switch row, focus after close), `PhoneSettingsPage.vue`
(Writing group), `useViewport.js` (`onViewportSettled`), `main.css`, `phone.css`,
`frontend/AGENTS.md`, `docs/architecture/README.md`, `tests/unit/documentMenuSheetAddons.test.js`
(two store mocks). `uiStore` untouched. No backend, schema, sync or add-on change.

## Tests

- Frontend: `cd frontend && npx vitest run` — **98 files, 1,234 tests passed** (from 94 / 1,194
  on `develop`). New: `typewriterSettings`, `textFocus`, `typewriterScroll`, `focusGeometry`,
  `typewriterStore`, `useTypewriter`, `typewriterLayer` (layer + Editor/ContentArea/PhoneEditor
  source checks), `subMenuBarTypewriter`, `documentMenuSheetTypewriter` (menu switch + Settings →
  Writing); `useViewport` gained an `onViewportSettled` case.
- Shared: `npm test --prefix shared` — 5 files, 65 tests passed (unchanged).
- Backend: not run (not touched).
- Lint: `npx eslint --ignore-pattern '.claude/**' .` — clean.
- Build: `npx vite build` into a scratch directory — succeeds (the existing chunk-size warning only).

## Open Items / Notes

**Decisions where the spec left a choice** (also in spec §19): Range-first measurement; padBottom
against the whole scroll viewport; touch caret checked when the click delay ends, not at
`pointerup`; click count from `mousedown`; an option change while on moves an attached view to
the new anchor (turning the mode on does not); a caret left at the end by setting an unfocused
textarea's value is taken to be at the start; content set from code (undo, adoption) only
re-anchors an attached view; the store reloads after each sync round; desktop controls split into
`TypewriterMenuControls` + `TypewriterOptions`; the shortcut is desktop-only.

**Known limits.** Turning the mode off at the very top or bottom of a Document moves the text
(U3 cannot hold there: the padding was what made the ends reach the anchor). A caret exactly at a
soft-wrap point is measured on the row it starts (downstream); Chrome may draw it at the end of
the earlier row after a click there.

**Pre-existing bug found (not fixed, out of scope).** Editor's history: typing a word ending in
a delimiter (". ", ",") records the text immediately, then the 500 ms debounced record for the
earlier characters fires and pushes the *stale* text on top. The first Ctrl+Z then restores text
identical to what is on screen and appears to do nothing (reproduced with the mode off:
`" typed for undo."` + Ctrl+Z left the length unchanged; a second undo worked).

**Browser checks for a human** (real app on the dev stack; I could only use the harness):

Desktop 1280 px, light and dark:
- [ ] Editor menu → **Typewriter**: button shows pressed; title shows the shortcut. Type several
      paragraphs: the caret row stays mid-pane, the band is on it, other paragraphs are dimmed.
- [ ] Ctrl+Shift+Enter (Cmd+Shift+Enter on macOS) in the editor: toggles, toast "Typewriter mode
      on/off", no newline inserted, focus stays (P10 on macOS, Windows, ChromeOS).
- [ ] Options popover (sliders icon): every control applies live; Line position moves the line;
      Escape closes and returns focus to the icon; clicking outside closes.
- [ ] Click a far line: band at once, glide ~350 ms later. Double- and triple-click at a relaxed
      pace, mouse and trackpad, 20 tries each (P11): the right word/line, no scroll.
- [ ] Sidebar: open another Document: its first row sits on the anchor, no animation.
- [ ] Find Next "term": each match lands mid-pane. With the mode **off**, note that Find Next
      jumps to the end of the Document instead of the match (P8, follow-up F2).
- [ ] Turn the mode on at one desktop browser, sync, look at a second: on there too, same
      options (U11); the phone keeps its own.
- [ ] Live session in a shared space, two browsers: the other side types above; the local row
      stays put (U12). Nothing typewriter-related shows on the other side.
- [ ] Theme switch while on; forced colours (Windows High Contrast): no band or dimming, scrolling
      still works (U14).
- [ ] Safari and Firefox: sentence dimming boundaries match Chrome on `Dr. Smith`, `e.g. the`,
      quotes, CJK (P9).
- [ ] Mode off: no `.pn-typewriter-host` in the editor, typing feels like `main` (optional
      performance trace).

Phone 375 px (real iOS Safari and Android Chrome):
- [ ] Document menu → **Typewriter mode**: the sheet closes; in Edit mode the keyboard comes back.
- [ ] Tap a line with the keyboard closed: the keyboard opens, and once it has settled the line
      glides to the middle of the area above the key row (P5). No fight with the system scroll.
- [ ] Type with the keyboard up: the line stays above the key row; nothing hides under it.
      Rotate, and close the keyboard: re-anchors.
- [ ] Swipe to scroll: no re-centre afterwards (pointercancel on both browsers). Long-press a
      word: no re-centre. Double-tap a word: the word is selected.
- [ ] Japanese IME (iOS) and Gboard (Android): a composition that wraps to a new row keeps the
      candidate window with the text, nothing lost (P7, U13).
- [ ] Settings → Writing: Higher + Subtle apply on return to the Document; desktop unchanged.
- [ ] Preview and back to Edit: no errors, band on the anchor.

## Review fixes (orchestrator, 2026-11-08)

An independent Fable 5.1 review found one high, one medium and several low issues. I fixed them on
this branch:

- **High: the view jumped to the top after a blur.** The "caret nobody placed" rule ran on every
  frame. So with the caret at the end of a Document and focus elsewhere, any of these moved the
  view to the first line: changing an option, a live-session edit, or a resize.
  - The controller now records the Document whose caret the person placed (focus at attach, a
    key, a pointer press, typing). The rule applies only until then.
  - Three controller tests fail on the old code and pass now.
- **Medium: one settings row held both profiles.** A desktop save could overwrite a phone change it
  had not yet received (CR-SQLite keeps the last write per column).
  - Now there are two rows, `typewriter.desktop` and `typewriter.phone`. A device writes only the
    profiles it changed.
  - The spec §9.3/D14, `docs/architecture/editor.md` and `frontend/AGENTS.md` are updated.
  - The feature is unreleased, so no migration is needed.
- **Low: a sync reload during a save in flight** could overwrite the new values. Reloads now wait
  while a save is pending or being written. A test covers it.
- **Low: table detection was quadratic** on a long run of `|` lines without a delimiter row. One
  linear pass per text now precomputes the runs and delimiter counts.
  - On 72,000 random cases it gives the same results as before.
  - A 3,000-line case went from 23.7 to 0.2 ms per frame.
- **Low: the options popover stayed put on scroll.** It now follows its button.
- **Low: modifier-only keys** (Shift, Ctrl) no longer cancel a pending click re-centre.
- **Low: forced colours.** Switches and pressed choices show an outline.
- **Not changed, to revisit at integration:**
  - The per-frame `textarea.value` comparison, which is within budget.
  - The reload query after every sync round. The tag branch adds `syncStore.onRemoteChangesApplied`,
    which can limit the reload to changes in the `settings` table once both are merged.
- **Tests:** frontend 98 files, 1242 passed. Lint clean.
