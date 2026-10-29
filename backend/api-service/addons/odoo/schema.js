/**
 * The Odoo add-on's tables, registered through its manifest (index.js) and
 * created by db.js when a database opens. All server-only: never CRRs, never in
 * the browser schema.
 */

/** User databases only. */
export const ODOO_USER_SCHEMA = `
  -- The user's Odoo connection (connection.js). Server-only: never a CRR, never in
  -- the browser schema. The API key is AES-256-GCM encrypted (core secrets.js).
  CREATE TABLE IF NOT EXISTS odoo_connection (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    base_url TEXT NOT NULL,
    database_name TEXT NOT NULL DEFAULT '',
    api_key_enc TEXT NOT NULL,
    key_expires_on TEXT,
    odoo_uid INTEGER,
    odoo_user_name TEXT,
    odoo_version TEXT,
    apps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_verified_at TEXT,
    last_error TEXT
  );

  -- The user's saved layouts for Odoo data blocks (saleOrderBlocks.js).
  -- Server-only. A block carries its own layout, so these are only for reuse.
  CREATE TABLE IF NOT EXISTS odoo_block_layouts (
    id TEXT PRIMARY KEY NOT NULL,
    model TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Send and sync bookkeeping, kept in the database the Document lives in (user
 * or space) so every member of a space updates the same Odoo record.
 */
export const ODOO_CONTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS odoo_links (
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'note' CHECK (source_type IN ('note', 'folder')),
    destination TEXT NOT NULL CHECK (destination IN ('documents', 'knowledge', 'chatter')),
    odoo_target TEXT NOT NULL,
    target_key TEXT NOT NULL DEFAULT '',
    odoo_record_id INTEGER NOT NULL,
    odoo_message_id INTEGER,
    odoo_create_date TEXT,
    odoo_url_path TEXT,
    sync_id TEXT,
    content_hash TEXT,
    archived_at TEXT,
    first_sent_by TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    last_sent_by TEXT NOT NULL,
    PRIMARY KEY (source_id, destination, odoo_target, target_key)
  );
  CREATE TABLE IF NOT EXISTS odoo_defaults (
    odoo_target TEXT PRIMARY KEY NOT NULL,
    folder_id INTEGER,
    parent_article_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS odoo_syncs (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('space', 'folder', 'note')),
    source_id TEXT,
    odoo_target TEXT NOT NULL,
    parent_article_id INTEGER,
    documents_folder_id INTEGER,
    run_as TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    paused_reason TEXT,
    last_run_at TEXT,
    last_reconcile_at TEXT,
    last_result TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
