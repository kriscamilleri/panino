# LLM API — API keys and the v1 Document API — Spec

> Let a user create API keys that an LLM (or any script) uses to read and write their Documents
> and the spaces they belong to, through a small, purpose-built REST API.
> Status: active (implemented 2026-11-06 on `feature/llm-api-keys`; moved into the AI agents
> add-on on `feature/ai-addon`)
> Created: 2026-11-06
> Last updated: 2026-11-06 — the whole feature is now the optional AI agents add-on
> ([`ai-integration.md`](ai-integration.md)). The rules below are unchanged; the URLs moved:
> `/v1/*` is `/addons/ai/v1/*` (production `https://panino.sh/api/addons/ai/v1/*`) and
> `/api-keys` is `/addons/ai/keys`. Read paths in this spec with that prefix.
> Implementation: `backend/api-service/addons/ai/` (`documentService.js`, `restRoutes.js`,
> `keys.js`, `keyUtils.js`, `openapi.js`); `frontend/src/addons/ai/`; maintainer notes in
> [`docs/architecture/public-api.md`](../../architecture/public-api.md)

---

## 1) Summary

Panino has no REST API for content today. Documents and folders only move through `/sync`,
which exchanges CR-SQLite change sets (`table, pk, cid, val, col_version, db_version, site_id,
cl, seq`). That contract is correct for replicas and hopeless for an LLM: writing a Document
means fabricating clock metadata, and a mistake can corrupt the replica every device merges
from.

This spec adds two things:

1. **API keys.** A signed-in user creates named keys in Settings. A key is shown once, stored
   only as a hash, can be read-only or read-write, can expire, and can be revoked at any time.
2. **The v1 API** (`/v1/*`, served at `https://panino.sh/api/v1/*`). A handful of
   Document-shaped endpoints — list, search, tree, read, create, update, append, folders — that
   the server translates into ordinary CRR writes. Devices pick the change up on their next
   sync exactly as if another device had made it.

API keys work **only** on `/v1`. Every existing route stays session-only.

---

## 2) Goals

1. A user can create, see and revoke API keys from Settings, on desktop and phone.
2. An LLM holding a key can, in one request each: find Documents by title or text across all
   the user's databases, read a Document as Markdown, see the folder tree, create a Document,
   replace or append to a Document, and create a folder.
3. Shared spaces the user is a member of are reachable with the same key, with membership
   re-checked on every request.
4. Writes are safe for the people and devices already using the Document: every API write is
   recoverable from revision history, optimistic concurrency is available, and Documents open
   in a live session are not overwritten underneath their participants.
5. The API describes itself (`GET /v1/openapi.json`) so tool frameworks and LLMs can load it
   without hand-written docs.

### Non-goals

- Exposing the existing app routes to API keys (see §4 for why).
- Permanently deleting Documents or folders through the API. `DELETE` is a soft delete into
  a Trash folder (see §6, decision D1).
- OAuth / third-party app authorization. Keys are personal tokens for the user's own tools.
- An MCP server in v1. The REST API plus OpenAPI is the foundation; an MCP wrapper is a
  thin follow-up (§12).
- Images, PDF export, templates, styles, global variables via the API.

---

## 3) User journeys

| # | Persona | Journey | Acceptance criteria |
|---|---|---|---|
| U1 | Kris, desktop | Settings → API keys → **Create key**, name "Claude Code", access "Read & write", expiry 90 days | The key is shown once with a copy button and a ready-to-run `curl` example; the list then shows name, `pnk_xxxxxxxx…` prefix, access, created, last used "Never", expiry. The full key is never shown again |
| U2 | LLM agent | `GET /v1/search?q=invoice` with the key | Gets matches from the personal database and every space, each with id, title, space, folder path, updated time and a snippet |
| U3 | LLM agent | `GET /v1/documents/:id` (or `Accept: text/markdown`) | Gets the Markdown body and metadata |
| U4 | LLM agent | `POST /v1/documents` `{title, content, folderId}` | The Document appears in the sidebar of an open browser within seconds (WebSocket poke) without a reload |
| U5 | LLM agent | `PATCH /v1/documents/:id` with a stale `expectedUpdatedAt` | `409 VERSION_CONFLICT`, nothing written |
| U6 | Kris | After an LLM replaced a Document's body | Revision history shows the pre-write body and the API write, attributed "by Kris via <key name> (API key)" |
| U7 | LLM agent | Read-only key tries `POST /v1/documents` | `403 INSUFFICIENT_SCOPE` |
| U8 | Kris | Revokes the key | The next request with it is `401`, immediately |
| U9 | LLM agent | Uses the key on `/sync`, `/me/password`, `/spaces/:id/invitations` … | `401`/`403`; API keys are not sessions |
| U10 | LLM agent | Writes to a space Document open in a live session | `409 DOCUMENT_IN_LIVE_SESSION`, nothing written |
| U11 | Kris, phone | Settings → API keys | Same list, create and revoke as desktop |

