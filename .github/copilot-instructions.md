# Panino — Copilot Instructions

The canonical agent handbook for this repository is [`AGENTS.md`](../AGENTS.md). Read it
before starting any task, plus the layer file for the area you are working in:
[`frontend/AGENTS.md`](../frontend/AGENTS.md) or
[`backend/api-service/AGENTS.md`](../backend/api-service/AGENTS.md).

## Non-negotiables

- Every feature includes tests. A feature without tests is incomplete.
- Log substantive work under `docs/agent-logs/`; see `AGENTS.md` §1 for the threshold and
  template.
- Never construct SQL by string concatenation; always use parameterized queries.
- Never trust `req.body.userId` for authorization — use `req.user.user_id` from JWT middleware.
- Schema changes must be applied in both `frontend/src/store/syncStore.js` (`DB_SCHEMA`) and
  `backend/api-service/db.js` (`BASE_SCHEMA` + `CRR_TABLES`).
- Backend tests run via `npm run test:be` (Docker, Node 24). Host-native runs can fail on
  a different Node major with a native-binding ABI mismatch.

Reusable workflows live in [`.github/skills/`](skills/).
