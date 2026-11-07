// Tables of the AI agents add-on. All are server-only (never CRRs, never in the
// browser schema) and idempotent.
//
// Server-wide tables, on the auth database (`_users.db`), because a credential
// arrives without saying whose it is (docs/specs/active/ai-integration.md §6.7).

export const AI_AUTH_SCHEMA = `
  -- Personal API keys (llm-api.md §5). Only the SHA-256 of a key is stored;
  -- prefix is the display-only start.
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    space_access TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, created_at);

  -- OAuth clients that registered themselves (RFC 7591). Clients identified by
  -- a metadata document URL are not stored here; their document is fetched.
  CREATE TABLE IF NOT EXISTS ai_oauth_clients (
    client_id TEXT PRIMARY KEY NOT NULL,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  -- An authorization request waiting for the user's consent (10 minutes).
  CREATE TABLE IF NOT EXISTS ai_oauth_requests (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_kind TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    state TEXT,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_by TEXT,
    completed_at TEXT
  );

  -- A connected app: what the user approved, and its current tokens (hashed).
  CREATE TABLE IF NOT EXISTS ai_oauth_grants (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_kind TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    space_access TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    access_hash TEXT UNIQUE,
    access_expires_at TEXT,
    refresh_hash TEXT UNIQUE,
    refresh_expires_at TEXT,
    previous_refresh_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ai_oauth_grants_user ON ai_oauth_grants(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_oauth_grants_previous ON ai_oauth_grants(previous_refresh_hash);
  CREATE INDEX IF NOT EXISTS idx_ai_oauth_grants_client ON ai_oauth_grants(client_id);

  -- One-time authorization codes (60 seconds), bound to a grant.
  CREATE TABLE IF NOT EXISTS ai_oauth_codes (
    code_hash TEXT PRIMARY KEY NOT NULL,
    grant_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
`;

// Content tables, on every content database (user and space).
export const AI_CONTENT_SCHEMA = `
  -- Where a Document or folder was before the v1 API moved it into Trash, so
  -- restore_from_trash can put it back (docs/specs/proposed/ai-api-expansion.md
  -- §4.2). previous_parent_id is the folder it was in; NULL is the top level.
  -- Written when the API trashes something, deleted when the API restores or
  -- moves it. Items moved into Trash any other way have no row and restore to
  -- the top level.
  CREATE TABLE IF NOT EXISTS ai_trash_origins (
    item_id TEXT PRIMARY KEY NOT NULL,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('document', 'folder')),
    previous_parent_id TEXT,
    trashed_at TEXT NOT NULL
  );
`;