---

## 4) Is it safe to expose every endpoint? — No

Every existing route was evaluated. The conclusion is that API keys get their own namespace and
no existing route accepts them. The reasons, by group:

| Route group | Expose to API keys? | Why |
|---|---|---|
| `/sync` | **No** | Raw CRDT change sets. A wrong `col_version`, `cl` or `site_id` silently loses data on every device or leaves clock-table corruption (see `crsqlite-sync.md`, "Deletes and tombstones"). The v1 write endpoints replace it for LLM use |
| `/login`, `/refresh`, `/me/password`, email verification | **No** | A leaked key must not become a session: `/refresh` would mint a 7-day JWT, the password route would allow account takeover |
| API key management (new) | **No** | A key cannot create, list or revoke keys; a leaked key could otherwise persist itself |
| `/spaces/*` lifecycle (invite, remove member, transfer ownership, leave, delete) | **No** | Changes who can see a space, sends email to third parties, and can delete a space. Read-only "which spaces can I reach" is offered as `GET /v1/spaces` instead |
| `/space-invitations/*` | **No** | Accepting an invitation changes the account's memberships |
| `/space-transfers/*` | **No** | A move deletes the source Document |
| `/addons/*` (switches, GitHub OAuth, Odoo credentials, sends to Odoo) | **No** | Holds third-party credentials and pushes data out of Panino to other systems |
| `/images` upload, delete, bulk delete | **No** (v1) | Delete is destructive; upload is plausible later but not needed for text workflows |
| `/images/:id` read, `/render-pdf` | Not in v1 | Safe in principle (same authorization as today), but no LLM use case yet; easy to add behind `read` scope later |
| `/notes/:id/revisions` read | Not in v1 | Plausible later (`read` scope) |
| `/notes/:id/revisions/:id/restore` | **No** | Overwrites a Document from history; the user does this in the UI |

How this is enforced: the existing `authenticateToken` only accepts JWTs, and a `pnk_` key is
not a JWT, so every existing route already rejects keys (`403 Forbidden: Invalid token`). The
API-key middleware is mounted on the `/v1` router only. A test asserts that a valid key is
refused by a representative route from each group above.

The reverse also holds: `/v1` accepts **only** API keys, not session JWTs, so the browser app
never depends on it and the two auth paths cannot be confused.

---

## 5) API keys

### 5.1 Format and storage

- Key: `pnk_` + 32 random bytes as base64url (43 characters), e.g. `pnk_Q2xh…`. The prefix
  makes leaked keys easy to recognize and to add to secret scanners.
- Stored in the **auth database** (`data/_users.db`, not synced) as the SHA-256 hash of the
  full key. A 256-bit random secret does not need a slow hash; lookup is by hash, so no
  timing-sensitive comparison of the secret happens in application code.
