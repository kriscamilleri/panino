# AI agents add-on: MCP server, OAuth, and the move of API keys and v1

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-06, 13:30
- Status: Implemented and verified locally on `feature/ai-addon`; not merged, not deployed

## Objective

Kris asked for an MCP server that works with any agent, not only Claude ("Claude, Sol,
Deepseek 4.1, etc."). Decisions in the conversation (2026-11-06): OAuth sign-in in this version
as well as the key header, and, because the scope grew and it is a third-party integration,
**the whole feature becomes an optional AI add-on**, including the API keys and v1 REST API
already on `develop`. Real-client testing approved for Claude Code and Gemini CLI.

## Progress

- Researched the current MCP revisions: 2026-07-28 is stateless (version and capabilities in
  every request's `_meta`, `server/discover`, header checks); 2025-06-18 / 2025-11-25 clients
  still use `initialize`. The server serves both eras from one handler. Read the 2026 and
  2025-11-25 authorization pages, the Claude connector docs and OpenAI's Apps SDK auth page for
  OAuth: Client ID Metadata Documents preferred, DCR as fallback, PKCE S256, `iss` in responses,
  `resource` audience. The official SDK was not used (it brings Express 5, Hono and a dozen
  packages into an Express 4 backend); the stateless JSON subset is small and pinned by tests.
- Spec `docs/specs/active/ai-integration.md` written, approved ("Build it as specced").
- Built: core extension points `schema.auth` and `wellKnown`; the move into `addons/ai/` with
  the v1 logic extracted into `documentService.js` (REST and MCP are thin adapters; the 46 moved
  REST tests passed unchanged apart from URLs); MCP; OAuth; the settings card and consent page.
- Changed while building, recorded in the spec: the public URLs come from the existing
  `PUBLIC_API_BASE_URL` / `FRONTEND_URL` rather than new variables; private-use redirect
  schemes need not contain a dot (Cursor uses `cursor://`); the OAuth rate limit keys on
  nginx's `X-Real-IP`, because behind nginx every request comes from 127.0.0.1.
- Browser check found nothing to fix in the product. Two harness traps: Chrome served a stale
  `registry.js` until a reload; the core `AddonCard` replaces a card root's `data-testid` with
  `settings-addon-<id>`, so a Puppeteer wait on the card's own id timed out.

## Changes Made

- Core: `addons/registry.js` (`wellKnown`, `mountAddonWellKnown`), `db.js` (`schema.auth`;
  `api_keys` moved out of `AUTH_SCHEMA`), `index.js` (no core `/v1`), `revision.js` (`'app'`
  actor kind), `RevisionPanel.vue` ("via <name> (connected app)"), `SettingsPage.vue` and
  `PhoneSettingsPage.vue` (old API keys section and row removed), `nginx.conf.template`
  (`/.well-known/oauth-*`), compose files (`AI_ADDON_ENABLED`, `API_RATE_LIMIT_PER_MINUTE`).
- Backend add-on `backend/api-service/addons/ai/`: `config.js`, `schema.js`, `routes.js`,
  `documentService.js`, `restRoutes.js`, `openapi.js`, `agentAuth.js`, `keys.js`, `keyUtils.js`,
  `mcp.js`, `mcpTools.js`, `oauth.js`, `oauthClients.js`, `oauthUtils.js`, `README.md`.
- Frontend add-on `frontend/src/addons/ai/`: `manifest.js`, `store.js`, `AiSettingsCard.vue`,
  `McpSetup.vue`, `ConnectedApps.vue`, `ApiKeysSection.vue`, `AuthorizePage.vue`,
  `utils/apiKeys.js`, `utils/mcpSetup.js`, `README.md`.
- Docs: `docs/architecture/public-api.md` rewritten for the add-on; pointers in
  `auth-and-jwt.md`, `data-model.md`, architecture `README.md`, `addon-folders.md` (§5.1–5.3),
  `llm-api.md` header, `backend/api-service/AGENTS.md`, `frontend/AGENTS.md`.

## Tests

- `npm run test:be` (Docker): 61 files, 920 passed. New in the add-on: `oauthUtils.test.js`
  (35), `mcpTools.test.js` (15, including the portable-schema check on every tool),
  `addon.test.js` (gate walk over every session route, 404 on every public and well-known path
  while not offered, keys refused while switched off), `mcp.test.js` (19: both eras, header
  checks, unsupported version, 405, batches, Origin, tools, error mapping, read-only list),
  `oauth.test.js` (17: discovery, metadata-document and DCR clients, PKCE, code reuse and
  expiry, refresh rotation and replay, consent claimed by one user, deny, revoke, reconnect).
  Core `addonsRegistry.test.js` covers `schema.auth` and `wellKnown`.
- `npm run test:fe`: 89 files, 1087 passed (`src/addons/ai/tests/`: keys, setup snippets,
  connected apps, settings card, consent page).
- `npm run lint`: clean. Build: the add-on's components in their own chunks.
- Removal check (both registry lines commented out, then restored): backend core 35 files /
  552 passed, frontend core 77 files / 928 passed, lint clean, build fine.
- Dev stack (`AI_ADDON_ENABLED=true`, spaces on), local test account `user-A`:
  - **Claude Code** (`claude -p --strict-mcp-config --mcp-config <scratch file>`, key header):
    called `search_documents`, `get_document`, `append_to_document`; the append landed with
    `expected_updated_at`.
  - **Gemini CLI**: not verified. It hangs with no output even on a plain prompt with no MCP
    server configured, so the CLI itself is stuck on this machine (most likely its own Google
    sign-in); the Panino server was never contacted. A first attempt with
    `--approval-mode yolo` was refused by the session's safety check (auto-approves every tool,
    shell included); the retry trusted only the panino server.
  - **OAuth, real browser**: a scripted public client registered itself, started sign-in with
    PKCE, Chrome showed the consent page (self-registered warning, loopback return), Connect
    sent the browser to a one-shot loopback listener with `code`, `state` and `iss`; the code
    exchange returned `pna_`/`pnr_` tokens with `documents:read documents:write`; MCP
    `initialize` (2025-11-25), `tools/list` (11) and an append worked with the access token.
  - Revision history showed "via Scripted MCP client (connected app)" and "via Claude Code
    (API key)" on the matching rows. Settings showed the MCP setup, the connected app and the
    keys. No console errors.
  - Phone (headless Puppeteer, 375×812): settings card and consent page, 0 px horizontal
    overflow; the only error was `/spaces` 404 before spaces were switched back on (below).
  - All test keys revoked and the test app disconnected afterwards.

## Open Items / Notes

- Not merged, not deployed. Production needs `AI_ADDON_ENABLED=true`, `PUBLIC_API_BASE_URL`
  and `FRONTEND_URL` set, and the nginx change; run the deploy pre-flight; live sessions are on
  in production, so the restart interrupts them.
- claude.ai, Claude Desktop and ChatGPT connectors need the public HTTPS URL; check them after
  release. A non-Claude client is still unverified end to end (Gemini CLI blocked locally).
- Recreating the dev API container to pick up `AI_ADDON_ENABLED` reset `SHARED_SPACES_ENABLED`
  to the compose default; it was recreated again with it on (live sessions stay off, as before).
- In-memory state (rate limits, last-used throttles, the metadata-document cache) resets on
  restart and is per process.
- Local dev data left in place: the test account, its space, the Documents and folders written
  during the checks, one self-registered OAuth client (`backend/api-service/data/`, untracked).
