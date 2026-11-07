# Typewriter Mode — Spec

> A focused writing mode for the markdown editor: the line being written stays at a fixed height
> on screen, that line is highlighted, a set number of lines stays visible around the cursor,
> and the text outside the current paragraph or sentence is dimmed.
> Status: proposed
> Created: 2026-11-07
> Last updated: 2026-11-07 (Kris answered Q1–Q6)

---

## 1) Summary

Kris asked for a typewriter mode with four behaviours:

1. **Typewriter scrolling**: the current line stays at a fixed position on the screen.
2. **Current line highlighting.**
3. **A configurable number of lines kept above and below the cursor.**
4. **Dimming of unfocused paragraphs or sentences.**

This spec makes them **one mode with sub-options**. One action (toolbar button, keyboard
shortcut, or a switch in the phone Document menu) turns the mode on or off. Inside the mode, each
behaviour can be tuned or switched off. The default turns on everything: the line held in the
middle of the visible area, a line highlight, and paragraph dimming.

All four behaviours are presentation only. The Document text, saving, sync, live sessions,
Preview, PDF and export do not change. Nothing is stored in the Document. Settings live in one new
row of the synced `settings` table, with separate values for desktop and phone.

The editor is OverType 1.2.7: a transparent `<textarea>` laid over a rendered highlight layer
(§4). Because of that, most of the design is about **where the highlight band and the dimming are
drawn** and **which element scrolls**. The recommended approach (§4.3) adds a
Panino-owned overlay inside OverType's wrapper, between the highlight layer and the textarea. It
measures geometry from OverType's per-line elements plus a one-line mirror, and scrolls the
editor's ancestor scroll container. OverType's own rendering is not changed. Section 12 lists the
assumptions a short prototype must confirm before building.

---

## 2) Goals

1. While the mode is on and the user types, the caret's visual row stays at a configured height in
   the visible editor area. This holds at the top and at the end of the Document.
2. Highlight the caret's visual row in light and dark themes without reducing text contrast below
   WCAG AA.
3. Let the user set how many lines must stay visible above and below the cursor (a scroll margin),
   used as its own scrolling style and as a lower limit on the typewriter position.
4. Dim the text outside the current paragraph or sentence, using Markdown-aware block and sentence
   detection.
5. Work on desktop (1280 px) and phone (375 px), including when the on-screen keyboard shrinks the
   visible area and the key row covers the bottom of the editor.
6. A click or tap brings the clicked line to the anchor straight away, as in iA Writer. Double-click,
   triple-click, drag selection, phone scroll gestures, find/replace, undo, IME composition and
   live sessions keep working.
7. When the mode is off, add no measurable cost: no listeners, no DOM nodes, no padding.
8. When the mode is on, add at most 2 ms (desktop) and 4 ms (phone) of main-thread work per
   keystroke at p95 (§10).

## 3) Non-goals

- No change to OverType's markup, parser or alignment CSS. No fork or upgrade of OverType in this
  work. The existing monkey patches in `useOverTypePatches.js` stay as they are, and no new
  rendering patch is added.
- No dimming or highlight in the rendered Preview pane, the phone Preview mode, Revision history or
  PDF output.
- No full-screen or "hide all chrome" zen mode. It would pair well with this mode, but it is a
  separate feature (follow-up F1).
- No per-Document typewriter settings.
- No change to OverType's spellcheck setting. It turns spellcheck off on the textarea
  (`overtype.js:409`), and Panino does not turn it back on.
- No smooth-scroll setting. Motion follows `prefers-reduced-motion`.
- No shortcut customisation UI.
- No server or schema change.

---

## 4) How the editor is built today (constraints)

### 4.1 OverType's DOM

`Editor.vue` creates the editor with `OverType.init(editorContainerRef, { autoResize: true, … })`
(`frontend/src/components/Editor.vue:625-653`). OverType builds:

```text
div.overtype-container (.overtype-auto-resize)
└─ div.overtype-wrapper        position: relative; z-index: 1  → its own stacking context
   ├─ textarea.overtype-input  absolute, z-index 1, color: transparent, caret visible
   └─ div.overtype-preview     absolute, z-index 0, pointer-events: none
      ├─ <div>…</div>          one per logical line
      ├─ <ul>/<ol><li>…</li>   consecutive list lines, one <li> per line
      └─ …
```

The facts that shape this design:

| Fact | Where | Consequence |
|---|---|---|
| Textarea and highlight layer share the same font, padding and `pre-wrap` wrapping, and the CSS forbids size changes ("NO SIZE CHANGES"). | `overtype/src/styles.js:117-149`, `:259` | Every visual row has the **same height** (`line-height` × `font-size`). "N lines" is exactly N × row height. Geometry measured on either layer is valid for both. |
| The textarea paints only the caret and the selection, above the highlight layer. | `styles.js:197-204`, `:227-232` | A layer placed between the two (z-index 0, after the preview in DOM order) is drawn **over the text but under the caret and selection**. That is exactly the place for the band and the dimming scrim. |
| The wrapper is `position: relative; z-index: 1`. | `styles.js:105-114` | Its children share one stacking context. An overlay outside the wrapper cannot sit between the highlight layer and the textarea, so the overlay must be **inside** the wrapper. |
| `updatePreview()` rebuilds the highlight layer with `innerHTML` on every `input`, every `setValue`, and 50 ms after every `selectionchange`. | `overtype.js:442-468`, `:1194-1210` | Classes or wrappers added to highlight-layer elements are erased many times a second. **Do not decorate the highlight layer.** Draw in a separate layer and read the line elements only to measure them. |
| `onChange` runs at the end of every `updatePreview()`. | `overtype.js:465-467` | Editor's existing `onChange` hook is a reliable "highlight layer replaced" signal for clearing measurement caches. |
| The parser emits one block per logical line. Lists are moved into `<ul>/<ol>` with one `<li>` per line. Panino's patch keeps code-fence lines as plain `<div>`s. | `overtype/src/parser.js:432-470`, `useOverTypePatches.js:11-73`, `:79-102` | Flattening the highlight layer's children (expanding `ul`/`ol` into their `li`s) should give exactly one element per logical line. Prototype check P1. |
| `autoResize: true` grows the textarea, highlight layer and wrapper to the full content height with `overflow: hidden`. | `overtype.js:910-960`, `Editor.vue:644` | **The textarea never scrolls.** An ancestor scrolls: on desktop the editor pane's `div.h-full.overflow-y-auto` (`ContentArea.vue:37-42`), on phone `.ph-write` (`PhoneEditor.vue:77-87`, `:430-436`). Typewriter scrolling must drive that element. |
| `destroy()` removes the wrapper. A theme change destroys and rebuilds the whole editor. | `overtype.js:1035-1055`, `Editor.vue:1075-1085` | The overlay must be torn down before `destroy()` and attached again to the new wrapper. A live-session rebind already follows the same pattern. |
| Editor's scoped CSS forces a white background on the highlight layer, and code-block lines get `#f3f4f6`. Dark mode and the phone recolour both. | `Editor.vue:264-270`, `:287-289`, `main.css:309-318`, `PhoneEditor.vue:475-479` | A band drawn **under** the highlight layer would be hidden. Draw it **over** the text, translucent (§6.3). |

Other existing behaviour that matters:

- `caretPosition.js` measures a caret by building a hidden mirror of the textarea **with the whole
  text before the offset**, then removing it after each call (`utils/caretPosition.js:21-46`).
  That is fine for a few remote carets. Run on every keystroke in a large Document, it costs
  O(Document length) in layout. This mode uses a cheaper hybrid (§4.3).
- `findNext()` reveals a match by setting `textarea.scrollTop` (`Editor.vue:1418-1421`). Under
  `autoResize`, the textarea's `overflow` is hidden and it is as tall as its content, so this
  looks like a no-op. The pane then scrolls only if the browser reveals the caret on its own.
  Prototype check P8 confirms this. In typewriter mode the scrolling described here takes over
  (§5.6).
