# Editor: OverType layers and typewriter mode

How the markdown editor is put together, and how typewriter mode draws on top of it. Spec:
[`docs/specs/active/typewriter-mode.md`](../specs/active/typewriter-mode.md). Evidence: the
prototype checks in
[`docs/agent-logs/2026/11/2026-11-08_19-31_typewriter-mode.md`](../agent-logs/2026/11/2026-11-08_19-31_typewriter-mode.md).

## OverType's DOM

`components/Editor.vue` creates OverType 1.2.7 with `autoResize: true`:

```text
div.overtype-container
└─ div.overtype-wrapper            position: relative; z-index: 1 (one stacking context)
   ├─ textarea.overtype-input      z 1, transparent text, draws the caret and selection
   ├─ div.overtype-preview         z 0, the highlighted text, rebuilt with innerHTML
   └─ div.pn-typewriter-layer      z 0 after the preview: over the text, under the caret
```

- **The highlight layer has one element per logical line.** Its children, with `ul`/`ol`
  expanded into their `li`s, map 1:1 to the lines of the text, including blank lines (`&nbsp;`),
  code fences (Panino's patch keeps them as plain `div`s), tables, quotes and front matter. Each
  element's top is its first row's top.
- **Every visual row has the same height** (`line-height`), and the textarea and the highlight
  layer wrap identically. A Range on the highlight layer's text gives the exact row and x of a
  character, and is cheap even for a 50,000-character line; a mirror of only that line, with the
  next character inside the marker, agrees with it. A zero-width marker at a soft-wrap point lands
  at the end of the earlier row, which is why the marker holds the character.
- **Never decorate the highlight layer.** `updatePreview()` replaces it on every input, every
  `setValue`, and 50 ms after every selection change; anything added to it is gone a moment
  later. Draw in a separate layer and only read the line elements. OverType's `onChange` runs at
  the end of every rebuild, which is the signal that cached elements are stale.
- **The textarea never scrolls.** `autoResize` grows it to the content; an ancestor scrolls:
  ContentArea's editor-pane `div.overflow-y-auto` on desktop, `.ph-write` on phones. Both
  provide it as `editorScrollContainer`; PhoneEditor also provides `editorBottomInset`, the
  key row's height in Edit mode.
- **OverType's CSS reset** (`.overtype-container *`) forces margin, padding and border to 0 on
  every element inside the container. A measuring element needs its padding, so it lives in the
  body.
- `findNext` focuses and selects the match but does not reveal it: under `autoResize` its
  `textarea.scrollTop` is a no-op, and Chrome scrolls the pane to the end of the Document instead
  of to the match (prototype check P8). Typewriter mode follows the selection, so it reveals
  matches while it is on.

## Typewriter mode

| Piece | Role |
|---|---|
| `store/typewriterStore.js` | The `settings` row `typewriter` (`{ version, desktop, phone }`), not `uiSettings`, which older clients rewrite from a fixed field list. `current` is this form factor's profile. Reloads after each sync round. |
| `utils/typewriterSettings.js` | Defaults, normalisation (never throws), option copy |
| `utils/textFocus.js` | Markdown blocks and sentences (`Intl.Segmenter` on an offset-preserving masked string, regex fallback) |
| `utils/typewriterScroll.js` | Anchor, padding, scroll targets, click and tap re-centre decisions, tween |
| `utils/focusGeometry.js` | Band and ≤ 4 scrim rectangles |
| `composables/useTypewriter.js` | The controller: listeners only while on, one measure → compute → apply pass per animation frame, padding on the editor container, scroll tween |
| `components/TypewriterLayer.vue` | Teleported into the wrapper; styles written directly, no re-render per frame |

- The scrim is the editor's computed background colour at the dim alpha, so syntax colours dim
  by the same proportion and no per-theme token is needed. The band is `--pn-typewriter-line`.
- Spacer padding on `editorContainerRef` (outside the wrapper) lets the first and the last row
  reach the anchor; every padding change moves `scrollTop` by the same amount, so the text does
  not move on screen. Turning the mode off at the very top or bottom of a Document cannot keep
  that promise: without the padding there is nothing to scroll into, and the text moves.
- The mode never reacts to scroll events. It is "attached" while `scrollTop` is within 1 px of
  the last value it set; remote edits and resizes re-anchor only then.
- Mode off: no listeners, no layer, no padding. The only cost is a call from `onChange` into a
  controller that does not exist.
