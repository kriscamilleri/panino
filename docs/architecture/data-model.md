# Data model and sync contract

## Database classes

The browser has the synced content tables and the backend has the same CRR schema plus
backend-only operational tables. The backend also has a separate authentication database.

### Per-user database

| Table | Classification | Purpose |
|---|---|---|
| `users` | CRR | User profile replicated to clients |
| `folders` | CRR | Folder tree |
| `notes` | CRR | Markdown documents |
| `images` | CRR | Uploaded-image metadata |
| `settings` | CRR | JSON-encoded user settings |
| `globals` | CRR | Global template variables |
| `templates` | CRR | Document templates |
| `backup_config` | Local/backend-only | Provider credentials and backup state |
| `note_revisions` | Local/backend-only | Compressed revision snapshots |
| `note_revision_meta` | Local/backend-only | Revision pruning metadata |

The backend schema is declared in `backend/api-service/db.js`; the browser schema is declared
in `frontend/src/store/syncStore.js`. Keep those two schema definitions aligned for every CRR
table.

### Authentication database

`data/_users.db` is not synced. It contains:

```sql
users (id TEXT PRIMARY KEY, name, email, password_hash, created_at)
password_resets (token_hash TEXT PRIMARY KEY, user_id, expires_at)
```

The `users` table in this database is separate from the per-user CRR `users` table.

## Settings

The synced `settings` table stores one JSON string per setting key. Current keys include
`previewStyles`, `printStyles`, and `uiSettings`.

## `/sync` wire contract

```text
POST /sync
Body:     { since: number, siteId: hex_string, changes: Change[] }
Response: { changes: Change[], clock: number, skipped: number }
```

Each change has the shape:

```text
{ table, pk, cid, val, col_version, db_version, site_id, cl, seq }
```

- `pk` is commonly a JSON array string such as `'["uuid-value"]'`.
- `site_id` is a 32-character hexadecimal representation of 16 bytes.
- `val` is a JSON-encoded scalar for values received from the browser.
- `clock` is the highest `db_version` returned by the backend.
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