- Scroll Sync maps editor to Preview by the scroll ratio `scrollTop / (scrollHeight −
  clientHeight)`, in both directions (`ContentArea.vue:90-118`).
- On phones, `PhoneShell` follows `visualViewport`, so `.ph-write` really does shrink when the
  keyboard opens (`composables/useViewport.js`). The key row is `position: absolute; bottom: 0`
  over the bottom of the editor (`KeyRow.vue:83-90`). OverType's phone padding of 96 px at the
  bottom exists to clear it (`Editor.vue:647-652`).
- Live sessions apply remote text with `setValue` and then put the caret back in place
  (`utils/yTextareaBinding.js:124-149`). They hold remote changes back while an IME is composing
  (`:130-137`). Phone remote carets are drawn **above** the textarea (`RemoteCarets.vue:82`,
  rendered at `Editor.vue:241-245`).
- UI settings are one JSON row (`uiSettings`) in the synced `settings` CRR table
  (`store/uiStore.js:58-88`; `settings` is in `CRR_TABLES`, `backend/api-service/db.js:344-354`).
  The theme preference is per device, in `localStorage` (`store/themeStore.js`). The desktop
  Settings page has no editor section today. The phone Settings page has Notes and Appearance
  groups (`pages/PhoneSettingsPage.vue:122-168`).
- The app has no focus, zen or distraction-free mode, and no global keyboard shortcut system. The
  editor handles its own keys in `handleKeydown` (`Editor.vue:452-469`). OverType claims
  Mod+B, Mod+I, Mod+K, Mod+Shift+7 and Mod+Shift+8 (`overtype/src/shortcuts.js:25-60`).

### 4.2 Logical line, visual row

A **logical line** runs between `\n` characters. A **visual row** is one line on screen after soft
wrapping. In prose, one logical line is often a whole paragraph spread over many rows. This spec
uses:

- **visual row** for anchoring and highlighting, because a typewriter holds the row being typed;
- **blocks and sentences** (§7) for dimming.

### 4.3 Recommended rendering approach

A Panino component, `TypewriterLayer.vue`, is teleported into `editor.wrapper` (OverType exposes
the wrapper as an instance property). It contains:

```text
div.overtype-wrapper
├─ textarea.overtype-input          z 1
├─ div.overtype-preview             z 0
└─ div.pn-typewriter-layer          z 0, after the preview in DOM order → paints above it
   ├─ div.pn-typewriter-band        the current-row highlight (translucent)
   └─ div.pn-typewriter-scrim × ≤4  rectangles over the unfocused text, filled with the
                                     editor background colour at the dim alpha
```

The layer is `position: absolute; inset: 0; pointer-events: none; aria-hidden="true"`. It scrolls
with the content for free because it lives in content coordinates.

**Dimming is a scrim, not styling of the text.** The unfocused region is at most four rectangles:
everything above the focus block, the left part of its first row, the right part of its last row,
and everything below. Each rectangle is filled with the wrapper's computed background colour at
the dim alpha. Reasons for this choice:

- It survives OverType's `innerHTML` rebuilds, because it never touches the highlight layer.
- It works the same for headings, lists, code, links and syntax markers. Every colour is dimmed by
  the same proportion, so the syntax colouring stays.
- Sentence focus (starting mid-row) is just two more rectangles.
- The caret, the selection and phone remote carets sit above it and are never dimmed.

Rejected alternatives:

- **Class-per-line on highlight-layer elements:** needs an `updatePreview` patch, runs on every
  rebuild, and cannot dim part of a line.
- **CSS Custom Highlight API (`::highlight`):** no DOM changes, and it can cover a sentence. But it
  supports only `color`/`background-color`, so dimmed text would lose its syntax colours. Its
  Ranges also go stale on every rebuild. Firefox support is recent.
- **Drawing the band under the highlight layer:** hidden by the forced white or code-block
  backgrounds (§4.1).

**Measurement** is a hybrid, so each frame costs O(current line), not O(Document):

1. **Row top of a logical line.** Read from the highlight-layer element for that line
   (`offsetTop` relative to the wrapper). The flattened element list is cached and rebuilt only
   when Editor's `onChange` reports a new highlight layer. If the element count does not match the
   logical line count, fall back to the whole-prefix mirror for that frame and warn once in
   development.
2. **Position within the line** (which wrapped row, and x for sentence edges). Use one persistent
   hidden mirror `div` inside the wrapper, styled from the textarea (the same property list as
   `caretPosition.js`). It holds **only that logical line's text**, with a zero-width marker
   `<span>` at the offset. `pre-wrap` wrapping of a line does not depend on the lines before it,
   so the marker's `offsetTop`/`offsetLeft` inside the mirror, plus the line's top from step 1, is
   the row's geometry.
3. Each frame does all reads first, then all writes (band, scrim, padding, `scrollTop`), inside one
   `requestAnimationFrame`. That keeps it to at most one forced layout per frame.

---

## 5) Typewriter scrolling

### 5.1 Scrolling styles

The **Scrolling** sub-option has three values:

| Value | Label | Behaviour |
|---|---|---|
| `typewriter` (default) | Typewriter | The caret row is held at the **anchor**, a fixed height in the visible area. |
| `margin` | Keep lines visible | The caret row moves freely, but the view scrolls just enough to keep at least **N context lines** above and below it (like Vim's `scrolloff` or VS Code's `editor.cursorSurroundingLines`). |
| `off` | Off | No scrolling by this mode. The highlight and dimming can still be on. |

### 5.2 The anchor and the "lines kept above and below" (decision)

**Interpretation (recommended):** "configurable number of lines kept above and below the cursor"
is a **scroll margin of N rows**, the same N above and below. It is the main control in
`margin` style. In `typewriter` style it is the **lower limit** that the anchor cannot cross:
whatever the anchor setting, at least N rows stay visible above and below the caret row whenever
the visible area has room. That way the setting does something in both styles, and it protects the
phone case, where the keyboard leaves only 6–8 rows visible.

Definitions (all in px; `rh` = row height; `H` = visible height, §5.7):

```text
visibleRows   = floor(H / rh)
nEff          = min(N, floor((visibleRows − 1) / 2))           // Vim's clamp
anchorY       = round(anchor × H − rh / 2)                     // row top, from the visible top
anchorY       = clamp(anchorY, nEff × rh, H − (nEff + 1) × rh)
```

- **Anchor presets:** Higher (33 %), Middle (50 %, default), Lower (67 %). Stored as an integer
  percent clamped to 20–80, so a slider can be added later without migrating data.
- **N:** 0–10, default 3. A stepper in the UI.

Other readings considered:

- **N as the size of the undimmed window** (dim everything more than N lines from the cursor).
  Kris confirmed the scroll-margin reading on 2026-11-07 (D6). A "Lines (±N)" dim option is not
  part of this work.
- **N as the anchor itself** ("keep 8 lines above the cursor"). Rejected: "above and below" cannot
  both be fixed when the visible height changes.

### 5.3 Top and end of the Document

In `typewriter` style, the first and last rows must be able to reach the anchor. The editor adds
**spacer padding** to `editorContainerRef` (outside OverType's wrapper, so its alignment is
untouched):

```text
padTop    = max(0, anchorY − firstRowOffset)        // firstRowOffset: row 0's top in the scroll content
                                                    //   (banners above the editor count)
padBottom = max(0, H − anchorY − rh − trailingSpace)  // trailingSpace: OverType's own bottom padding
```

At `scrollTop = 0` the first row sits on the anchor, and at the maximum scroll the last row does.
A new or empty Document opens with its first line at the anchor and blank space above it. This is
deliberate: it is what holding the line at a fixed height means.

`margin` style adds **no padding**. At the ends of the Document the caret can get closer to the
edge than N, as in Vim.

