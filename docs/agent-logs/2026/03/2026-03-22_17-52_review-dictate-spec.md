# Review Dictate Spec

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-22 17:52
**Status:** completed

## Objective
Review docs/specs/dictate.md for implementation viability against the current frontend and amend the spec where needed.

## Progress
- [x] Read root and frontend agent guidance
- [x] Inspect current toolbar and editor bridge
- [x] Verify browser support constraints for SpeechRecognition
- [x] Amend dictate spec for viable v1 scope
- [x] Verify revised spec for internal consistency

## Changes Made
- `docs/specs/dictate.md` — corrected browser support expectations, removed inline ghost-text from v1, documented required editor bridge changes, aligned tests with the current frontend harness, and clarified privacy/offline constraints of browser-native speech recognition.

## Tests
- Spec review only; no automated code tests run.

## Open Items / Notes
- Current editor exposes insertAtCursor internally, but editorStore does not currently expose plain text insertion.
- Current editor is Overtype plus textarea, so CodeMirror-decoration ghost text is not a drop-in option.
- MDN currently reports SpeechRecognition as unsupported in Firefox and notes that some browsers use server-side recognition.
