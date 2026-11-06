# Public API (v1) and API keys

The v1 API lets an LLM or a script read and write a user's Documents with a personal API key.
It is served at `/v1/*` by the API service, which production exposes as
`https://panino.sh/api/v1/*` through the existing `/api/` proxy (no Nginx change). Intent and
decisions: [`docs/specs/active/llm-api.md`](../specs/active/llm-api.md).

## Two authentication paths that never overlap

| Path | Credential | Accepted by |
|---|---|---|
| Session | 7-day JWT (`authenticateToken`, `auth.js`) | Every route except `/v1` |
| API key | `pnk_…` (`authenticateApiKey`, `apiKeys.js`) | `/v1` only |

`index.js` mounts `app.use('/v1', publicApiRoutes)` **before** the global JWT gate, and the
router installs `authenticateApiKey` itself (only `GET /v1/openapi.json` is public). A key is
not a JWT, so every other route already refuses it; `tests/integration/publicApi.test.js`
asserts this for `/sync`, `/refresh`, `/me`, `/me/password`, `/api-keys`, `/spaces`,
`/addons`, `/images` and `/space-transfers`. Conversely `/v1` refuses session JWTs. Key
management (`GET/POST/DELETE /api-keys`) sits behind the JWT gate, so a key cannot mint,
list or revoke keys.

When adding a v1 endpoint, do not reach for an existing route's handler; reimplement the
narrow operation here. When adding any other route, nothing is needed: it is session-only by
construction.

## Keys

- Table `api_keys` in the auth database (`_users.db`, not synced), declared in
  `AUTH_SCHEMA` in `db.js`, `ON DELETE CASCADE` from `users`.
- The key is `pnk_` + 32 random bytes (base64url). Only its SHA-256 (`token_hash`) and the
  first 12 characters (`prefix`, display only) are stored. Lookup is by hash.
- `scope` is `read` or `write` (write implies read). `space_access` is `all` (personal plus
  every space the user is a member of at request time) or `personal`.
- Unknown, revoked, expired and orphaned keys get one answer: `401 INVALID_API_KEY`.
- Header only (`Authorization: Bearer`); the `?token=` fallback of the session path is not
  offered, because query strings land in proxy logs.
- At most 10 unrevoked keys per account. Revoked rows are kept 30 days, pruned when the user
  next creates a key.
- 120 requests per minute per key (`API_RATE_LIMIT_PER_MINUTE`), in-process fixed window;
  `last_used_at` is written at most once a minute per key. Both reset on restart.

## How a v1 write reaches devices

Writes go straight to the server replica with ordinary SQL in one better-sqlite3
transaction, the same pattern revision restore and space transfers use. CR-SQLite's triggers
record them under the server's site id, so the next `/sync` pull hands them to every device
as another replica's change. After commit the handler pokes the user's sockets (personal) or
the space's subscribers (`excludeSiteId = null`) and runs the add-ons' `afterChangesApplied`
hook, as `/sync` does. A device with an unsent edit to the same Document treats the API write
as a concurrent remote change; the existing merge-base and conflict rules apply unchanged.

Rules every write follows (`publicApi.js`):

- **Live sessions.** A space Document with a `collab_sessions` row is refused with
  `409 DOCUMENT_IN_LIVE_SESSION`, because the session holds text not yet in `notes.content`.
- **Revisions.** A title or body change snapshots the stored body first (unattributed,
  skipped when it equals the latest revision), then the new body with `actor_kind = 'api'`
  and the key owner as `actor_user_id`. `'api'` is in `ACTOR_KINDS` in `revision.js`; the
  revision panel shows "via API".
- **Concurrency.** Optional `expectedUpdatedAt` is compared as the exact stored string.
- **Size.** A body over 2 MiB after the write is `413`.
- **`user_id`.** Set to the owner in the personal database, left `NULL` in a space, matching
  the app.

## Delete is a move

`DELETE /v1/documents/:id` moves the Document into the database's Trash folder: the oldest
root folder named `Trash` (any case), created on first use. Nothing is removed, because a
real delete cascades the Document's revision history away. Search and list leave out
Documents under Trash unless `includeTrash=true`. Folders cannot be deleted through the API.

## Finding a Document

Reads and writes of an existing Document may omit `space`; `locateDocument` tries the
personal database and then each reachable space. `space=all` (the default for `/search` and
`/documents`) fans out the same way. Space membership is resolved through
`resolveSpaceAccess` / `listSpacesForUser` on every request, so removal from a space cuts a
key off at once; a space the key cannot reach and one that does not exist both answer
`404 SPACE_NOT_FOUND`.

Search is `instr(lower(…), lower(?))` over title and body: case-insensitive for ASCII, and
`%`/`_` are literal. It scans bodies; that is fine at today's sizes (thousands of Documents
per database) and is the first thing to revisit (FTS5) if a database grows far beyond that.

## Self-description

`GET /v1/openapi.json` (OpenAPI 3.1, `publicApiSpec.js`) and `GET /v1` (a usage note for
LLMs) describe the API. A test calls every path in the OpenAPI document and fails if the
router does not answer it, so the two cannot drift silently in that direction; new fields
still have to be added to the description by hand.