When the padding changes (mode turned on or off, resize, anchor change), `scrollTop` is adjusted by
the same amount in the same frame. The caret row does not move on screen.

### 5.4 Which caret moves scroll (decision)

The mode never reacts to scroll events. It scrolls only after a **caret or content change** or a
**resize of the visible area**. Each caret change gets an origin:

| Origin | Detected by | Scroll? |
|---|---|---|
| Typing, deleting, paste, Enter | `input` on the textarea | **Yes**, follow the caret |
| Keyboard navigation and Shift-selection (arrows, Home/End, PageUp/Down, Mod+arrows) | `keydown` on the textarea, then `selectionchange` | **Yes**, follow the **selection head** (the end that moves, from `selectionDirection`) |
| Single click or tap that leaves a collapsed caret | `pointerdown` on the textarea, then `pointerup` | **Yes, after the click settles** (§5.4.1). Decided by Kris, 2026-11-07: like iA Writer. |
| Double- or triple-click, drag-select, Shift+click, long-press, selection handles | the same pointer tracking | **No**: the selection is not empty, or the gesture was a drag (§5.4.1) |
| Toolbar, key row, find/replace, undo/redo, image insert, template insert | Anything not marked as pointer | **Yes** (§5.6) |
| Remote edit in a live session | `applyingRemote` in the binding, or a content change without local input | **Compensate only** (§8.3) |
| Document opened or switched | `handleDocumentSwitch` | Go to the caret instantly (no animation) |

The highlight band and the dimming follow every caret change at once, clicks included. Only the
scroll waits for the rules below.

**Wheel, trackpad, scrollbar and touch scrolling are never fought.** The user can scroll anywhere.
The next click, tap or keystroke brings the caret row back to the anchor.

**"Attached" state.** The mode records the last `scrollTop` it set. If the scroll container is
still within 1 px of it, the view is *attached*. Remote edits and resizes re-anchor only while
attached. If the user has scrolled away to read, a collaborator's edit or a window resize does not
pull them back. A click re-centre, a keystroke or a navigation key attaches the view again.

### 5.4.1 Re-centring after a click or tap

The goal is the iA Writer feel: click a line and it glides to the anchor. Moving text under the
pointer must never change what a double-click, triple-click or drag selects.

A pure function, `pointerRecentreDecision(gesture, state)`, decides from a small record kept per
gesture: pointer type, button, down/up time, distance moved, whether a `pointercancel` came,
`event.detail`, the selection at `pointerup`, whether an IME was composing, and whether the
textarea had focus before `pointerdown`.

**Mouse and pen (desktop):**

1. Only the **primary button**. A right-click (context menu) or middle-click does not re-centre.
   A middle-click paste on Linux is an `input` and follows the caret as typing does.
2. At `pointerup`, the selection must be **collapsed**, the pointer must have moved **≤ 4 px**
   since `pointerdown`, and `event.detail` must be **1**. Otherwise nothing happens. That rules out
   drag selection, Shift+click (it extends a selection), and the second and third clicks of a
   double- or triple-click, which leave a selection.
3. The re-centre is **scheduled 350 ms after `pointerup`**: the click-settle delay. A
   `pointerdown` in the textarea before then cancels it, so the second click of a double-click
   lands on unmoved text and selects the intended word. So does a quick triple-click. 350 ms
   covers typical double-clicks; prototype check P11 tunes it within 300–500 ms.
4. When the timer fires, the gesture is checked once more. If the selection is no longer
   collapsed, a composition has started, or a pointer is down, nothing happens.
5. The re-centre then **animates over 180 ms** (ease-out). It is **instant** under
   `prefers-reduced-motion: reduce`. A click on a row already at the anchor (±1 px) does nothing.
6. **Never while a pointer is down.** A drag never scrolls, and the browser's own edge
   auto-scroll during drag selection is left alone.
7. A key pressed during the 350 ms wait cancels the timer, and the keyboard rule takes over at
   once.

**Touch (phone and tablet):**

1. Only a **tap** re-centres: moved ≤ 10 px, lifted within 500 ms, and no `pointercancel` (the
   browser fires one when it takes the gesture over as a scroll). A swipe or fling is a scroll
   gesture and is never fought.
