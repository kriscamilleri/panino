# Data model and sync contract

## Database classes

The browser has the synced content tables and the backend has the same CRR schema plus
backend-only operational tables. The backend also has a separate authentication database.

### Per-user database

| Table | Classification | Purpose |
|---|---|---|
| `users` | CRR | User profile replicated to clients |
| `folders` | CRR | Folder tree |
| `notes` | CRR | Markdown documents, including the `pinned` flag surfaced by the document dashboards |
| `images` | CRR | Uploaded-image metadata |
| `settings` | CRR | JSON-encoded user settings |
| `globals` | CRR | Global template variables |
| `templates` | CRR | Document templates |
| `backup_config` | Local/backend-only | GitHub add-on (`addons/github/schema.js`): GitHub credentials and backup state |
| `note_revisions` | Local/backend-only | Compressed revision snapshots |
| `note_revision_meta` | Local/backend-only | Revision pruning metadata |

The backend schema is declared in `backend/api-service/db.js`; the browser schema is declared
in `frontend/src/store/syncStore.js`. Keep those two schema definitions aligned for every CRR
table. Backend-only `application_schema`, `_spaces.db` tables, revision tables, and personal backup
configuration are deliberate non-CRR exceptions.

### Shared-space content databases

Shared spaces use `data/spaces/{spaceId}.db` and the same CRR content tables as personal databases. Backend content connections use canonical `space:<uuid>` keys; personal databases use `user:<uuid>`. `application_schema` is a local, non-CRR table that records the content database kind and ordered schema version. Personal-only `backup_config` (GitHub add-on) is not created in a space database.

Content schema v2 adds `collab_sessions`, `collab_session_acks`, and
`collab_recovery_archives` only to space databases. All are backend-local, non-CRR recovery
tables. The first stores the last acknowledged Yjs document state and server-owned plain-text
merge base; the second makes participant sequence acknowledgements idempotent across a restart;
the third retains the gzip support export made before 30-day abandoned-state deletion. None is
part of `/sync` or the browser schema, and `notes.content` remains the only replicated document
body.

### Shared-space metadata database

`data/_spaces.db` is backend-only and not synced. It contains `spaces`, `space_members`,
`space_invites`, `space_user_versions`, `space_transfers`, and its own ordered
`spaces_schema_migrations` table.
Schema v2 adds a non-secret UUID management id and revocation timestamp to invitations; raw
256-bit invite tokens appear only in email or the owner's immediate create/resend response, while
SHA-256 hashes remain at rest. Invites are normalized to the captured email, expire after seven
days, create editors only, and are single-use. An invitation address is exactly one mailbox, an
owner can cause 20 invitation emails an hour across all their spaces (`SPACE_INVITES_PER_HOUR`),
a space can hold 50 pending invitations (`SPACE_PENDING_INVITE_LIMIT`), and invitations used,
revoked or expired a month ago are removed.

**Accepting without the mailed link requires a verified address.** Sign-up does not check the
address it is given, so an account whose address merely matches proves nothing.
`GET /space-invitations` and `POST /space-invitations/:inviteId/accept` therefore work only for an
account with `users.email_verified_at` set, and the list response says which case applies
(`emailVerified`). Two things set it: "verify my email" (below, under the authentication
database) and completing a password reset, whose link is mailed to the stored address. Accepting
through the mailed invitation link does not: the owner who created the invitation is shown the
same link. An unverified account can always accept through the link.

Schema v3 adds server-owned cross-database transfer checkpoints. A transfer records the actor,
source/destination database keys and Document ids, source content hash/timestamp, stable image-id
map, visible warnings, stage, and confirmation/deletion timestamps. The API reauthorizes both
databases on every resume/recovery action. Destination rows and copied bytes are hash/size verified
before source deletion; terminal recovery is either `complete` or `kept_both`. A transfer that has
not yet produced a destination Document can be given up with `DELETE /space-transfers/:id`, which
also removes images it had copied. Finished transfers are dropped after 30 days and untouched ones
after 90. A transfer is refused for a Document over 2 MiB, with more than 100 images, that would
take the destination past its image quota, or that is open in a live session.

