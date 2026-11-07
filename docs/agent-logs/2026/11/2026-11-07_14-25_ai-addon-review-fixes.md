# AI agents add-on: fixes from the pre-merge review

- Agent: Claude Code (Opus 5.5), review by a Fable subagent
- Start: 2026-11-07, 12:50
- Status: Fixed and tested on `feature/ai-addon`; not pushed, not merged

## Objective

Before `feature/ai-addon` goes to `main`, Kris asked for an independent code review of
everything not yet on `main` (API keys and v1, the revision label, the AI agents add-on with MCP
and OAuth). A Fable subagent reviewed `origin/main...feature/ai-addon` read-only. It found no
critical or high defects. Kris asked to fix every finding except the refusal of pre-2025 MCP
protocol versions (deliberate, spec decision D3), and to test the metadata fetch's SSRF refusal.

## Progress

Each finding was checked against the code before fixing. One did not hold: the review said the
Odoo add-on also writes Documents through an unchecked connection; it writes only its own
server-only tables outside its tests, so nothing changed there.

1. **Agent writes on a possibly poisoned connection** (medium). Writes used the cached handle
   from `getDb`/`getUserDb`; a cached handle whose CR-SQLite sync bit a failed merge left set
   suppresses the CRR triggers, so the write would never reach devices and the next device sync
   would overwrite it. All five write operations now use `getHealthyDb()` through
   `writableDb()`, and the live-session check reads through the same handle.
2. **Pruning approved self-registered clients** (low). A client whose grants were all revoked
   was pruned after 30 days, though the app still holds its `client_id` and cannot learn it is
   gone. Now only clients that were never approved are pruned, and starting a sign-in counts as
   use (`last_used_at`). Index on `ai_oauth_grants(client_id)` for the prune query.
3. **No limit before credential lookup** (low). An address that sends 30 rejected keys or
   tokens in a minute is now refused (429 `RATE_LIMITED`) on REST and MCP before any lookup.
   Requests with no credential are not counted (OAuth discovery depends on them). The limiter
   gained `check()` (no count); `clientAddress()` moved to `keyUtils.js` for both callers.
4. **Code spent before checks** (low). The code exchange now checks expiry, client,
   `redirect_uri`, `resource` and PKCE first, then spends the code with a conditional update; a
   lost race counts as a replay. `redirect_uri` may be omitted (OAuth 2.1; PKCE binds the code).
5. **App limit consumed the request** (low). The limit now throws inside the transaction, so
   the request stays pending and the same consent page can retry after a Disconnect. The message
   says where to disconnect.
6. **SSRF refusal untested** (low). The real fetcher is exported as `fetchClientMetadata` with a
   `lookup` seam and tested directly, and one integration test runs `/oauth/authorize` with the
   real fetcher against private addresses.

## Changes Made

- `backend/api-service/addons/ai/`: `documentService.js`, `agentAuth.js`, `keyUtils.js`,
  `oauth.js`, `oauthClients.js`, `schema.js`.
- Tests: `tests/integration/rest.test.js` (sync bit, invalid-key limit on REST and MCP),
  `tests/integration/oauth.test.js` (retry after a bad exchange, omitted `redirect_uri`, app
  limit, pruning, real fetcher), `tests/unit/keyUtils.test.js` (`check`, `clientAddress`), new
  `tests/unit/oauthClients.test.js` (private literals, private DNS answers, http, credentials).
- Docs: `docs/architecture/public-api.md`, `docs/specs/active/ai-integration.md`.

## Tests

- The sync-bit test fails with the old `getDb` handle and passes with the fix.
- `./scripts/test-backend.sh addons/ai`: 8 files, 199 passed.
- `npm run test:be`: 62 files, 939 passed. `npm run test:fe`: 89 files, 1087 passed.
  `npm run lint`: clean.
- No browser check: the only user-visible change is the 409 message text on the consent page,
  which already renders server messages.

## Open Items / Notes

- Not checked against the running dev stack (the API container runs the old code until it is
  restarted).
- The redirect refusal in the metadata fetch (no redirects followed) is not covered by a test;
  it needs an https server on a public address. `safeRequest` never follows redirects.
- Production release steps are unchanged: see the 2026-11-06 log.
