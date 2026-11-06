# AI agents add-on: API keys, REST, MCP and OAuth

Outside agents (LLM assistants, scripts) read and write a user's Documents through the **AI
agents** add-on (`id: ai`, `backend/api-service/addons/ai/`, `frontend/src/addons/ai/`). The
operator offers it with `AI_ADDON_ENABLED=true`; each user switches it on in Settings →
Add-ons. Intent and decisions: [`docs/specs/active/ai-integration.md`](../specs/active/ai-integration.md)
and, for the v1 rules, [`docs/specs/active/llm-api.md`](../specs/active/llm-api.md).

| Surface | URL (production) | Credential |
|---|---|---|
| REST v1 | `https://panino.sh/api/addons/ai/v1/*` | API key |
| MCP | `https://panino.sh/api/addons/ai/v1/mcp` | API key or OAuth access token |
| OAuth | `https://panino.sh/api/addons/ai/oauth/*` | the protocol's own proofs |
| Discovery | `https://panino.sh/.well-known/oauth-*` | none (nginx proxies these two names) |

## Credentials that never overlap

| Credential | Shape | Accepted by |
|---|---|---|
| Session | 7-day JWT (`authenticateToken`) | every route except the add-on's REST/MCP |
| API key | `pnk_…` (`keys.js`) | REST and MCP |
| OAuth access token | `pna_…`, 1 hour (`oauth.js`) | MCP only (its audience) |
| OAuth refresh token | `pnr_…`, 30 days, rotated | the token endpoint only |

`agentAuth.js` resolves keys and access tokens, then requires `isAddonActive(owner, 'ai')`
(403 `ADDON_DISABLED` otherwise; nothing is deleted), then applies the per-credential rate
limit (120/min, `API_RATE_LIMIT_PER_MINUTE`, in memory). The REST and MCP routes are add-on
`publicRoutes`: mounted before the JWT gate, so they authenticate themselves. Key and
connected-app management are session routes behind `requireAddon('ai')`, so a key cannot mint,
list or revoke credentials. Every other route already refuses these credentials because they are
not JWTs; `addons/ai/tests/integration/rest.test.js` asserts it for the sensitive ones.

All secrets are stored as SHA-256 only, in the auth database (`_users.db`), in tables the add-on
declares through `schema.auth`: `api_keys`, `ai_oauth_clients`, `ai_oauth_requests`,
`ai_oauth_codes`, `ai_oauth_grants`. Unknown, revoked, expired and orphaned credentials get one
answer.

## One implementation of each rule

`documentService.js` holds every v1 operation as a plain function over
`{ userId, agent, clients }`; `restRoutes.js` and `mcpTools.js` are thin adapters. When adding
an operation, add it there and expose it in both (and in `openapi.js`).

### How a write reaches devices

Writes go straight to the server replica with ordinary SQL in one better-sqlite3 transaction,
the same pattern revision restore and space transfers use. CR-SQLite's triggers record them
under the server's site id, so the next `/sync` pull hands them to every device as another
replica's change. After commit the service pokes the user's sockets (personal) or the space's
subscribers (`excludeSiteId = null`) and runs the add-ons' `afterChangesApplied` hook, as
`/sync` does. A device with an unsent edit to the same Document treats the write as a
concurrent remote change; the existing merge-base and conflict rules apply unchanged.

- **Live sessions.** A space Document with a `collab_sessions` row is refused (`409
  DOCUMENT_IN_LIVE_SESSION`), because the session holds text not yet in `notes.content`.
- **Revisions.** A title or body change snapshots the stored body first (unattributed, skipped
  when it equals the latest revision), then the new body attributed to the owner:
  `actor_kind = 'api'` for a key, `'app'` for a connected app, and the key's or app's name in
  `actor_label` (backend-only column, kept after the credential is gone). The revision panel
  shows "via <name> (API key)" / "via <name> (connected app)", and plain "via API" for rows
  written before the label existed. In a space every member sees the name.
- **Concurrency.** Optional `expectedUpdatedAt` is compared as the exact stored string.
- **Size.** A body over 2 MiB after the write is refused (413).
- **Delete is a move** into the oldest root folder named `Trash` (any case), created on first
  use, because a real delete cascades revision history away. Search and list leave Trash out
  unless asked. Folders cannot be deleted through the API.
