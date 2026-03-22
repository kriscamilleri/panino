# Dictate — Spec

> Browser-native voice-to-text transcription inserted into the editor.
> Status: Draft — 2026-03-22

---

## 1) Summary

Add a **Dictate** button to the Editor submenu bar that uses the browser's native [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) (`SpeechRecognition`) to transcribe spoken words and insert **finalized** speech segments into the active editor. While recording, the button itself shows that recording is active and how long it has been running.

---

## 2) Goals

1. Start/stop voice dictation from the Editor submenu bar with a single click.
2. Insert finalized transcription into the editor incrementally as results arrive.
3. Give the user a clear visual cue that recording is active, including an elapsed timer.
4. Handle permission denial and unsupported browsers gracefully.
5. No backend changes required — this is a purely client-side feature.

## Non-Goals

- No cloud-based speech API (e.g. Google Cloud Speech, Whisper). Native browser only.
- No guarantee of offline or on-device transcription. Some browsers implement `SpeechRecognition` using a vendor service.
- No voice commands or special dictation markup (e.g. "new line", "comma").
- No language selection UI in v1 — use the browser/OS language setting.
- No speaker identification or multi-speaker support.
- No transcription history or replay.
- No inline interim ghost text inside the editor in v1.
- No mobile-specific push-to-talk. Tap to toggle is sufficient.

---

## 3) Browser API

The feature relies on the [Web Speech API SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) interface.

```js
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
```

Important constraint: "native browser" does not mean fully local. MDN notes that some browsers, including Chrome, may send audio to a browser-managed speech service, so dictation may be unavailable offline even though Panino itself makes no backend request for transcription.

### Configuration

| Property | Value | Rationale |
|---|---|---|
| `continuous` | `true` | Keep listening until user explicitly stops |
| `interimResults` | `true` | Preserve interim transcript data for smoother result handling and future UI hooks |
| `lang` | `navigator.language` | Use browser/OS locale |
| `maxAlternatives` | `1` | Single best result is sufficient |

### Browser support

| Browser | Support |
|---|---|
| Chrome / Edge | ✅ Full |
| Safari 14.1+ | ✅ (webkit prefix) |
| Firefox | ❌ No support at time of writing |

If `SpeechRecognition` is not available on `window`, the Dictate button must be hidden entirely — no polyfill or fallback required. In practice this means the control is currently hidden in Firefox.

---

## 4) User Experience

### 4.1 Entry Point — Submenu Bar Button

Add a **Dictate** button to the Editor submenu (`SubMenuBar.vue`), after the existing separator that follows the image-library button and before the Find/Replace group.

```
... | Image from Library | [separator] | Dictate | [separator] | Find... | ...
```

All recording state is communicated entirely within the button itself — no separate status bar or overlay is introduced.

**Idle state:**

```
╔══════════════╗
║  🎤  Dictate ║
╚══════════════╝
```

- Standard submenu button style (same as Undo, Bold, etc.).
- Hidden if `SpeechRecognition` is not available.
- Disabled if no editor instance is currently available to receive inserted text.

**Active (recording) state:**

```
╔══════════════════════════════╗
║  🎤  ∿∿∿∿∿  0:07            ║
╚══════════════════════════════╝
```

- Button background turns red (`bg-red-50 border-red-300 text-red-700`).
- The "Dictate" text label is replaced by:
  1. A mini **audio waveform line** — a small inline SVG `<polyline>` whose points animate in real time based on incoming microphone amplitude (using `AudioContext` + `AnalyserNode`). The line uses the button's current text colour and animates smoothly, resembling an oscilloscope trace.
  2. An **elapsed timer** in `M:SS` format, updated every second, displayed after the waveform.
- The mic icon remains visible on the left.
- Clicking the button again stops recording and returns to idle state.

The waveform line is a fixed-size inline SVG (e.g. `width="40" height="16"`) with a single `<polyline>` element whose points are updated each animation frame. When silent the line is flat; amplitude pushes the points above and below the midline.

### 4.2 Interim Text

`interimResults` should still be enabled on `SpeechRecognition`, but v1 does **not** render interim text inside the editor. The composable may expose `interimTranscript` for future enhancements, but only finalised speech segments are inserted into the document in this version.