**A transfer is a copy or a move, and the caller must say which** (`mode` on
`POST /space-transfers`; there is no default, because one of the two deletes a Document). A copy
ends at `kept_both` as soon as the destination is verified and never touches the source, its
revision history or its images. A move goes on to delete the source and ends at `complete`. The
choice is stored on the row (`space_transfers.keep_source`) and read from there on every resume,
so retrying an interrupted copy cannot turn it into a move, and `delete-source` is refused for a
copy. `keep_source` was added without raising the metadata schema version: a build that does not
know the column still opens the database, and the rows it writes default to a move, which is what
that build does.

Image links are recognised in every form the editor writes (`imageLinks.js`): `/images/<id>`,
`/api/images/<id>` in production, and an absolute URL on a configured origin in development. A
rebound link keeps the form it had. The destination Document starts with one revision. Revision
history is never copied, because it can hold text its author removed before sharing: it stays with
the source, and a move deletes it with the source. The dialog that asks "copy or move" says so.

All lifecycle routes fail closed unless `SHARED_SPACES_ENABLED=true`. The authenticated,
paginated `GET /spaces` registry returns only active memberships, a membership version, the
minimum supported client schema, and profile-safe member `{id, name}` values. Member-detail
responses expose pending invite email only to the owner. Rename, member changes, ownership
transfer, leave, and deletion advance every affected member's version. Removal/leave/deletion
also revoke active WebSocket subscriptions immediately. A deletion request makes the space
inaccessible at once, retains its content/uploads for 30 days, and leaves feature-flag-independent
maintenance to purge the retained set after the deadline. Until then the owner can undo it with
`POST /spaces/:spaceId/deletion-cancel`; the first page of `GET /spaces` lists the owner's pending
deletions (`pendingDeletion`) and what else the server offers (`capabilities.liveSessions`).

A mutation checks the integrity of the space it touched, not of every space
(`assertSpacesInvariants(db, { spaceIds })`); the unscoped sweep is for restore tooling.

Space image metadata remains in the space content database while bytes live under
`uploads/spaces/{spaceId}/`. Every image operation, including token-query `<img>` reads and PDF
embedding, resolves active membership first; qualified HTTP responses use `private, no-store`.
Canonical Markdown destinations are `/images/{id}?space={spaceId}`. Revision routes use the same
optional `space` qualifier and return only backend-derived actor `{id, name}` display data.

Every image is served with `Content-Security-Policy: default-src 'none'; style-src
'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff`, and a stored type outside the
upload allow-list is sent as a download. An SVG is a document; without the sandbox, opening one
directly ran its scripts in the application's origin.

### Authentication database

`data/_users.db` is not synced. It contains:

```sql
users (id TEXT PRIMARY KEY, name, email, password_hash, created_at, email_verified_at)
password_resets (token_hash TEXT PRIMARY KEY, user_id, expires_at)
email_verifications (token_hash TEXT PRIMARY KEY, user_id, email, expires_at, created_at)
```

`email_verified_at` is set when the account holder has demonstrably received mail at the address
(`accountEmail.js`). Sign-up trims the address and refuses one that differs from an existing
account's only by case or surrounding spaces.

**Verify my email** (`emailVerification.js`; the routes exist only while `SHARED_SPACES_ENABLED`
is on, since a verified address matters to nothing else yet):

- `POST /account/email-verification` mails a link to the account's stored address, never to one
  in the request. Three requests an hour per account, counted whether or not the mail went out.
  The token is 256 random bits, stored only as its SHA-256 hash, valid for 24 hours.
- `POST /account/email-verification/confirm` takes the token **and the session of the account
  that asked**. The token alone is deliberately not enough. Anyone can register someone else's
  address and ask for this mail; if the mailbox's real holder could verify by clicking, that
  stranger's account would become verified for an address it does not hold, which is the takeover
  verification exists to prevent. The real holder cannot sign in to that account, so their click
  changes nothing. Another account's link is refused and left usable; a link issued for an
  address the account no longer has is refused; confirming spends every outstanding link.
- The page behind the link (`/#/verify-email/<token>`) verifies only on an explicit button, so a
  mail scanner following the link verifies nothing.

