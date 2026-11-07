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
limit (120/min, `API_RATE_LIMIT_PER_MINUTE`, in memory). Before any lookup, an address that
sent 30 rejected credentials in the last minute is refused (429); requests without a credential
are not counted, so OAuth discovery keeps working. The REST and MCP routes are add-on
`publicRoutes`: mounted before the JWT gate, so they authenticate themselves. Key and
connected-app management are session routes behind `requireAddon('ai')`, so a key cannot mint,
list or revoke credentials. Every other route already refuses these credentials because they are
not JWTs; `addons/ai/tests/integration/rest.test.js` asserts it for the sensitive ones.

All secrets are stored as SHA-256 only, in the auth database (`_users.db`), in tables the add-on
declares through `schema.auth`: `api_keys`, `ai_oauth_clients`, `ai_oauth_requests`,
`ai_oauth_codes`, `ai_oauth_grants`. Unknown, revoked, expired and orphaned credentials get one
answer.

## One implementation of each rule

Every v1 operation is a plain function over `{ userId, agent, clients }` in a `*Service.js` file,
one per area. The rules they share are in `serviceCore.js`: which databases an agent reaches, row
shapes, and the write rules (scope, live sessions, expected versions, size, revisions,
announcing). Each area has one adapter in `api/<area>.js` that exports its MCP tools, REST routes,
OpenAPI paths and next-step sentences. `api/index.js` lists the areas, and `mcpTools.js`,
`restRoutes.js` and `openapi.js` collect them.

To add an operation:
1. Write it in the area's service.
2. Expose it in that area's adapter: tool, route and path.
3. Add the tool to the per-area lists in `tests/unit/mcpTools.test.js`.

### How a write reaches devices

Writes go straight to the server replica with ordinary SQL in one better-sqlite3 transaction,
on a connection from `getHealthyDb()` (a cached handle whose sync bit a failed merge left set
would suppress the CRR triggers, and devices would never receive the change),
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

## What agents can do

The tool and route names below are the MCP and REST forms of the same operation.

**Documents** (`documentService.js`, `documentText.js`).
- Search and list:
  - Search needs every term to match; a "quoted phrase" counts as one term.
  - It can be limited to titles or bodies, a folder and its subfolders, or `updatedAfter`. It pages with `offset`.
  - Each hit has `matchCount` and up to three snippets with line numbers.
  - Lists sort by updated, created or title. Each cursor carries its sort.
- `get_document` returns metadata as well as the body:
  - `createdAt`, `pinned`, and word, character and line counts;
  - `revisionCount`, `imageIds` and `webUrl`;
  - `createdBy` and `modifiedBy`, and the front matter `properties`.
- Partial reads: lines `startLine`–`endLine`, or one `section` (a heading through to the next
  heading of the same or a higher level). `totalLines` and `range` let a model page through a long
  Document. `get_document_outline` lists the headings.
- Small writes:
  - `edit_document` replaces exact text and refuses with `EDIT_NO_MATCH` or `EDIT_AMBIGUOUS`.
  - `insert_into_document` inserts at the start, the end, or before or after a heading or at the
    end of its section.
  - Both follow the same write rules as `PATCH`.
- Slugs follow GitHub's rule, as proposed in `editor-toc-and-internal-links.md` §5.1.