- The first 12 characters (`pnk_` + 8) are kept in clear as `prefix` for display.

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,          -- UUID, the management id
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,                    -- 1..60 chars, user-chosen label
  prefix TEXT NOT NULL,                  -- 'pnk_' + 8 chars, display only
  token_hash TEXT NOT NULL UNIQUE,       -- hex SHA-256 of the full key
  scope TEXT NOT NULL,                   -- 'read' | 'write'
  space_access TEXT NOT NULL DEFAULT 'all', -- 'all' | 'personal' (see D2)
  created_at TEXT NOT NULL,
  expires_at TEXT,                       -- NULL = never
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
```

`write` implies `read`.

### 5.2 Management routes (session JWT only)

| Route | Purpose |
|---|---|
| `GET /api-keys` | List the caller's keys that are not revoked: id, name, prefix, scope, spaceAccess, createdAt, expiresAt, lastUsedAt, expired flag. Never the hash |
| `POST /api-keys` `{name, scope, spaceAccess, expiresInDays}` | Create. `expiresInDays` ∈ {30, 90, 365, null}. Returns the key metadata **and the full key, once** |
| `DELETE /api-keys/:id` | Revoke (sets `revoked_at`). Only the caller's own key; another user's id is a plain 404 |

Limits: at most **10** active keys per account (`409 API_KEY_LIMIT`). Revoked keys are kept
for 30 days for audit, then deleted by the existing maintenance pass.

### 5.3 Authenticating a `/v1` request

- `Authorization: Bearer pnk_…` only. **No `?token=` query parameter**: query strings end up in
  proxy logs and browser history.
- The middleware hashes the key, looks up the row, and refuses (`401 INVALID_API_KEY`, one
  message for every case) a key that is unknown, revoked or expired, or whose user no longer
  exists.
- It sets `req.user = { user_id }` and `req.apiKey = { id, name, scope, spaceAccess }`.
  Handlers authorize from these, never from the body.
- `last_used_at` is written at most once a minute per key.
- Rate limit: **120 requests per minute per key**, in memory, `429` with `Retry-After`. The
  limit protects the single-process server from a looping agent.
- Keys are never logged. Errors are fixed messages with a stable `code`.

### 5.4 Settings UI

Desktop **Settings → API keys** (a section below Tools) and phone **Settings → API keys**
(a row that opens a sheet):

- List: name, prefix, access ("Read only" / "Read & write"), spaces ("All" / "Personal
  only"), created, last used, expires (or "Expired").
- **Create key** form: name, access, spaces, expiry (30 days, 90 days *(default)*, 1 year,
  never).
- After creation: the key in a monospace field with **Copy**, the sentence "This is the only
  time the key is shown", and a copyable `curl` example using the real base URL. Leaving
  Settings forgets the secret.
- Phone Settings has an **API keys** row under Account that opens the same section
  (`/settings/account#api-keys`).
- **Revoke** asks once: "Revoke "Claude Code"? Anything using it stops working immediately."

---

## 6) Decisions

| # | Question | Proposed decision |
|---|---|---|
| D1 | Deleting via the API | **Soft delete only** (Kris, 2026-11-06). `DELETE /v1/documents/:id` moves the Document into a root folder named **Trash** in the same database, creating it if needed. A real delete cascades revision history away (`note_revisions … ON DELETE CASCADE`), so it stays a UI action. Emptying the Trash is done by the user in the app |
| D2 | Which databases a key reaches | Per key: **all** (personal + every space the user is a member of, now and later) or **personal only** (Kris, 2026-11-06). Membership is checked on every request, so leaving a space removes the key's access to it |
| D3 | Scopes | `read` and `write`. Nothing finer in v1 |
| D4 | Where revisions are attributed | New backend-only `actor_kind = 'api'` with the key owner as `actor_user_id` and the key's name in `actor_label`; the revision panel shows "via <key name> (API key)" next to the author. Refined 2026-11-06 at Kris's request so separate keys per service can be told apart; key names are unique among a user's active keys |
| D5 | MCP | Follow-up branch (Kris, 2026-11-06); v1 ships REST + OpenAPI |
| D6 | Expiry default | 90 days, with "never" available |

---

## 7) The v1 API

Base: `https://panino.sh/api/v1` (dev: `http://localhost:8000/v1`). JSON in and out. Every
error is `{ "error": "<message>", "code": "<CODE>" }`.

**Addressing a database.** Optional `space=<uuid>` query parameter (or `space` in a write
body). For an **existing** Document it may be omitted: the server looks for the id in every
database the key can reach, so an agent can work from ids alone. For creating a Document or
folder, absent means the personal database. A space the user is not a member of, or one the key
may not reach, is `404 SPACE_NOT_FOUND`, the same as a space that does not exist. Read endpoints
that search (`/search`, `/documents` without `space`) also accept `space=all`, which is their
default.

### 7.1 Discovery

| Endpoint | Scope | Returns |
|---|---|---|
| `GET /v1` | read | Name, version, links to the routes below, a one-paragraph usage note for LLMs |
| `GET /v1/openapi.json` | none (public) | OpenAPI 3.1 description of `/v1` |
| `GET /v1/me` | read | `{ user: {id, name, email}, key: {id, name, scope, spaceAccess, expiresAt}, databases: [{ id: 'personal' \| <spaceId>, kind, name, role }] }` |
| `GET /v1/spaces` | read | Spaces the key can reach: `{ id, name, role }` |

### 7.2 Reading