- **Finding a Document.** An existing Document may be addressed without `space`; the service
  tries the personal database and then each reachable space. Space membership is resolved on
  every request, so removal from a space cuts access at once. Search is `instr(lower(…))` over
  title and body; revisit with FTS5 if databases grow far beyond thousands of Documents.

Key names are unique among a user's live keys (case-insensitive) so history can tell them
apart; at most 10 live keys and 20 connected apps per user.

## MCP

`mcp.js` is a hand-written, stateless Streamable HTTP server: one JSON-RPC message per POST,
JSON responses only, no SSE, no sessions issued, `GET`/`DELETE` 405, batches refused,
notifications 202. It serves two protocol eras from one handler:

- **2025** (`2025-06-18`, `2025-11-25`): recognised by `initialize` or the absence of
  `_meta["io.modelcontextprotocol/protocolVersion"]`. `initialize` negotiates the version and
  returns capabilities, server info and instructions.
- **2026** (`2026-07-28`): recognised by that `_meta` key. Every request is checked for its
  client capabilities and for `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers that
  match the body (`-32020`); `server/discover` is answered; results carry `resultType`.

Supported revisions are constants at the top of `mcp.js`; a new revision is a constant plus
tests. Authentication runs before anything else so an unauthenticated `initialize` gets the
`401` with `WWW-Authenticate: Bearer resource_metadata="…"` that starts an OAuth client's
sign-in. A browser `Origin` other than the app's is refused (403).

Tools (`mcpTools.js`) map one-to-one to v1 operations. Their input schemas use only a portable
subset of JSON Schema (object of string/integer/boolean properties with descriptions; no unions,
`null`, `$ref`, `format`, `additionalProperties`), which `tests/unit/mcpTools.test.js` enforces,
because function-calling support differs between model families. Results are a text block
written for a model plus `structuredContent`; rule failures are `isError` results that say what
to do next. A read-only credential's `tools/list` omits the write tools.

## OAuth

Panino is both authorization server (issuer: the origin of `PUBLIC_API_BASE_URL`) and resource
server (the MCP URL). `config.js` derives every URL from `PUBLIC_API_BASE_URL` and
`FRONTEND_URL`, never from a request's `Host`; in production both are required (503 and a
startup warning otherwise).

- **Discovery**: protected-resource metadata (RFC 9728) at the root and at the resource path;
  authorization-server metadata (RFC 8414) advertising S256 PKCE, public clients
  (`token_endpoint_auth_methods_supported: ["none"]`), Client ID Metadata Documents and the
  `iss` response parameter.
- **Clients**: a `client_id` that is an `https` URL is a metadata document, fetched through
  `safeFetch.js` (public addresses only, 5 s, 16 KiB, no redirects) and cached per
  `Cache-Control` within 5 minutes .. 24 hours; otherwise a client that registered itself
  (RFC 7591, no secret, pruned after 30 days without a grant).
- **Redirect URIs**: exact match, except loopback `http` on any port (RFC 8252). https, loopback
  http and private-use schemes only.
- **Flow**: `/oauth/authorize` validates and stores a 10-minute request, then sends the browser
  to the consent page `FRONTEND_URL/#/addons/ai/authorize?request=<id>` (an add-on page). The
  first signed-in user to open a request claims it. Approval creates the grant ("connected
  app": access and databases chosen by the user) and a 60-second single-use code bound to client,
  redirect URI, PKCE challenge and resource. A reused code ends the grant.
- **Tokens**: one live access token per grant; the refresh token rotates on every use, and a
  replayed old one ends the grant. `/oauth/revoke` (RFC 7009) and Disconnect in Settings end it
  too. Approving the same client again replaces its earlier grant.
- **Rate limit**: 60/min per address on the OAuth endpoints, keyed by nginx's `X-Real-IP`.

## Self-description

`GET /addons/ai/v1/openapi.json` (OpenAPI 3.1, `openapi.js`) and `GET /addons/ai/v1` describe the
REST API; a test calls every path in the OpenAPI document and fails if the router does not
answer it. MCP clients get the tool list and the server instructions instead.