2. Long-press (word selection, the iOS loupe for dragging the caret, Android's caret handle) and
   selection-handle drags do not re-centre. The selection is non-empty, or the gesture is longer
   than 500 ms or cancelled. A caret placed that way reaches the anchor at the next keystroke.
3. A double-tap that selects a word is handled by the same 350 ms delay and collapsed-selection
   check as a double-click.
4. **The tap that opens the keyboard.** The textarea was not focused before `pointerdown`, so the
   keyboard is about to shrink the visible area. iOS and Android also scroll the caret into view
   on their own. The 350 ms timer is skipped. The re-centre waits until the visual viewport has
   settled (the `useViewport` settle timers, up to 700 ms after focus). It then animates (180 ms,
   or instant under reduced motion) to the anchor of the **new** visible area, from wherever the
   system scroll left the view. A double-tap still cancels it: the second `pointerdown` arrives
   before the viewport settles.
5. A tap while the keyboard is already up follows the normal 350 ms rule.

**In "Keep lines visible" style** a click uses the same timing, but scrolls only when the clicked
row is within N rows of an edge (the margin rule). In style **Off**, clicks never scroll.

### 5.5 Smooth or instant (decision)

- Following typing and keyboard navigation **animates** with a short custom `requestAnimationFrame`
  tween (ease-out): **100 ms** for moves of up to 2 rows, **180 ms** for longer jumps (a click or
  tap re-centre, find, undo, PageDown, re-attaching after a free scroll). A new target restarts the tween from wherever the
  view is now, so fast typing never queues animations.
- **Instant** for: opening or switching a Document, padding compensation, remote-edit
  compensation, resizes (including the phone keyboard), and IME composition (§8.1).
- **`prefers-reduced-motion: reduce`** makes every scroll instant.
- Native `scrollTo({ behavior: 'smooth' })` is not used. Its duration cannot be controlled, and
  calling it repeatedly while typing fast stutters in Safari.

### 5.6 Find/replace, undo and other jumps

`findNext` and `replaceNext` select the match. Typewriter scrolling then follows the selection
head with the 180 ms animation, so the match lands on the anchor. The ineffective
`textarea.scrollTop` line (`Editor.vue:1418-1421`) is left alone while the mode is off. Follow-up
F2 covers fixing it for everyone. Undo and redo restore the caret in a `nextTick`
(`Editor.vue:540-547`). That `selectionchange` has no pointer origin, so it follows.

### 5.7 Visible height `H`

- **Desktop:** `H = scrollContainer.clientHeight`.
- **Phone:** `H = .ph-write.clientHeight − bottomInset`. `bottomInset` is the docked key row's
  height, including `--ph-safe-bottom`. `PhoneEditor` provides it, since it renders the key row
  only in Edit mode. `.ph-write` already shrinks with the keyboard (§4.1).
- A `ResizeObserver` on the scroll container and on the wrapper sees resizes from the keyboard,
  rotation, the desktop pane splitter, the Documents panel, and font loading. On phones the
  re-anchor runs after the visual viewport settles. It reuses `useViewport`'s settle timing
  (100/350/700 ms) and debounces so only the last measurement scrolls, and only while attached.
  The exception is the tap that opens the keyboard (§5.4.1, touch rule 4): it re-centres after the
  settle even if the system scroll has detached the view, and it animates.

### 5.8 Scroll Sync with the Preview

No change to `ContentArea`'s ratio mapping is needed:

- With the symmetric padding of §5.3, `scrollTop = 0` means "first row at the anchor" and the
  maximum scroll means "last row at the anchor". The ratio therefore tracks the caret's position
  through the Document, and the Preview follows each typewriter scroll as it does today.
- Scrolling the Preview scrolls the editor by ratio. That counts as a free scroll: the view is no
  longer attached, and the next keystroke or click re-anchors.

`ContentArea` only gains a `provide` of its editor scroll element (§11).

---

## 6) Current line highlighting

### 6.1 What is highlighted (decision)

The highlight covers the **visual row that holds the caret**, across the full content width
(from the textarea's left padding edge to its right padding edge). Reasons:

- It is the row the typewriter holds at the anchor, so the band and the anchor always line up.
- Highlighting a whole logical line would light up an entire wrapped paragraph, which says little
  more than the paragraph dimming already does.

### 6.2 Selections

While the selection is **not empty**, the band is hidden. The selection colour already shows the
extent, and a band mixed with it would read as part of the selection. The band comes back when the
selection collapses.

### 6.3 Colours and accessibility

The band is drawn over the text (§4.3), so it must be faint enough not to cost contrast. It
follows the design system: neutral, never blue, since blue is kept for links
(`docs/architecture/ui-design-system.md` §1).

| Theme | Token | Value | Text contrast with the band |
|---|---|---|---|
| Light | `--pn-typewriter-line` | `rgb(17 24 39 / 0.05)` (gray-900 at 5 %) | `#111827` on the result ≈ 16:1 (17.7:1 without the band) |
| Dark | `--pn-typewriter-line` | `rgb(212 212 212 / 0.07)` | `#d4d4d4` on the result ≈ 8:1 (9.4:1 without) |
| Phone | the same tokens, mirrored into `--ph-*` in `phone.css` | | |

- The band is a supplementary cue (the caret marks the position), so its own low contrast against
  the background is acceptable under WCAG 1.4.11. It must never be the only way to find the caret.
- Under `@media (forced-colors: active)` the whole typewriter layer is `display: none`. Forced
  colours would turn translucent fills into solid blocks.
- The band moves without animation. It jumps to the new row when the caret moves.
- The layer is `aria-hidden`. Screen readers see the plain textarea, as today.

---

## 7) Dimming

### 7.1 Granularity (decision)

The **Dim** sub-option has three values: **Off**, **Paragraph** (default) and **Sentence**.

| Setting | Focus region |
|---|---|
| Paragraph | The Markdown **block** containing the caret (§7.2) |
| Sentence | The **sentence** containing the caret, inside that block (§7.3) |

With a non-empty selection, the focus region is the **union** from the region at `selectionStart`
to the region at `selectionEnd`. Selected text is never dimmed.

### 7.2 Block detection (pure function)

`findBlock(text, offset)` scans outwards from the caret's logical line. It returns
`{ start, end, kind }` in character offsets. The rules, in order:

| Construct | Block |
|---|---|
| Front matter (`---` on line 1 through the closing `---`) | the whole front matter |
| Fenced code (```` ``` ```` or `~~~`) | the run of non-blank lines around the caret **inside** the fence. A fence line belongs to the run next to it. A 200-line code block is not lit up all at once. |
| ATX heading (`#`–`######`) | the heading line only, even with no blank line after it |
| Setext heading (text line plus `===`/`---` underline) | both lines |
| List item (`-`, `*`, `+`, `1.`, `1)`, task `- [ ]`) | the marker line plus the more-indented continuation lines that follow, up to the next marker at the same or lower indent, or a blank line |
| Blockquote | the consecutive `>` lines, split at a bare `>` line |
| Table (`|` lines with a delimiter row) | all consecutive table lines |
| Thematic break, `\pagebreak` | that single line |
| Everything else | the run of consecutive non-blank lines (a paragraph) |
| Blank line, or the caret on an empty line | an empty focus at the caret: every block is dimmed and the band still shows. This matches iA Writer when you start a new paragraph. |

The scan is limited to **500 lines** in each direction. Beyond that, the block is cut off at the
limit.

### 7.3 Sentence detection (pure function)

`findSentence(text, offset, block)`:

1. **Single-unit blocks.** Headings, table rows, code lines, front-matter lines, thematic breaks
   and `\pagebreak` count as one "sentence" each: the caret's line.
2. **Build the segmentation string** from the block text, keeping every offset in place:
   - each `\n` becomes a space (otherwise ICU treats line breaks as sentence breaks);
   - blockquote `>` prefixes and list markers (`- `, `1. `, `- [ ] `) become spaces;
   - inline code spans (`` `…` ``) and link and image destinations (`](…)`) become runs of `x`,
     so the dots in `example.com` or `file.md` do not end a sentence.
3. **Segment** with `Intl.Segmenter(navigator.language, { granularity: 'sentence' })`. It is
   available in every supported browser and in Node 24 for tests. The fallback, if it is missing,
   is a regex: break after `[.!?…。！？]+` plus any closing `"'”’)\]`, when followed by whitespace,
   or at once for CJK terminators.
4. **Choose the segment.** Take the segment that contains the caret. If the caret is at the very
   end of the block and right after whitespace (the user has started a new sentence and not typed
   anything yet), the focus is empty at the caret. If the caret sits just after a terminator
   (typing the full stop), the focus stays on that sentence.
5. Trim trailing whitespace from the focus range.

Accepted limits, pinned by unit tests:

- ICU does not split "e.g. the", because a lowercase word follows. It **does** split
  "Dr. Smith".
- Sentence detection works on at most **2,000 characters** on either side of the caret. Beyond
  that, the sentence is cut off at the window edge (one 50,000-character logical line, such as a
  pasted data URL, must stay cheap).

### 7.4 Dim level and transitions

| Strength | Scrim alpha | Light text `#111827` → contrast | Dark text `#d4d4d4` → contrast |
|---|---|---|---|
| Subtle | 0.40 | ≈ 4.8:1 (meets AA) | ≈ 4.4:1 |
| Medium (default) | 0.60 | ≈ 2.6:1 | ≈ 2.8:1 |
| Strong | 0.75 | ≈ 1.8:1 | ≈ 1.9:1 |

Dimmed text is meant to recede, so Medium and Strong fall below AA on purpose. The mode is opt-in,
the focused text keeps its full contrast, and Subtle is there for anyone who wants dimmed text to
stay readable.

The scrim colour is the wrapper's **computed** `background-color`. It is read when the layer
attaches and again after each theme rebuild. That one rule covers white desktop, dark desktop
(`--pn-surface-inset`) and the phone surface (`--ph-surface`) with no per-theme tokens.

**Transitions:** the scrim rectangles move with no geometry animation. Turning the mode on or off,
or changing the dim setting, fades the layer's opacity over 150 ms. There is no fade under reduced
motion.

---

## 8) Edge cases

### 8.1 IME and composition

While `compositionstart` … `compositionend` is active:

- dimming is not recomputed, because sentence boundaries are meaningless in uncommitted text;
- the band and typewriter scroll update **only when the caret's row changes** (wrapping or a
  newline in the composition), and that scroll is **instant**.

A click or tap during a composition does not re-centre. Browsers usually commit the composition
on that click, and the next keystroke follows as normal (§5.4.1, mouse rule 4).

On `compositionend`, everything updates once. On Android, keyboards compose every word, so dimming
catches up at word boundaries, which is acceptable. Prototype check P7 confirms that an instant
scroll during composition keeps the candidate window with the text for Japanese IME (macOS
Chrome/Safari) and Gboard.

### 8.2 Read-only Documents

When editing is paused by a stored conflict, or a live session has dropped, the textarea is
`readOnly` (`Editor.vue:915-920`). The caret and selection still work, so all three behaviours
still work. They are presentation only. The dropped state's `opacity-60` container dims everything
on top, which is fine.

### 8.3 Live sessions

- Only the **local** caret drives the anchor, band and dimming. Nothing typewriter-related goes
  into awareness.
- **Remote edits above the caret** would push the local row down. While attached, the mode
  re-anchors **instantly** in the same frame as the binding's `setSelectionRange`. In typewriter
  mode, a collaborator's typing therefore never moves the line you are writing. In margin mode the
  same correction applies only if the row would leave the margin.
- Phone remote carets stay above the textarea (`RemoteCarets.vue`) and are never dimmed.
- A remote edit that lands during the 350 ms click-settle wait shifts the clicked row. The
  scheduled re-centre measures the row again when the timer fires, so it still goes to the
  clicked caret.
- Starting or leaving a session rebinds the textarea (`bindLiveEditor` and `resetAfterSession`
  call `setEditorValue`). That counts as a content change with no pointer origin, so it follows
  the caret.

### 8.4 Very long lines

A logical line over 10,000 characters still gets an exact band and anchor. The one-line mirror
costs O(line length), and prototype check P6 confirms it stays within budget. If it does not, the
fallback for lines over 10,000 characters is to anchor on the caret's row measured by the mirror
**of a 2,000-character window**. That window starts at a row boundary found through the line
element's height.

### 8.5 Empty Document and placeholder

There is one empty row at the anchor. The band shows on it. There is no scrim, because there is no
other text. OverType's "Start writing..." placeholder sits in the highlight layer and is not
dimmed.

### 8.6 Editor hidden or rebuilt

- **Phone Preview mode** hides the editor (`hideText`). The controller pauses: no measurement or
  scrolling while the wrapper has no layout box. It re-measures when `refreshLayout()` runs.
- **Theme change** rebuilds OverType (`Editor.vue:1075-1085`). The overlay detaches before
  `destroyEditor()` and re-teleports into the new wrapper after `initEditor()`.

### 8.7 Other

- **Opening a Document** puts the caret at offset 0 (`setEditorValue(…, { preserveCursor: false
  })`), so the first row is at the anchor. Restoring the last caret position is out of scope.
- **Split view resize** (desktop splitter) re-wraps the text. The `ResizeObserver` re-measures
  and, while attached, re-anchors instantly.
- **Banners** (stats, info, collaboration status, conflict) live above the editor in the same
  scroll container. `firstRowOffset` (§5.3) includes them. A banner appearing or disappearing
  counts as a resize.
- **Turning the mode off** removes the padding, scrim and band, and adjusts `scrollTop` by
  `−padTop` in the same frame, so the text does not jump.

---

## 9) Settings, entry points and copy

### 9.1 One mode with sub-options (decision)

One switch turns the mode on and off. That gives one place to toggle, one shortcut and one phone
switch. Sub-options let a user keep only some of the behaviours, for example dimming without
scrolling. Four separate toolbar toggles would crowd the Editor menu and could not fit in the phone
menu.

### 9.2 Settings model

| Key | Values | Desktop default | Phone default |
|---|---|---|---|
| `enabled` | boolean | `false` | `false` |
| `scrolling` | `typewriter` · `margin` · `off` | `typewriter` | `typewriter` |
| `anchorPercent` | integer 20–80 (UI presets 33 / 50 / 67) | 50 | 50 |
| `contextLines` | integer 0–10 | 3 | 2 |
| `highlightLine` | boolean | `true` | `true` |
| `dim` | `off` · `paragraph` · `sentence` | `paragraph` | `paragraph` |
| `dimStrength` | `subtle` · `medium` · `strong` | `medium` | `medium` |

`normalizeTypewriterSettings(raw)` accepts anything. It uses allow-lists for enums, clamps and
rounds integers, and falls back to the defaults per field. It never throws.

### 9.3 Storage and sync (decision)

- Settings are stored in a **new row** of the synced `settings` table:
  `id = 'typewriter'`, value `{"version":1,"desktop":{…},"phone":{…}}`.
  **Not inside `uiSettings`:** `uiStore.saveSettingsToDB` rewrites `uiSettings` from a fixed list
  of fields. An older cached PWA on another device would therefore erase a new nested key the next
  time it saved a panel toggle. A separate row is never touched by older clients.
- **Synced, with one profile per form factor.** A writer who turns the mode on at a laptop gets it
  on their other desktop browsers. A phone, with its tiny visible area, keeps its own values. Form
  factor = `useViewport().isPhone`, the same switch that picks the phone layout.
- A new Pinia store, `typewriterStore`, owns this row. It follows `uiStore`'s pattern: it loads
  when `syncStore.isInitialized` and the user id are both set, saves through a 500 ms debounce to
  `syncStore.personalRepository()`, and exposes `current` (the active form factor's normalised
  settings) and `update(patch)`.
- **No schema change.** The `settings` table and its CRR registration already exist. As with
  `uiSettings`, concurrent edits on two devices are last-writer-wins on the row.

### 9.4 Desktop entry points

- **Editor menu** (`SubMenuBar.vue`, action bar), next to Scroll Sync:
  - a `BaseButton` toggle **Typewriter** with the Lucide `Focus` icon, `:isActive`,
    `aria-pressed` and `data-testid="submenu-editor-typewriter"`;
  - beside it, an icon button **Typewriter options** (`SlidersHorizontal`,
    `data-testid="submenu-editor-typewriter-options"`). It opens a small popover,
    `TypewriterOptions.vue`, with the controls in §9.6. The popover follows the existing menu
    focus and Escape handling.
- **Keyboard shortcut:** **Ctrl+Shift+Enter** (Windows/Linux) and **Cmd+Shift+Enter** (macOS),
  handled in `Editor.vue`'s `handleKeydown` while the editor textarea has focus. It calls
  `preventDefault` and toggles the mode. It shows the toast "Typewriter mode on" or "Typewriter
  mode off" (`info`, 2 s), because the toolbar is usually closed. The toolbar button's title shows
  the shortcut. The combination is not taken by OverType or Panino. Prototype check P10 confirms
  browsers leave it alone inside a textarea.

### 9.5 Phone entry points

- **Document menu** (`DocumentMenuSheet.vue`): a switch row **Typewriter mode**
  (`data-testid="phone-menu-typewriter"`), next to the Appearance control. Changing it closes the
  sheet and returns focus to the editor if it was in Edit mode.
- **Settings → Writing** (`PhoneSettingsPage.vue`): a new group after Notes, using
  `PhoneTypewriterSettings.vue`, with the controls in §9.6 styled with `ph-*` classes
  (`SegmentedControl` for enums, a switch for booleans, a − / + stepper for lines).
- No keyboard shortcut, and nothing on the key row.

### 9.6 Controls and copy

| Control | Type | Copy |
|---|---|---|
| Mode | switch | **Typewriter mode** — "Keep the line you are writing in one place and fade the rest." |
| Scrolling | segmented | **Scrolling:** Typewriter · Keep lines visible · Off |
| Line position | segmented, shown when Scrolling = Typewriter | **Line position:** Higher · Middle · Lower |
| Context lines | stepper 0–10, shown unless Scrolling = Off | **Lines kept above and below the cursor:** N |
| Highlight | switch | **Highlight current line** |
| Dim | segmented | **Dim:** Off · Paragraph · Sentence |
| Dim strength | segmented, shown unless Dim = Off | **Dim strength:** Subtle · Medium · Strong |

Sub-options can be changed while the mode is off. Changes apply live if it is on.

---

## 10) Performance budget

| Measure | Budget |
|---|---|
| Mode off: listeners, DOM nodes, padding added by this feature | **None.** The only always-on cost is a counter bump in Editor's existing `onChange`. |
| Mode on: extra main-thread time per keystroke, p95, 4,000-line / 200 KB Document | ≤ **2 ms** on a mid-range laptop (Chrome), ≤ **4 ms** on a mid-range phone |
| Forced layouts per frame from this feature | ≤ 1 (batched reads, then writes, in one `requestAnimationFrame`) |
| `selectionchange` storms (drag-select, held arrow key) | Merged into at most one measurement per animation frame |
| 1 MB / 20,000-line Document | Typing latency with the mode on within 10 % of the mode-off baseline. The baseline is dominated by OverType's full `innerHTML` rebuild, measured and recorded first. |

How the design meets these budgets:

- **Line-start index:** rebuilt once per content change, which costs O(n), the same order as
  OverType's own rebuild. Each caret lookup is a binary search.
- **Line-element list:** rebuilt lazily after an `onChange`.
- **Block and sentence work:** limited to the caret's block, within the line and character windows
  of §7.2–7.3.
- **Mirror:** never holds more than one logical line, or a 2,000-character window of one.
- **Layer DOM:** a fixed set of one band and at most four scrim `div`s, changed through
  `style.transform` and `style.height` only. No list rendering.

---

## 11) Implementation outline

### 11.1 New files

| File | Kind | Responsibility |
|---|---|---|
| `frontend/src/utils/typewriterSettings.js` | pure | defaults per form factor, presets, `normalizeTypewriterSettings`, `DIM_ALPHA` |
| `frontend/src/utils/textFocus.js` | pure | `lineStarts`, `lineIndexAt`, `findBlock`, `findSentence`, `focusRange(text, selection, granularity)` |
| `frontend/src/utils/typewriterScroll.js` | pure | `effectiveAnchor`, `typewriterPadding`, `scrollTargetFor({ style, rowTop, rh, H, scrollTop, anchorY, nEff })`, `isAttached`, `classifyCaretChange`, `pointerRecentreDecision(gesture, state)` returning `none`, `schedule`, `afterViewportSettle` or `cancel`, the constants `CLICK_SETTLE_MS = 350`, `TAP_SLOP_PX = 10`, `CLICK_SLOP_PX = 4`, `TAP_MAX_MS = 500`, and `tweenStep(t)` |
| `frontend/src/utils/focusGeometry.js` | pure | `scrimRects({ focusStart, focusEnd, contentBox, totalHeight, rh })` returning ≤ 4 rectangles; `bandRect` |
| `frontend/src/store/typewriterStore.js` | store | load, normalise and save the `typewriter` settings row; `current`, `update`, `toggle` |
| `frontend/src/composables/useTypewriter.js` | controller | attach and detach listeners, the per-frame measure/compute/apply loop, mirror probe, padding, scroll tween, composition tracking, pointer-gesture tracking and the click-settle timer (cleared on unmount, disable and Document switch), and a hook for `useViewport`'s settle for the keyboard-opening tap. Takes `{ editor, textarea, wrapper, scrollContainer, bottomInset, settings }` plus an injectable `layout` adapter for tests. |
| `frontend/src/components/TypewriterLayer.vue` | UI | teleported band and scrim; reads the geometry the controller provides |
| `frontend/src/components/TypewriterOptions.vue` | UI | desktop options popover |
| `frontend/src/components/phone/PhoneTypewriterSettings.vue` | UI | phone Settings group |

### 11.2 Changed files

| File | Change |
|---|---|
| `components/Editor.vue` | Keep a `wrapperEl` shallow ref (from `editor.wrapper`), cleared before `destroyEditor()`. Bump a `previewVersion` in `onChange`. `inject` the scroll container and bottom inset. Run `useTypewriter` only while `typewriterStore.current.enabled`. Render `<Teleport :to="wrapperEl">` with `TypewriterLayer`. Handle the shortcut in `handleKeydown`. Apply padding to `editorContainerRef`. |
| `components/ContentArea.vue` | `provide('editorScrollContainer', …)` for the editor pane's scroll `div` |
| `components/phone/PhoneEditor.vue` | `provide` `.ph-write` and the key-row inset (0 in Preview mode) |
| `composables/useViewport.js` | expose an `onSettled(callback)` that fires after the last settle measurement following a focus change (its 700 ms timer), for the keyboard-opening tap (§5.4.1). It is unit-tested with the existing `useViewport.test.js`. |
| `components/SubMenuBar.vue` | the Typewriter toggle and the options button (§9.4) |
| `components/phone/DocumentMenuSheet.vue` | the switch row (§9.5) |
| `pages/PhoneSettingsPage.vue` | the Writing group |
| `assets/main.css`, `assets/phone.css` | `--pn-typewriter-line` (light and dark), `.pn-typewriter-*` layer styles, the `forced-colors` and `prefers-reduced-motion` rules |
| `frontend/AGENTS.md` | the store table row and an Editor note (the overlay lives in OverType's wrapper; never decorate the highlight layer) |
| `docs/architecture/` | a short "Editor overlay and typewriter mode" section (in the UI design system doc or a new `editor.md`) when this ships |

No backend, schema, sync or add-on changes.

### 11.3 Phases

Following the `feature-development` skill: utilities, then the store, then the UI, each phase
green before the next.

0. **Prototype** (throwaway, `frontend/tests/spike/` or a scratch branch). Run checks P1–P11
   (§12) and record the results and numbers in the agent log. Adjust §4.3 if P1–P3 fail.
1. **Utilities:** `typewriterSettings`, `textFocus`, `typewriterScroll`, `focusGeometry`, with
   unit tests.
2. **Store:** `typewriterStore`, with tests.
3. **Controller and layer:** `useTypewriter`, `TypewriterLayer`, Editor wiring, and the
   `provide`s in ContentArea and PhoneEditor. Desktop first, then phone insets and keyboard.
4. **Entry points:** SubMenuBar, options popover, shortcut, phone menu switch, phone Settings
   group.
5. **Verification and docs:** browser checks (§13.3), performance trace (§10), `frontend/AGENTS.md`
   and the architecture note. Move this spec to `active/`.

---

## 12) Prototype checks (before Phase 1)

| # | Question | Pass condition |
|---|---|---|
| P1 | Does the flattened highlight-layer element list (`div`, plus `li` inside `ul`/`ol`) map 1:1 to logical lines? Fixture: nested and ordered lists, tasks, fences (patched), tables, blank lines, front matter, `---`, blockquote, headings, `\pagebreak`, a line that is only spaces. | Count equals the logical line count, and each element's `offsetTop` equals the mirror-measured top of its line, for every fixture line |
| P2 | Does a one-line mirror wrap exactly like the highlight layer? Include long URLs (`break-word`), tabs (`tab-size: 2`), CJK, emoji, trailing spaces. | Marker rows and x positions within ±1 px of a Range measured on the highlight layer |
| P3 | Layering: is the band and scrim inside the wrapper above the text and below the caret and selection, in light, dark and phone surfaces, over code-block lines, with phone remote carets above? | Visual check plus a screenshot per theme |
| P4 | Does the browser's own "reveal caret" scrolling ever fire in typewriter style (for example at the end of the Document), causing a one-frame jump before the controller's scroll? | No visible double move in Chrome, Firefox and Safari. If it occurs, set `scrollTop` synchronously in the `input` handler for the instant case. |
| P5 | iOS Safari and Android Chrome keyboard open and close: does the system also scroll the window or visual viewport? Is re-anchoring after the `useViewport` settle timers enough, both for a resize and for the tap that opens the keyboard (§5.4.1, touch rule 4)? Does a tap-then-flick fire `pointercancel` in both browsers? | Caret row on the anchor ±1 row after the keyboard opens, with no fight between the two scrolls; a flick never re-centres (real devices; headless Puppeteer cannot show a keyboard) |
| P6 | Cost: frame work for (a) a 4,000-line Document, (b) a 1 MB Document, (c) a 50,000-character single line, with the mode off and on | Within §10. If (c) fails, use the §8.4 window fallback. |
| P7 | IME: Japanese IME (macOS Chrome/Safari) and Gboard (Android) while a composition wraps to a new row | Candidate window stays with the text, and no committed text is lost |
| P8 | Does `findNext` scroll the match into view today under `autoResize`? | Recorded as fact, which decides follow-up F2 |
| P9 | `Intl.Segmenter` results for the sentence fixture in Chrome, Safari, Firefox and Node 24 | Same boundaries for every case the unit tests pin |
| P10 | Does Ctrl/Cmd+Shift+Enter reach a focused textarea without a browser or OS action on Windows, macOS, Linux and ChromeOS? | The `keydown` is received and `preventDefault` is enough |
| P11 | Click re-centre timing: with the settle delay at 300, 350, 400 and 500 ms, try double- and triple-clicks at a relaxed pace (mouse and trackpad, Windows default 500 ms double-click time and macOS default), and double-taps on iOS and Android. Does a drag that starts within the delay still select correctly? Is `event.detail` reliable on `pointerup` in Chrome, Firefox and Safari? If not, use the `click` event's `detail`. | The shortest delay at which no double- or triple-click selects the wrong word in 20 tries each; record the chosen value |

---

## 13) Testing

### 13.1 Unit tests (Vitest, node environment)

- `typewriterSettings.test.js`: defaults per form factor; normalisation of missing, malformed,
  out-of-range and unknown values (anchor clamped to 20–80, lines to 0–10, enums from allow-lists);
  never throws.
- `textFocus.test.js`:
  - `lineStarts` and `lineIndexAt` at the boundaries (offset 0, the end, just after `\n`);
  - every row of the §7.2 table, including the code-fence runs, front matter, setext, nested list
    continuation, blank line (empty focus) and the 500-line cap;
  - sentences: multiple sentences, hard-wrapped sentences across lines, `e.g. the` (no split),
    `Dr. Smith` (split; pinned), URLs and inline code with dots, link destinations, quotes and
    brackets after the terminator, CJK `。`, the caret just after a terminator, the caret after
    trailing whitespace at the end of the block (empty focus), the 2,000-character window, and
    the regex fallback when `Intl.Segmenter` is missing;
  - `focusRange` with a selection that spans blocks (union).
- `typewriterScroll.test.js`: `effectiveAnchor` clamping with small `H` (phone keyboard: 6 visible
  rows, N = 3 → N clamped to 2); padding at the top and end; `scrollTargetFor` in typewriter and
  margin styles (above, inside and below the margin); padding compensation when turning on and off;
  `isAttached` within ±1 px; `classifyCaretChange` for input, keyboard, pointer, programmatic and
  remote; tween steps finish at the target and restart from the current position.
- `pointerRecentreDecision` (same file), one case per rule in §5.4.1:
  - **schedule** for a primary-button single click with a collapsed selection and ≤ 4 px of
    movement;
  - **none** for: right or middle button; `detail` ≥ 2; a non-empty selection (drag, Shift+click,
    double- or triple-click); more than 4 px of movement; composing; style Off;
  - touch: **schedule** for a tap; **none** for more than 10 px, more than 500 ms, `pointercancel`
    or a non-empty selection; **wait for the viewport to settle** when the textarea was not
    focused before;
  - margin style: **scroll** only within N rows of an edge;
  - **cancel** on a `pointerdown` or `keydown` before the timer, and on a selection that is no
    longer collapsed when the timer fires;
  - **none** for a row already at the anchor.
- `focusGeometry.test.js`: scrim rectangles for a block focus (2 rectangles), a mid-row sentence
  (4), a focus at the Document start or end (1), an empty focus (the whole layer), and a selection
  union.

### 13.2 Store and component tests (jsdom)

- `typewriterStore.test.js`: loads after the database is ready; reloads on user switch; saves the
  `typewriter` row through the debounce; keeps the other form factor's profile untouched; does not
  touch `uiSettings`; recovers from invalid JSON.
- `useTypewriter.test.js` with a fake `layout` adapter (jsdom has no layout):
  - nothing attached while off (spy on `addEventListener`), and everything detached on disable and
    unmount;
  - with fake timers, a single click sets `scrollTop` only after the 350 ms settle delay, and
    (with an injected clock) the tween runs 180 ms;
  - a second `pointerdown` within the delay cancels the click re-centre, and nothing scrolls while
    a pointer is down;
  - a focusing tap on phone re-centres after the viewport-settle callback, not on the timer;
  - composition holds back dimming;
  - remote apply while attached re-anchors instantly, and while detached does nothing;
  - reduced motion makes scrolling instant.
- `subMenuBarTypewriter.test.js`: button `aria-pressed` follows the store; clicking toggles;
  the options popover controls update the store; dependent controls hide (§9.6).
- `documentMenuSheetTypewriter.test.js` and the `PhoneSettingsPage` Writing group: the switch and
  controls round-trip through the store.
- Editor source checks, in the style of `editorConflictSafety.test.js`: the shortcut is handled in
  `handleKeydown`, and the overlay is detached before `destroyEditor()`.

### 13.3 Browser checks (dev stack; 1280×800 desktop and 375×812 phone; light and dark)

On desktop, use the Chrome tab. On phone width, use headless Puppeteer from the backend
`node_modules`, as in the existing phone-width procedure. Record steps and results in the agent
log.

1. Turn the mode on with the button, then with Ctrl+Shift+Enter (toast shown). Type 60 lines of
   prose. After each Enter, the caret row's top is within ±1 px of `anchorY`.
2. Ctrl+Home, then Ctrl+End: the first and the last row each sit on the anchor.
3. Click a line far from the anchor. The band and dimming move to it at once. About 350 ms later
   the row glides to the anchor (about 180 ms), and its top ends within ±1 px of `anchorY`.
   Repeat with reduced motion emulated: the move is instant.
4. Double-click and triple-click a word far from the anchor, at a quick pace and at a relaxed one:
   the intended word or line is selected, and nothing scrolls before, between or after the clicks.
   Drag-select across paragraphs: no scrolling by the mode during the drag, and no band while the
   selection is non-empty. Shift+click: the selection extends with no scroll. Right-click: no
   scroll.
5. Scroll away with the wheel, then press an arrow key: re-anchors. Scroll away again, then click
   a line: that line re-centres.
5a. Phone (Puppeteer touch emulation): tap a line with the keyboard closed and with it open
    (emulated by resizing). The row re-centres on the anchor above the key row. Swipe to scroll:
    no re-centre. Long-press to select a word: no re-centre. Real devices for the system keyboard
    (P5).
6. Find "term" with Find Next: the match lands on the anchor.
7. Undo and redo: the caret row is on the anchor after each.
8. Dim: Paragraph, Sentence and Off in a fixture with a heading, list, code block, table and
   blockquote. Screenshot each. Subtle, Medium and Strong in both themes.
9. Scroll Sync on with the Preview visible: the Preview follows while typing. Scrolling the Preview
   detaches, and typing re-anchors.
10. Switch theme while on: the overlay is back, with the correct background colour.
11. Margin style with N = 3: arrowing down never brings the caret within 3 rows of the bottom.
12. Phone: Edit mode, keyboard up (on a real device for P5). The anchor is computed above the key
    row. Toggle from the Document menu. Preview mode and back works with no errors.
13. Shared Document in a live session (two browsers): while the other side types above, the local
    row stays on the anchor.
14. Mode off: `.pn-typewriter-layer` is absent and there is no editor padding change. Compare a
    performance trace of typing against `main`.
15. The console has no errors in every step.

---

## 14) Security review

- No content leaves the device because of this mode, and no request is added.
- Settings are validated with allow-lists and integer clamps before use (§9.2). Malformed synced
  JSON falls back to the defaults.
- The overlay is built only from numbers (px geometry) and fixed class names. No Document text is
  put into HTML, CSS or `innerHTML`. The mirror sets `textContent` only, like `caretPosition.js`.
- No dependency is added.

---

## 15) User journeys

| # | Persona | Journey | Acceptance criteria |
|---|---|---|---|
| U1 | Desktop writer | Opens the Editor menu and clicks **Typewriter**, then writes several paragraphs. | The button shows pressed. After every Enter or wrap, the caret row's top is within ±1 px of the anchor (50 % of the visible editor). The current row has the band. Other paragraphs are dimmed at Medium. |
| U2 | Desktop writer | Toggles the mode with Ctrl/Cmd+Shift+Enter while typing. | The mode toggles, the toast says on or off, focus stays in the editor, and no character is inserted. |
| U3 | Desktop writer | Goes to the very start and the very end of a long Document. | The first row and the last row each reach the anchor. No text jumps when the mode is turned off at either end. |
| U4 | Desktop writer | Clicks once into a paragraph far from the anchor. | Dimming and the band move to the clicked row at once. About 350 ms after the click, the row animates (180 ms) to the anchor, ending within ±1 px. With reduced motion the move is instant. |
| U4b | Desktop writer | Double-clicks, then triple-clicks, a word far from the anchor, then drag-selects across two paragraphs. | The intended word and line are selected. Nothing scrolls before, between or after the clicks, or during the drag. The band hides while text is selected. A later single click that collapses the selection re-centres. |
| U5 | Desktop writer | Scrolls up with the trackpad to reread, then continues typing, or clicks a line. | The view does not fight the scroll. The first keystroke returns the caret row to the anchor, or a click brings the clicked row there (animated, or instant under reduced motion). |
| U5b | Phone writer | Taps a line in Edit mode with the keyboard closed, then swipes to scroll, then long-presses a word. | The tap opens the keyboard, and once the viewport settles the tapped row animates to the anchor above the key row. The swipe scrolls freely with no re-centre. The long-press selects the word with no re-centre. |
| U6 | Desktop writer | Sets Scrolling to **Keep lines visible** with 5 lines and moves the caret with the arrows. | The view does not scroll while the caret row is more than 5 rows from both edges. It scrolls just enough to keep 5 rows visible on the side being approached. |
| U7 | Desktop writer | Switches Dim to **Sentence** and writes a paragraph of several sentences. | Only the sentence holding the caret is undimmed. Starting a new sentence after a space dims the previous one. Headings, table rows and code lines focus as whole lines. |
| U8 | Writer using find | Uses Find Next in typewriter mode. | Each match is selected and moved to the anchor. |
| U9 | Phone writer | Opens the Document menu, turns on **Typewriter mode**, and writes with the keyboard up. | The caret row stays at the anchor of the area between the header and the key row. No text hides behind the key row or keyboard. Turning the phone or closing the keyboard re-anchors. |
| U10 | Phone writer | Changes Line position to Higher and Dim strength to Subtle in Settings → Writing. | Settings apply on return to the Document. The desktop profile is unchanged. |
| U11 | Writer with two desktops | Turns the mode on at one desktop. | After sync, the other desktop shows the mode on with the same options. A phone of the same user keeps its own state. |
| U12 | Live-session participant | Writes while a collaborator types several lines above. | The local caret row stays on the anchor. Nothing typewriter-related goes to the collaborator. |
| U13 | Japanese IME user | Composes a long phrase that wraps to a new row. | The candidate window stays with the text, the row stays at the anchor, and no committed text is lost. |
| U14 | User with reduced motion and forced colours | Uses the mode with `prefers-reduced-motion` and Windows High Contrast. | All scrolling is instant. In forced colours, the band and dimming are not drawn, and scrolling still works. |
| U15 | Any user, mode off | Edits as before. | No overlay element, no padding, no new listeners. Typing performance matches `main`. |

---

## 16) Decisions

| # | Decision | Chosen | Alternatives rejected and why |
|---|---|---|---|
| D1 | Shape of the feature | One mode with sub-options | Four toggles: crowd the toolbar, no room on phone, four actions to get the intended experience |
| D2 | Where to draw | A Panino layer teleported into OverType's wrapper, between the highlight layer and the textarea | Decorating the highlight layer (erased by `innerHTML` rebuilds); a layer outside the wrapper (cannot get between the layers); Custom Highlight API (loses syntax colours, Ranges go stale) |
| D3 | How to dim | A scrim of ≤ 4 rectangles in the editor background colour at an alpha | Per-element opacity (cannot dim part of a line, erased by rebuilds) |
| D4 | What scrolls | The ancestor scroll container (desktop pane `div`, phone `.ph-write`), with spacer padding on `editorContainerRef` | Turning off `autoResize` so the textarea scrolls (re-plumbs banners, Scroll Sync and phone layout; risky) |
| D5 | Measuring | Line element `offsetTop` plus a one-line persistent mirror | The whole-prefix mirror of `caretPosition.js` (O(Document) per keystroke) |
| D6 | "Lines above and below" (Kris, 2026-11-07: former Q1) | A scroll margin N (scrolloff), also the lower limit on the typewriter anchor | An undimmed window of N lines (not wanted); the anchor expressed in lines (over-constrained) |
| D7 | Highlight unit | The caret's visual row | The whole logical line (lights up a wrapped paragraph) |
| D8 | Selections | Band hidden while the selection is non-empty; dimming focus is the union | Band on the head row (mixes with the selection colour) |
| D9 | Pointer caret moves (Kris, 2026-11-07: former Q2, changed) | Like iA Writer, a single click or tap re-centres straight away. It fires 350 ms after `pointerup` with a collapsed selection and no drag; animates 180 ms (instant with reduced motion); is cancelled by another `pointerdown` or a key; never runs mid-drag, with a selection, or while composing. A keyboard-opening tap re-centres once the viewport settles. Swipes and long-presses never re-centre. | Waiting for the next keystroke (the earlier recommendation; Kris prefers immediate re-centring); re-centring on `pointerup` with no delay (the second click of a double-click lands on moved text) |
| D10 | Free scrolling | Never fought; "attached" is derived from the last `scrollTop` the mode set | Snapping back on a timer (fights reading) |
| D11 | Motion | 100 ms / 180 ms rAF tween; instant for open, resize, remote edits and IME; reduced motion turns it off | Native smooth scroll (uncontrollable, stutters under rapid calls); always instant (jarring line jumps) |
| D12 | Top and end | Symmetric padding so both ends reach the anchor | No top padding (the line is not fixed near the start) |
| D13 | Sentence detection | `Intl.Segmenter` on an offset-preserving masked string, with a regex fallback | A hand-written regex alone (worse with abbreviations and CJK) |
| D14 | Storage (Kris, 2026-11-07: former Q3) | A new synced `settings` row `typewriter`, with desktop and phone profiles | Inside `uiSettings` (older clients erase unknown keys); `localStorage` (no sync between a writer's desktops) |
| D15 | Shortcut (Kris, 2026-11-07: former Q5) | Ctrl/Cmd+Shift+Enter, scoped to the editor (P10 still checks browsers) | Mod+Shift+T (reopen tab), Mod+D (bookmark), Ctrl+Alt+T (Linux terminal) |
| D16 | Defaults (dim strength: Kris, 2026-11-07: former Q4) | Off; when on: Typewriter at Middle, N = 3 (phone 2), highlight on, Paragraph at **Medium** | Subtle by default (Kris chose Medium) |
| D17 | Click-settle delay (Kris, 2026-11-07: former Q6) | Start at 350 ms; prototype check P11 sets the final value within 300–500 ms. A constant, not a user setting. | No delay (breaks double-click); a user setting (a knob nobody should need) |

---

## 17) Open questions for Kris

Kris answered Q1–Q6 on 2026-11-07. The answers are recorded in the Decisions table: D6, D9,
D14, D15, D16 and D17. None remain open.

---

## 18) Follow-ups (out of scope)

- **F1:** a full-screen writing view (hide the Navbar, sidebar and Preview) that pairs with this
  mode.
- **F2:** make `findNext` reveal matches when typewriter mode is off (P8). It should reuse
  `typewriterScroll`'s margin logic with N = 3.
- **F3:** remember the caret position per Document and restore it on open.
- **F4:** a continuous anchor slider in place of the three presets (storage already allows 20–80).