| Endpoint | Returns |
|---|---|
| `GET /v1/tree?space=` | The folder tree with Document titles, no bodies: `{ folders: [{id, name, parentId}], documents: [{id, title, folderId, updatedAt}] }`. Capped at 5,000 Documents (`truncated: true` beyond) |
| `GET /v1/documents?space=&folderId=&limit=&cursor=` | Documents, newest first, metadata only, paginated (default 50, max 200, opaque cursor) |
| `GET /v1/search?q=&space=&limit=` | Case-insensitive match on title and body; title matches rank first. Each hit: `{id, title, space, folderPath, updatedAt, snippet}` (snippet ≈ 160 chars around the first match). `q` 2–200 chars, default limit 20, max 100 |
| `GET /v1/documents/:id?space=` | `{ id, title, content, folderId, folderPath, space, pinned, createdAt, updatedAt }`. With `Accept: text/markdown` or `?format=markdown`, the raw body as `text/markdown` with metadata in `X-Panino-*` headers |

`folderPath` is the slash-joined folder names from the root (`Clients/Acme`), so an LLM can
reason about location without a second request.

### 7.3 Writing (`write` scope)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /v1/documents?space=` | `{ title, content?, folderId? }` | Creates; `201` with the Document. Missing `content` becomes `# <title>\n\n`, as in the app |
| `PATCH /v1/documents/:id?space=` | `{ title?, content?, folderId?, pinned?, expectedUpdatedAt? }` | Updates the given fields. `expectedUpdatedAt` that does not match is `409 VERSION_CONFLICT` |
| `POST /v1/documents/:id/append?space=` | `{ content, separator?, expectedUpdatedAt? }` | Appends to the body (default separator `\n\n`). The common "add this to my log" case, without read-modify-write races |
| `DELETE /v1/documents/:id?space=` | — | Soft delete: moves the Document into the database's **Trash** folder (§7.4). Returns the Document and `previousFolderId`, so a `PATCH {folderId: previousFolderId}` undoes it |
| `POST /v1/folders?space=` | `{ name, parentId? }` | Creates a folder; `201` |

Validation: titles and folder names 1–255 characters, no control characters; body ≤ **2 MiB**
after the write; `folderId`/`parentId` must exist in the same database (`400
FOLDER_NOT_FOUND`); a folder cannot become its own ancestor (not reachable in v1 since folders
are not moved).

### 7.4 Trash

- The Trash folder of a database is the oldest root folder (`parent_id IS NULL`) named `Trash`
  (case-insensitive). If there is none, the first API delete creates one. A user who renames
  it simply gets a new one on the next API delete.
- Search and `GET /v1/documents` leave out Documents inside Trash (including its subfolders)
  unless `includeTrash=true`. Results say `inTrash: true` when included. `GET /v1/tree` shows
  everything, since it is a tree.
- Deleting a Document already in Trash is a no-op `200` (`alreadyInTrash: true`).
- The move changes only `folder_id` and `updated_at`; title and body are untouched, so no
  revision is taken. The live-session guard still applies.
- Folders are not deletable through the API in v1.

### 7.5 What a write does on the server

For each write, in one SQLite transaction on the target content database:

1. Re-check the Document exists, `expectedUpdatedAt`, and — for a space — that no row exists in
   `collab_sessions` for it (`409 DOCUMENT_IN_LIVE_SESSION`; same rule as transfers).
2. If the body or title changes, snapshot the **current** body as a revision (so the
   pre-write text is always recoverable, even if auto-revision throttling skipped it), then
   write with a plain `INSERT`/`UPDATE`, set `updated_at` to now, then snapshot the **new**
   body. The pre-write snapshot is unattributed (the server does not know who wrote that text)
   and is skipped when it duplicates the latest revision; the post-write snapshot carries
   `actor_kind = 'api'` and the key owner as actor. Moves and pins change `updated_at`, as they
   do in the app, but take no revision.
3. The CR-SQLite triggers record the write under the server's site id, exactly like revision
   restore and space transfers already do.

After commit: poke the user's devices (personal) or the space's subscribers (`excludeSiteId =
null`) and run the add-ons' `afterChangesApplied` hook, as `/sync` does, so Odoo Knowledge
syncs see API edits.

Effect on a device that has an unsent edit to the same Document: the API write is just a
concurrent remote change. The existing merge-base / conflict machinery decides (merge or keep
both), the same as for an edit from another device. No client change is needed.

`user_id` on new rows: the owner's id in the personal database (matching the app), left
`NULL` in a space database (matching the app).