**Properties** (`propertyService.js`, `propertyText.js`, `authorship.js`).
- Every Document has built-in properties: title, folder, word count (the app's rule), created
  on, created by, modified on, modified by, and pinned.
- Documents have no author columns. Revision history records who made each revision, so:
  - created by is the author of the oldest revision;
  - modified by is the author of the newest revision with an author;
  - both use the app's wording ("by Kris via Claude (API key)").
  - In the personal database the owner stands in when history says nothing (`inferred: true`).
  - History may have been pruned, so created by is the earliest recorded author.
- Front matter properties are the `key: value` lines at the top of the body, read with the shared
  parser (`shared/frontMatter.js`).
- `query_documents_by_property` (`GET properties/query?filter=`) takes a filter:
  - Conditions joined by `AND`, at most five, quotes respected.
  - Operators: `= != ~ ^= > < >= <=`, `exists` and `missing`. Comparisons ignore case; numbers
    compare as numbers and ISO dates as text.
  - Built-in names (`word_count`, `created_on`, `modified_on`, `created_by`, `modified_by`)
    override a front matter key of the same name.
  - Up to 5000 recently updated Documents per database are read, and only the first 16 KB of each
    body unless the filter needs the word count.
- `set_document_property` and `remove_document_property` are attributed, undoable edits of the
  front matter block.

**Folders and Trash** (`folderService.js`).
- Agents can read, rename, move and trash folders. A move into the folder itself or a descendant
  is refused (`FOLDER_CYCLE`).
- The Trash folder (the oldest top-level folder named Trash) is protected, and no other top-level
  folder may take that name (`TRASH_NAME_RESERVED`).
- `list_trash` and `restore_from_trash` work for Documents and folders. A restore goes to, in
  order:
  1. `folderId`, if given;
  2. where the API trashed it from, if that folder still exists outside Trash;
  3. the top level.
- Where an item was trashed from is kept in `ai_trash_origins`:
  - It is a server-only table in each content database, declared in the manifest's
    `schema.content`.
  - A row is written when the API trashes something, including an `update_document` move into
    Trash.
  - It is removed on restore, or on a move out of Trash.
  - Items the app trashed have no row.

**Revisions** (`revisionService.js`, `lineDiff.js`).
- `list_revisions` and `get_revision` (whole, or a line range) show who made each revision, in
  the app's wording. A person is named only when they are the owner or a current space member.
- `compare_revisions` is a unified Myers line diff. It is refused past 20000 lines or 2000 changed
  lines (`DIFF_TOO_LARGE`).
- `save_revision` saves a manual checkpoint; a duplicate of the newest revision is reported, not
  saved.
- `restore_revision` is shared with the app's restore route through core `restoreNoteRevision`:
  - It saves a `pre-restore` revision first and records an attributed after-revision.
  - It runs on a healthy connection, and is refused during a live session.
  - To undo it, restore the returned `preRestoreRevisionId`.

**Images** (`imageService.js`, core `image.js`).
- Images are listed, read and checked for usage per database.
- `get_image` returns MCP image content, except SVG, which comes back as an embedded text
  resource.
- Uploads go through core `storeImage`, the app's own upload path: allow-list, extension, 1 MB,
  quota, a UUID name in the database's upload root, sha256. The API also checks that the bytes are
  the declared type, which the app does not.
- The Markdown returned carries the API path prefix (`/api/images/<id>` in production), as the
  editor writes it.
- `delete_image` is permanent. It is refused with `IMAGE_IN_USE` while any Document references
  the image.

**Templates, variables and PDF** (`libraryService.js`, core `documentPdf.js`,
`shared/templateVariables.js`).
- `create_document_from_template` makes a Document exactly as "New from template" does, from the
  same shared code. It takes `inputs` for `{{input:Label}}` placeholders.
- `list_variables` returns one database's global variables.
- `export_pdf` builds the request the way Export does:
  - print style resolution, the shared renderer, global variables, and DOMPurify;
  - then `renderPdf`, with its own sanitizing, SSRF rules, queue and deadline.
  - A personal-only credential has space images removed first.
  - The request builder is core `documentPdf.js`, shared with the Odoo add-on, because add-ons
    may not import each other.
  - MCP returns an embedded `application/pdf` resource of up to 10 MB.

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
  (RFC 7591, no secret). One that was never approved and has not started a sign-in for 30
  days is pruned; one that was ever approved is kept, because the app holds its `client_id`.
- **Redirect URIs**: exact match, except loopback `http` on any port (RFC 8252). https, loopback
  http and private-use schemes only.
- **Flow**: `/oauth/authorize` validates and stores a 10-minute request, then sends the browser
  to the consent page `FRONTEND_URL/#/addons/ai/authorize?request=<id>` (an add-on page). The
  first signed-in user to open a request claims it. Approval creates the grant ("connected
  app": access and databases chosen by the user) and a 60-second single-use code bound to client,
  redirect URI, PKCE challenge and resource. A reused code ends the grant.
- **Code exchange**: every check (expiry, client, `redirect_uri` when sent, `resource`, PKCE)
  runs before the code is spent, so a client can retry a mistake; a spent code presented again
  ends the grant. `redirect_uri` may be omitted, as OAuth 2.1 allows, because PKCE binds the
  code. Approving at the 20-app limit (409 `APP_LIMIT`) leaves the request pending.
- **Tokens**: one live access token per grant; the refresh token rotates on every use, and a
  replayed old one ends the grant. `/oauth/revoke` (RFC 7009) and Disconnect in Settings end it
  too. Approving the same client again replaces its earlier grant.
- **Rate limit**: 60/min per address on the OAuth endpoints, keyed by nginx's `X-Real-IP`.

## Self-description

`GET /addons/ai/v1/openapi.json` (OpenAPI 3.1, `openapi.js`) and `GET /addons/ai/v1` describe the
REST API; a test calls every path in the OpenAPI document and fails if the router does not
answer it. MCP clients get the tool list and the server instructions instead.
