# Speed up WebSocket integration tests

Agent: Copilot CLI runtime in VS Code
Start: 2026-08-16T13:44:31+02:00
Status: Complete

## Objective

Remove fixed waits from WebSocket integration tests while preserving valid connection, rejected
connection, sync notification, sender exclusion, and cross-user exclusion coverage.

## Progress

The focused baseline ran 6 tests in 7.99 seconds. It used three 1-second and three 2-second
delays to observe socket close or non-delivery behavior.

## Changes Made

- Added bounded event helpers for WebSocket open, close, message, and cleanup.
- Replaced close polling with assertions on the server's 1008 close code.
- Replaced the positive notification delay with an assertion on the received sync message.
- Replaced negative notification delays with spies on the exact server-side WebSocket `send`
  method, which is called synchronously by the `/sync` route.

## Tests

- Focused baseline: `tests/integration/websocket.test.js` — 6 passed in 7.99 seconds.
- Optimized focused test repeated three times — 6 passed in 1.98, 2.01, and 2.01 seconds.
- `npm run test:be` — 15 files and 170 tests passed.

## Open Items / Notes

- Event-helper timeouts remain only as failure safeguards and do not delay passing tests.