---

## 8) Security review

| Threat | Control |
|---|---|
| Key theft from the database | Only SHA-256 hashes stored; auth DB is not synced or exposed |
| Key leakage in logs / URLs | Header only, no query param; never logged; `pnk_` prefix for scanners |
| Leaked key escalates to account | Keys are refused by every non-`/v1` route, including `/refresh`, password, key management and space lifecycle (§4), with tests |
| Key outlives intent | Expiry, revocation effective on the next request, last-used shown in Settings |
| Cross-user access | `req.user.user_id` from the key row only; key management scoped to the caller; space access through `resolveSpaceAccess` on every request (non-members get the same 404 as missing spaces) |
| Personal-only key reaching spaces | `spaceAccess = 'personal'` rejects any `space` parameter with the non-disclosing 404, and `space=all` expands to personal only |
| Destructive LLM action | Delete is a move to Trash, never a removal; every body/title write is bracketed by revisions; `expectedUpdatedAt`; live-session guard |
| SQL injection | Parameterized SQL only. Search uses `instr(lower(...), lower(?))`, not `LIKE` with user patterns, so `%` and `_` are literal |
| Resource exhaustion | 120 req/min per key; 2 MiB body; result caps on search, list and tree; 10 keys per user |
| XSS through API-written content | Content is stored as Markdown like any other edit; the existing render-time sanitization applies unchanged |
| Error detail leakage | Fixed messages + codes; internals only in server logs, without key material |
| CORS | `/v1` sends no credentials (bearer header only), so the existing permissive CORS is acceptable; no cookies are involved |

---

## 9) Edge cases

- Shared spaces disabled on the server: `space` parameters are 404, `space=all` means personal.
- A Document id that exists in two databases (cannot happen with UUIDs, but): lookups are always
  scoped to one database.
- `PATCH` with no recognized fields: `400 NOTHING_TO_UPDATE`.
- Append to an empty Document: no leading separator.
- Title change only: revision snapshots still taken (titles are part of revisions).
- `folderId: null` in `PATCH` moves the Document to the root.
- A space in pending deletion is inaccessible (membership resolution already refuses it).
- The key owner's account deleted: key rows orphaned → refused (`user no longer exists`).
- Clock skew: `expectedUpdatedAt` is compared as the exact stored string, never parsed.

---

## 10) Implementation plan

1. **Pure utilities** (`backend/api-service/apiKeyUtils.js`): key generation, hashing, prefix,
   validation of create input, rate limiter, snippet and folder-path helpers. Unit tests.
2. **Key storage + management routes** (`apiKeys.js`): schema in `getAuthDb()` init,
   `/api-keys` routes, `authenticateApiKey` middleware. Integration tests.
3. **v1 router** (`publicApi.js`): read endpoints, then write endpoints, revision attribution
   (`actor_kind = 'api'`), pokes and hooks, OpenAPI document. Integration tests including the
   "keys refused elsewhere" matrix and spaces.
4. **Frontend**: `apiKeysStore.js`, `ApiKeysSection.vue` on the desktop Settings page, phone
   Settings row + sheet, revision panel label. Unit tests for the store.
5. **Docs**: `docs/architecture/public-api.md` (how it works, for maintainers) and an LLM-facing
   usage page reachable as `GET /v1`.

## 11) Testing

- Backend unit: key format, hash, prefix, validation, rate limiter, snippet, folder path.
- Backend integration: create/list/revoke; limit of 10; expiry; revoked key refused; key refused
  by `/sync`, `/refresh`, `/me/password`, `/api-keys`, `/spaces`, `/addons`; JWT refused by
  `/v1`; read scope refused on writes; every v1 endpoint happy path; `VERSION_CONFLICT`;
  live-session refusal; space access for member, non-member and personal-only key; revisions
  created with `actor_kind = 'api'`; devices poked; written rows visible in `crsql_changes` so a
  `/sync` pull returns them.
- Browser: create a key in Settings (1280 px and 375 px), call the API with it, watch the new
  Document appear in the open app, see the revision attribution, revoke the key and see the
  next call refused.

## 12) Follow-ups (not in v1)

- MCP server (`/v1/mcp`, streamable HTTP) exposing the same operations as tools.
- Read access to revisions and images; image upload.
- Per-space selection on a key (choose specific spaces rather than all/personal).
- Soft delete of folders; restore-from-Trash shortcut (`POST /v1/documents/:id/restore`).
