# Repair Production Checkout Metadata

**Agent:** Copilot CLI
**Started:** 2026-08-08 09:29 CEST
**Status:** blocked

## Objective
Diagnose and, after explicit approval, repair the production VPS Git checkout so deployment pulls from `main` work again.

## Progress
- [x] Loaded the production-server debugging guidance.
- [ ] Inspected the VPS checkout read-only for tracked drift and history divergence (blocked: SSH authentication failed).
- [ ] Created backups and realigned the checkout after explicit approval.
- [ ] Verified the Git pull path and production health.

## Changes Made
- None yet. This is a Git metadata repair, not an application code change.

## Tests
- Attempted the prescribed read-only inspection over SSH to `<PROD_IP>` as the configured
  `prettyneat` account. Authentication was rejected before any command ran.
- Tested the available default SSH identity and the local `github-actions-deploy` identity
  against the two likely account names without password authentication. Both were rejected.

## Open Items / Notes
- Any production IP is redacted as `<PROD_IP>`.
- No VPS read or write occurred. The production checkout state, tracked drift, backup paths,
  Git pull result, container status, and public health are therefore unverified.
- Need a working SSH connection method or a refreshed authorized key before the mandatory
  read-only diagnosis can continue. Do not approve the reset until that diagnosis is complete.