The `users` table in this database is separate from the per-user CRR `users` table.

## Settings

The synced `settings` table stores one JSON string per setting key. Current keys include
`previewStyles`, `printStyles`, and `uiSettings`.

## `/sync` wire contract

```text
POST /sync
Body:     { since: number, siteId: hex_string, changes: Change[], space?: uuid }
Response: { changes: Change[], clock: number, skipped: number,
            contentMergeWriteback: boolean, membershipVersion?: number }
```

Each change has the shape:

```text
{ table, pk, cid, val, col_version, db_version, site_id, cl, seq }
```

- `pk` is commonly a JSON array string such as `'["uuid-value"]'`.
- `site_id` is a 32-character hexadecimal representation of 16 bytes.
- `val` is a JSON-encoded scalar for values received from the browser.
- `pk` must decode to a well-formed CR-SQLite packed key. A batch containing one that does
  not is refused whole with `400 INVALID_CHANGE` before anything is merged, because the
  extension aborts the process on a malformed key.
- `changes` in the response are the other replicas' changes since `since` **as they stood
  before this request's own `changes` were merged**. A body the upload overwrites is therefore
  still returned once, which is how the uploader learns it replaced an edit it had not seen.
  Such rows lose again when the client applies them.
- `clock` is the highest `db_version` on the backend after the merge. It is the server's
  version: clients send it back as `since` and must not use it to select their own changes to
  upload (see "Two positions per client" in `crsqlite-sync.md`).
- `contentMergeWriteback` is the server-owned switch for automatic merging of concurrent body
  edits (`CONTENT_MERGE_WRITEBACK_ENABLED`). Absent or false means the client keeps both sides
  for the user instead.
- An absent `space` targets the authenticated user's personal database; a present `space`
  targets canonical `space:<uuid>` state after membership authorization. A non-member receives
  the same `404` shape as a missing space.
- Space responses carry `membershipVersion`; clients refresh their paginated membership snapshot
  before retrying when it changes.
- `skipped` is an observability field for the number of changes rejected by legacy
  per-change handling; new code should fail closed rather than silently treating a failed
  merge as success.

## Conversion helpers

`backend/api-service/sync.js` contains the boundary normalizers:

- `toBufferLike(v)` converts hex, arrays, UUID strings, base64, and numeric-key objects to a
  buffer where possible.
- `toSiteIdBlob(v)` converts a site ID to a 16-byte buffer.
- `toSqliteScalar(v)` converts JSON values to SQLite-bindable scalar values.

Use parameterized SQL for all application values. Do not interpolate primary keys, user IDs,
or change values into SQL text.

## Browser database registry

The frontend registry is keyed only by canonical `user:<uuid>` and `space:<uuid>` values. Each
entry owns its CR-SQLite handle, database-reported site ID, clock, and sync/apply state. Browser
clocks live at `crsqlite_clock:<dbKey>`; initialization migrates and removes the legacy personal
`crsqlite_clock` key once. The personal database opens before asynchronous membership discovery,
and registered databases sync sequentially so a failed replica cannot block or advance another.

Frontend repositories require a database key at their public boundary. Tree nodes retain an
in-memory node-to-database index, dashboard rows are tagged before their per-database result sets
are merged, and global limits are applied only after that merge. A revoked membership closes and
removes the local handle from the active registry and unsubscribes its WebSocket key.

A space's local database is named `pn-s-<space id without dashes>-<first 12 hex digits of the
account id>.db`, so two accounts on one browser never open each other's replica. The name is short
on purpose: the browser's SQLite file system refuses a path over 64 characters, and a database
whose name is too long does not open at all. When access to a space ends (removal, leaving,
deletion, or "Remove locally") its blocks are deleted from IndexedDB, together with its clock,
its push cursor and its cached API responses (`localDatabaseStorage.js`).

The last space list is kept at `panino_spaces:<userId>`. On a start with no connection the spaces
in it are opened, a space this device has synced before opens with what it holds, and spaces that
could not be opened are retried when the connection returns.

The server keeps content database connections open between requests, at most 200
(`DB_CONNECTION_CACHE_LIMIT`); beyond that it closes the least recently used ones that have been
idle for a minute.
