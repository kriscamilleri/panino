# AI agents add-on (backend)

Lets outside AI agents and scripts read and write a user's Documents: personal API keys, the v1
REST API, an MCP server, and OAuth 2.1 sign-in for MCP clients ("connected apps"). Offered with
`AI_ADDON_ENABLED=true`; each user switches it on. While a user's switch is off, every key and
connected app of theirs is refused (403 `ADDON_DISABLED`) and nothing is deleted.

- Spec: [`docs/specs/active/ai-integration.md`](../../../../docs/specs/active/ai-integration.md)
  (keys and v1 rules: [`llm-api.md`](../../../../docs/specs/active/llm-api.md))
- How it works: [`docs/architecture/public-api.md`](../../../../docs/architecture/public-api.md)

## Manifest fields used

`routes` (session, gated), `publicRoutes` (REST, MCP and OAuth endpoints, each authenticating
itself), `wellKnown` (`oauth-protected-resource`, `oauth-authorization-server`), `schema.auth`
(tables on the auth database), `configWarnings`. No hooks, no background jobs.

## URLs

| | Path (production adds `/api`) | Credential |
|---|---|---|
| REST | `/addons/ai/v1/*`, `GET /addons/ai/v1/openapi.json` | API key |
| MCP | `POST /addons/ai/v1/mcp` | API key or OAuth access token |
| OAuth | `/addons/ai/oauth/{authorize,token,register,revoke}` | OAuth protocol |
| Discovery | `/.well-known/oauth-protected-resource[/…]`, `/.well-known/oauth-authorization-server` | none |
| Settings | `/addons/ai/{setup,keys,connections}`, `/addons/ai/oauth/requests/:id[/approve\|/deny]` | session |

Public URLs come from `PUBLIC_API_BASE_URL` and `FRONTEND_URL` (required in production; OAuth
answers 503 without them).

## Files

| File | Contents |
|---|---|
| `index.js` | Manifest and registration |
| `config.js` | Offered flag and every public URL |
| `schema.js` | `api_keys`, `ai_oauth_clients`, `ai_oauth_requests`, `ai_oauth_grants`, `ai_oauth_codes` |
| `routes.js` | Composes the public and session routers |
| `documentService.js` | The v1 operations as plain functions: every rule (scope, space reach, live sessions, Trash, revisions, size) |
| `restRoutes.js`, `openapi.js` | REST adapter and its OpenAPI description |
| `mcp.js`, `mcpTools.js` | MCP protocol layer (2025 and 2026 revisions, stateless) and the tools |
| `agentAuth.js` | Resolves `pnk_` keys and `pna_` tokens, checks the switch, rate limit |
| `keys.js`, `keyUtils.js` | Key management routes and lookup; pure helpers |
| `oauth.js`, `oauthClients.js`, `oauthUtils.js` | Authorization server, client resolution (metadata documents through `safeFetch.js`, DCR), pure helpers |
| `tests/` | `unit/` (helpers, tool schemas), `integration/` (gate, REST, MCP, OAuth), `aiTestSetup.js` |
