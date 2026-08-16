# Correct dark preview code blocks

Agent: Copilot CLI
Started: 2026-08-16 20:05 +02:00
Status: complete

## Objective

Prevent Markdown preview code blocks from rendering with white light-mode surfaces in dark mode.

## Progress

- Traced the issue to `markdownStore`, which writes light code colors inline on generated
  `<pre>` elements.
- Confirmed normal dark-theme stylesheet declarations lose to those inline declarations.

## Changes Made

- Added `!important` dark-theme preview code foreground and background declarations to
  override the renderer's inline light-mode styles.
- Kept the nested `<pre><code>` element transparent so the block retains a single surface.
- Added a focused regression test for the required CSS cascade.

## Tests

- `npm test --prefix frontend -- --reporter=verbose tests/unit/darkPreviewCodeBlocks.test.js`
  - 1 test passed.

## Open Items / Notes

- Browser validation was blocked because the available shared workspace page has a pre-existing
  `BaseButton` render error and cannot reach a preview surface.