Rationale: the current editor is an Overtype-backed textarea, not a CodeMirror surface with an existing decoration layer, so inline ghost text would require separate editor work and should not be treated as part of this first implementation.

### 4.3 Stopping

Dictation stops when:
- The user clicks **Dictate** again (toggle off).
- The note is closed or the editor is unmounted.
- The browser tab becomes hidden (see §5.3).

If the browser fires `speechrecognition.onend` for any reason other than an intentional stop (for example a browser-imposed silence timeout), the composable should automatically restart `recognition` to keep the session alive until the user explicitly stops it. Intentional stops include button toggle-off, editor teardown, and tab-hidden handling; those paths must suppress auto-restart.

On stop, the waveform animation stops and the button returns to idle state. The implementation should not manually commit raw interim text; only final results emitted by the speech API are inserted.

### 4.4 Error States

| Scenario | UI Response |
|---|---|
| Permission denied (`not-allowed`) | Toast: "Microphone access denied. Please allow microphone in your browser settings." |
| No speech detected / timeout | No toast. Allow normal `onend` handling to either restart or return to idle. |
| Service unavailable (`service-not-allowed`, `network`) | Toast: "Speech recognition is unavailable. Check your connection or browser settings." |
| API not available (unsupported browser) | Button is hidden — no toast needed. |

Toasts use the existing `ToastContainer` pattern in the app.

When permission is denied or an error occurs mid-session, the `AudioContext` and `AnalyserNode` must be closed/disconnected before returning to idle state to avoid lingering microphone access.

---

## 5) Behaviour Details

### 5.1 Cursor position

Each finalised segment is inserted using the editor's current selection/cursor via the same insertion pathway used by existing toolbar actions. V1 does **not** maintain a hidden anchored insertion range across manual typing or cursor moves. If the user edits the document while dictating, subsequent dictated text follows the editor's then-current insertion point.

### 5.2 Punctuation

The Web Speech API returns punctuation in some locales. No normalisation is applied in v1 — whatever the API returns is inserted verbatim. A space is prepended if the character immediately before the insertion point is not a whitespace or newline character.

### 5.3 Tab visibility

When the browser tab goes into the background, `SpeechRecognition` is typically paused or stopped by the browser automatically. The feature should listen to `document.visibilitychange` and stop dictation if the tab becomes hidden while recording. This stop should be treated as intentional so auto-restart does not immediately re-arm the microphone.

### 5.4 Concurrent use

Only one Dictate session can be active at a time. Because the current app layout exposes a single editor instance, no cross-pane coordination is required in v1 beyond keeping the composable scoped to the active editor toolbar.

---

## 6) Implementation Notes

### 6.1 New composable: `useDictation`

Create `frontend/src/composables/useDictation.js`.

Responsibilities:
- Wrap `SpeechRecognition` lifecycle (start, stop, events).
- Open a `getUserMedia` audio stream and connect it to an `AudioContext` + `AnalyserNode` when recording starts; close/disconnect both on stop or error.
- Expose reactive state: `isRecording`, `elapsedSeconds`, `interimTranscript`, `isSupported`, `waveformPoints`.
- `waveformPoints` is a `Ref<string>` — a pre-formatted SVG `points` attribute string (e.g. `"0,8 10,3 20,13 30,5 40,8"`) updated each animation frame for the waveform line.
- Accept a callback `onFinalResult(text)` called for each finalised speech segment.
- Optionally accept a callback `onInterimResult(text)` for future UI hooks, even though v1 does not render inline interim text.
- Handle tab-hidden auto-stop and clean up all resources (`recognition`, `AudioContext`, `MediaStream`, `requestAnimationFrame` handle) on composable teardown (`onUnmounted`).

```js
// Minimal public API
const {
  isSupported,        // Boolean — false if SpeechRecognition unavailable
  isRecording,        // Ref<Boolean>
  elapsedSeconds,     // Ref<Number>
  interimTranscript,  // Ref<String>
  waveformPoints,     // Ref<string> — SVG polyline points attribute
  startDictation,
  stopDictation,
} = useDictation({ onFinalResult, onInterimResult })
```

**Audio visualiser implementation:**

```js
// Inside startDictation()
const SVG_W = 40, SVG_H = 16, NUM_POINTS = 8
const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
const audioCtx = new AudioContext()
const analyser = audioCtx.createAnalyser()
analyser.fftSize = 256
const source = audioCtx.createMediaStreamSource(stream)
source.connect(analyser)

const data = new Uint8Array(analyser.frequencyBinCount)
const tick = () => {
  if (!isRecording.value) return
  analyser.getByteTimeDomainData(data)  // oscilloscope-style time domain
  const points = Array.from({ length: NUM_POINTS }, (_, i) => {
    const idx = Math.floor(i * data.length / NUM_POINTS)
    const y = ((data[idx] - 128) / 128) * (SVG_H / 2 - 1) + SVG_H / 2
    return `${(i / (NUM_POINTS - 1)) * SVG_W},${y.toFixed(1)}`
  }).join(' ')
  waveformPoints.value = points
  rafHandle = requestAnimationFrame(tick)
}
waveformPoints.value = `0,${SVG_H/2} ${SVG_W},${SVG_H/2}` // flat line at rest
rafHandle = requestAnimationFrame(tick)
```

Using `getByteTimeDomainData` (rather than frequency data) produces an oscilloscope-style trace that intuitively responds to voice — flat when silent, undulating when speaking.

The `getUserMedia` permission prompt and `SpeechRecognition` permission prompt may appear at the same time in some browsers; this is acceptable behaviour.

### 6.2 Editor integration

In `SubMenuBar.vue`:
- Import and call `useDictation`.
- On `onFinalResult(text)`: call a new `editorStore.insertText(text)` helper that routes through the editor's existing insertion path, prepending a space if needed.
- Disable the Dictate button when no editor instance is available.

This requires a small editor-bridge addition:
- `Editor.vue` should expose a plain-text insertion method alongside the existing formatting helpers.
- `editorStore.js` should forward a new `insertText(text)` call to that exposed editor method.

`SubMenuBar.vue` should not reach into the editor DOM directly.

### 6.3 Interim ghost text (follow-up, not v1)

If richer inline preview is desired later, it should be implemented as dedicated editor work on top of the current Overtype/textarea setup. That likely means an overlay or decoration-like layer owned by `Editor.vue`, not direct document mutation from the toolbar on every interim event.

### 6.4 SubMenuBar button

Add to `SubMenuBar.vue` inside the `v-else-if="ui.showActionBar"` block, after the image-library button and before the Find/Replace separator:

```html
<template v-if="dictation.isSupported">
  <div class="separator"></div>
  <button
    @click="toggleDictation"
    :disabled="dictationDisabled"
    :class="[
      'px-3 py-1 border rounded text-sm flex items-center gap-1.5 cursor-pointer',
      dictationDisabled && 'opacity-50 cursor-not-allowed',
      dictation.isRecording
        ? 'bg-red-50 border-red-300 text-red-700'
        : 'bg-white hover:bg-gray-50'
    ]"
    :title="dictation.isRecording ? 'Stop Dictation' : 'Start Dictation'"
    :aria-label="dictation.isRecording ? 'Stop dictation' : 'Start dictation'"
    aria-pressed="dictation.isRecording"
    data-testid="submenu-editor-dictate"
  >
    <Mic class="w-4 h-4 shrink-0" />
    <!-- Idle: text label -->
    <span v-if="!dictation.isRecording" class="button-text">Dictate</span>
    <!-- Recording: waveform line + timer -->
    <template v-else>
      <svg
        width="40" height="16"
        aria-hidden="true"
        class="shrink-0 overflow-visible"
      >
        <polyline
          :points="dictation.waveformPoints"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="button-text tabular-nums">
        {{ formatElapsed(dictation.elapsedSeconds) }}
      </span>
    </template>
  </button>
</template>
```

Icon: use `Mic` from Lucide (already a project dependency). The waveform is a small inline SVG `<polyline>` updated each animation frame — inherits the button's `currentColor` so it automatically matches the red recording state.

---

## 7) Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `frontend/src/composables/useDictation.js` | **Create** | SpeechRecognition + AudioContext wrapper composable |
| `frontend/src/components/SubMenuBar.vue` | **Modify** | Add Dictate button with waveform visualiser to editor action bar |
| `frontend/src/store/editorStore.js` | **Modify** | Forward plain-text insertion to the active editor |
| `frontend/src/components/Editor.vue` | **Modify** | Expose plain-text insertion through the existing editor bridge |
| `frontend/tests/unit/useDictation.test.js` | **Create** | Unit coverage for recognition lifecycle and audio cleanup |
| `frontend/tests/unit/editorStore.test.js` | **Modify** | Cover `insertText()` forwarding |

No backend changes required. A separate status bar component is not needed — all recording UI remains within the submenu button.

---

## 8) Tests

### Unit tests (`frontend/tests/unit/`)

- `useDictation.test.js`
  - Returns `isSupported: false` when `SpeechRecognition` is absent on `window`.
  - `startDictation` calls `recognition.start()` and `getUserMedia`.
  - `stopDictation` calls `recognition.stop()`, closes `AudioContext`, stops media tracks, and resets elapsed timer.
  - `onFinalResult` callback is called with correct text on `onresult` event.
  - `elapsedSeconds` increments correctly while recording.
  - `waveformPoints` is a valid SVG points string with `NUM_POINTS` coordinate pairs.
  - Stops recording and cleans up resources when tab becomes hidden.
- `editorStore.test.js`
  - Forwards `insertText()` to the exposed editor method.
  - Does not throw when `insertText()` is unavailable.

### Component tests

Component rendering tests for `SubMenuBar.vue` are useful but are **not** turnkey in the current frontend test setup because Vitest is configured for a Node environment and the repo does not yet include Vue component-test utilities. If this coverage is added, include the required test-harness setup (`jsdom` plus Vue component testing utilities) as part of the implementation task.

### Manual / MCP validation

- Verify Dictate button appears in editor submenu bar.
- Verify button is hidden in Firefox / unsupported browsers.
- Verify the button itself changes into the recording state and returns to idle on stop.
- Verify elapsed timer counts up correctly.
- Verify waveform line animates visibly while speaking (undulates with voice).
- Verify line returns to flat/still immediately after stopping.
- Verify transcribed text is inserted at cursor.
- Verify the button is disabled when no note/editor instance is active.
- Verify permission-denied toast appears correctly.
- Verify no console errors in idle, recording, and stopped states.
- Verify no lingering microphone access indicator in browser after stopping (check OS mic indicator goes off).
- Verify at 375px mobile viewport: waveform SVG and timer are still visible; button does not overflow the submenu.
- Verify offline behavior is graceful: the button may still be present in supported browsers, but recognition failure shows the expected unavailable toast.

---

## 9) Accessibility

- Button has a descriptive `title` attribute that changes with state.
- Button should also expose an `aria-label` that changes with state (`"Start dictation"` / `"Stop dictation"`).
- `aria-pressed` should be set to `true` while recording (toggle button pattern).
- The waveform SVG should be `aria-hidden="true"`.
- The elapsed timer text inside the button can use `aria-live="polite"` if periodic announcements are acceptable; do not introduce a separate status bar for accessibility in v1.

---

## 10) Open Items

- **Language selection**: Could be added as a future setting under `uiSettings` in the settings store.
- **Auto-restart on browser timeout**: Some browsers fire `onend` after a short silence even with `continuous: true`. The composable must track a `stoppedByUser` flag and re-call `recognition.start()` in the `onend` handler whenever `stoppedByUser` is false, so the session stays active indefinitely until explicitly stopped by the user.
- **Anchored insertion session**: If product requirements later demand "keep appending at the original start position even if the user moves the caret", that should be implemented in `Editor.vue` as explicit session state rather than inferred from toolbar-level code.
- **Inline interim preview**: If richer inline preview is desired, explore an editor-owned overlay/decoration approach for the current Overtype-based editor — deferred to a follow-up.
- **Privacy / offline messaging**: Decide whether the UI should explicitly warn users that browser-native recognition may rely on vendor services and may not function offline.
- **Mobile UX**: Test dictation on iOS Safari (webkit prefix, microphone permission flow differs slightly).
