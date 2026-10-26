// /app/db.js  (api-service)
// ---------------------------------
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "data");
const SPACES_DB_DIR = path.join(DB_DIR, "spaces");
export const CONTENT_SCHEMA_VERSION = 2;
// Browser CRR schema compatibility remains v1: content schema v2 adds only
// backend-local live-session recovery tables.
export const MINIMUM_CLIENT_SCHEMA_VERSION = 1;
export const SPACES_SCHEMA_VERSION = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lock waits on the shared metadata databases (`_users.db`, `_spaces.db`).
//
// better-sqlite3 is synchronous. While one statement waits for a lock, the
// whole process waits with it: every other request, every WebSocket message,
// every timer. A `busy_timeout` is therefore not a per-request courtesy but a
// bound on how long ANYTHING outside this process (the backup tool, a repair
// script, an operator's sqlite3 session, a second API process) can freeze the
// API by holding a lock. With 30 seconds, one held write lock on `_users.db`
// was measured freezing unrelated `/sync` requests for the full duration.
//
// So the wait is kept short in the running service, and a request that still
// finds the database locked fails fast with a retryable 503 instead of holding
// up everyone else. The test suite is the exception: its workers are separate
// processes sharing the same two files, and a long wait there only slows the
// worker that is waiting.
const SERVICE_BUSY_TIMEOUT_MS = 250;
const TEST_BUSY_TIMEOUT_MS = 30_000;
const MAX_BUSY_TIMEOUT_MS = 60_000;

export function resolveMetadataBusyTimeoutMs(env = process.env) {
  const raw = env.METADATA_DB_BUSY_TIMEOUT_MS;
  const configured = raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(Math.floor(configured), MAX_BUSY_TIMEOUT_MS);
  }
  return env.NODE_ENV === "test" ? TEST_BUSY_TIMEOUT_MS : SERVICE_BUSY_TIMEOUT_MS;
}

export const METADATA_DB_BUSY_TIMEOUT_MS = resolveMetadataBusyTimeoutMs();

/** True for SQLite's "another connection holds the lock" family of errors. */
export function isDatabaseBusyError(error) {
  const code = String(error?.code || "");
  return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
}

/** The response for a request that found a database locked: retry shortly. */
export function respondDatabaseBusy(res) {
  res.set("Retry-After", "1");
  return res.status(503).json({ error: "Temporarily unavailable", code: "DATABASE_BUSY" });
}

const dbConnections = new Map();

// Content connections stay open between requests, because opening one loads the
// extension and checks the schema. Left unbounded, every database ever touched
// kept three file descriptors (main, -wal, -shm) for the life of the process,
// and with shared spaces the number of databases is no longer one per user.
//
// The limit is soft. Only a connection nobody has asked for in the last minute
// is closed: an asynchronous route (image upload, PDF, Document transfer) holds
// the handle it was given across awaits, and closing that one under it would
// fail the request. Every caller asks getDb() afresh per request, so a closed
// connection is simply reopened.
const DB_CACHE_LIMIT = (() => {
  const configured = Number(process.env.DB_CONNECTION_CACHE_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : 200;
})();
const DB_CACHE_MIN_IDLE_MS = 60_000;
const dbLastUsed = new Map();

const isContentKey = (key) => !key.startsWith("_");

/**
 * Close the least recently used content connections once more than `limit`
 * are open, skipping any used within `minIdleMs`.
 *
 * @returns {number} connections closed
 */
export function evictIdleDbConnections({
  limit = DB_CACHE_LIMIT,
  minIdleMs = DB_CACHE_MIN_IDLE_MS,
  now = Date.now(),
} = {}) {
  let open = 0;
  for (const key of dbConnections.keys()) if (isContentKey(key)) open += 1;
  if (open <= limit) return 0;

  const idle = [...dbConnections.keys()]
    .filter(isContentKey)
    .map((key) => [key, dbLastUsed.get(key) ?? 0])
    .filter(([, usedAt]) => now - usedAt >= minIdleMs)
    .sort((a, b) => a[1] - b[1]);
  let closed = 0;
  for (const [key] of idle) {
    if (open <= limit) break;
    releaseDb(key);
    open -= 1;
    closed += 1;
  }
  return closed;
}

/** Close one cached connection as routine housekeeping (no health event logged). */
function releaseDb(key) {
  const db = dbConnections.get(key);
  dbConnections.delete(key);
  dbLastUsed.delete(key);
  try {
    db?.close();
  } catch (error) {
    console.error("[db] Failed to close an idle connection:", error?.code || "unknown");
  }
}

/** How many content databases are open right now. */
export function openContentDbCount() {
  let open = 0;
  for (const key of dbConnections.keys()) if (isContentKey(key)) open += 1;
  return open;
}

const BASE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    email TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    name TEXT,
    parent_id TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    folder_id TEXT,
    title TEXT,
    content TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    filename TEXT,
    mime_type TEXT,
    path TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS globals (
    key TEXT PRIMARY KEY NOT NULL,
    id TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    display_key TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS note_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL,
    title TEXT,
    content_gzip BLOB NOT NULL,
    type TEXT NOT NULL DEFAULT 'auto',
    content_sha256 TEXT NOT NULL,
    uncompressed_bytes INTEGER NOT NULL,
    compressed_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    -- Backend-only revision attribution (COLLAB-04 §3.3). Never a CRR
    -- column, never client-writable; actor_kind validity ('sync' | 'collab'
    -- | 'system') is enforced in createRevisionSnapshot(), not by CHECK,
    -- so it stays easy to migrate in place.
    actor_user_id TEXT,
    actor_kind TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_note_revisions_note_created
    ON note_revisions(note_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_note_revisions_note_type_created
    ON note_revisions(note_id, type, created_at DESC);

  CREATE TABLE IF NOT EXISTS note_revision_meta (
    note_id TEXT PRIMARY KEY NOT NULL,
    last_pruned_at TEXT
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    title_pattern TEXT NOT NULL DEFAULT '',
    default_folder_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_templates_updated
    ON templates(updated_at DESC);

  -- Named preview and print styles, and the folder/template defaults that
  -- point at them. An assignment id is '<target_type>:<target_id>:<kind>' so
  -- devices setting the same default converge on one row.
  CREATE TABLE IF NOT EXISTS style_presets (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL DEFAULT 'preview',
    name TEXT NOT NULL DEFAULT '',
    styles TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS style_assignments (
    id TEXT PRIMARY KEY NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    preset_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const USER_LOCAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS backup_config (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL UNIQUE,
    access_token_enc TEXT,
    username TEXT,
    avatar_url TEXT,
    repo_full_name TEXT,
    auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
    last_backup_at TEXT,
    last_backup_sha TEXT,
    last_warning TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );

  -- The user's Odoo connection (odoo.js). Server-only: never a CRR, never in
  -- the browser schema. The API key is AES-256-GCM encrypted (secrets.js).
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
`;

// Backend-only, space-local recovery state for COLLAB-05. This table must
// never become a CRR or appear in the browser schema: acknowledged Yjs state
// is a bounded crash-recovery checkpoint, not a second replicated document.
const SPACE_LOCAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS collab_sessions (
    note_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    ydoc_state BLOB NOT NULL,
    base_content TEXT NOT NULL,
    base_hash TEXT NOT NULL,
    durable_sequence INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );
  -- Updates accepted since the session's last full checkpoint, in order. An
  -- accepted update is made durable by appending it here; rewriting the whole
  -- document state for every keystroke cost time proportional to the Document
  -- on the one thread that serves everyone.
  CREATE TABLE IF NOT EXISTS collab_session_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    update_blob BLOB NOT NULL,
    FOREIGN KEY (session_id) REFERENCES collab_sessions(session_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_collab_session_updates_session
    ON collab_session_updates(session_id, id);
  CREATE TABLE IF NOT EXISTS collab_session_acks (
    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    highest_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, participant_id),
    FOREIGN KEY (session_id) REFERENCES collab_sessions(session_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS collab_recovery_archives (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    payload_gzip BLOB NOT NULL,
    archived_at TEXT NOT NULL
  );
`;

const CONTENT_SCHEMA_METADATA = `
  CREATE TABLE IF NOT EXISTS application_schema (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    kind TEXT NOT NULL CHECK (kind IN ('user', 'space')),
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const CRR_TABLES = [
  "users",
  "folders",
  "notes",
  "images",
  "settings",
  "globals",
  "templates",
  "style_presets",
  "style_assignments",
];

export function parseDbKey(dbKey) {
  if (typeof dbKey !== "string") {
    throw new TypeError("Database key must be a string.");
  }
  const match = /^(user|space):(.+)$/.exec(dbKey);
  if (!match || !UUID_PATTERN.test(match[2])) {
    throw new Error("Database key must be user:<uuid> or space:<uuid>.");
  }
  const kind = match[1];
  const id = match[2].toLowerCase();
  return { kind, id, dbKey: `${kind}:${id}` };
}

function assertContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Resolved database path escapes its database root.");
  }
}

export function resolveDbPath(dbKey) {
  const parsed = parseDbKey(dbKey);
  const root = path.resolve(parsed.kind === "space" ? SPACES_DB_DIR : DB_DIR);
  const dbPath = path.resolve(root, `${parsed.id}.db`);
  assertContainedPath(root, dbPath);
  return { ...parsed, root, dbPath };
}

/**
 * CR-SQLite's generated update trigger for a table, or `undefined` when the
 * table is not a CRR on this connection (a fresh database before `ensureCrr`,
 * or a handle opened without the extension).
 */
function crrUpdateTriggerSql(db, table) {
  return db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    )
    .get(`${table}__crsql_utrig`)?.sql;
}

/**
 * Adds the `pinned` note attribute to per-user databases created before the
 * Recent Documents redesign.
 */
export function ensureNotesSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info('notes')").all();
    if (!columns || columns.length === 0) return;

    const names = new Set(columns.map((column) => column.name));
    const triggerSql = crrUpdateTriggerSql(db, "notes");
    const isCrr = Boolean(triggerSql);

    if (!names.has("pinned")) {
      if (isCrr) db.prepare("SELECT crsql_begin_alter('notes')").get();
      try {
        db.exec(
          "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        );
        db.exec("UPDATE notes SET pinned = 0 WHERE pinned IS NULL");
      } finally {
        if (isCrr) db.prepare("SELECT crsql_commit_alter('notes')").get();
      }
      return;
    }

    if (isCrr && !triggerSql.includes("pinned")) {
      db.prepare("SELECT crsql_begin_alter('notes')").get();
      db.prepare("SELECT crsql_commit_alter('notes')").get();
    }
  } catch (err) {
    console.error("[db] Failed to ensure notes schema:", err);
    throw err;
  }
}

/**
 * Adds `size_bytes` and `sha256` to per-user databases created before those
 * columns existed.
 *
 * `images` is a CRR, and CR-SQLite generates its insert/update/delete triggers
 * from the column list at registration time. A bare `ALTER TABLE` leaves
 * triggers bound to the old column count, so the next write fails with
 * `expected N values, got M` — and re-running `crsql_as_crr` does not rebuild
 * them, it reports success and leaves the stale triggers in place.
 * `crsql_begin_alter` / `crsql_commit_alter` is the supported way to change a
 * CRR's shape.
 */
export function ensureImagesSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info('images')").all();
    if (!columns || columns.length === 0) {
      return;
    }

    const names = new Set(columns.map((column) => column.name));
    const triggerSql = crrUpdateTriggerSql(db, "images");
    const isCrr = Boolean(triggerSql);
    const required = ["size_bytes", "sha256"];

    if (required.some((column) => !names.has(column))) {
      if (isCrr) db.prepare("SELECT crsql_begin_alter('images')").get();
      try {
        if (!names.has("size_bytes")) {
          db.exec(
            "ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0",
          );
          db.exec("UPDATE images SET size_bytes = 0 WHERE size_bytes IS NULL");
        }

        if (!names.has("sha256")) {
          db.exec(
            "ALTER TABLE images ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''",
          );
          db.exec("UPDATE images SET sha256 = '' WHERE sha256 IS NULL");
        }
      } finally {
        if (isCrr) db.prepare("SELECT crsql_commit_alter('images')").get();
      }

      if (!isCrr) db.exec("SELECT crsql_as_crr('images')");
      return;
    }

    // Self-heal a database whose columns were added by the old bare-ALTER
    // migration, or by a run interrupted before the commit.
    if (isCrr && !required.every((column) => triggerSql.includes(column))) {
      db.prepare("SELECT crsql_begin_alter('images')").get();
      db.prepare("SELECT crsql_commit_alter('images')").get();
      return;
    }

    if (!isCrr) db.exec("SELECT crsql_as_crr('images')");
  } catch (err) {
    console.error("[db] Failed to ensure images schema:", err);
    throw err;
  }
}

/**
 * Resolve the vendored crsqlite loadable extension.
 */
function resolveCrsqlitePath() {
  const env = process.env.CRSQLITE_EXT_PATH;
  if (env && fs.existsSync(env)) return env;

  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "The vendored crsqlite.so supports Linux x86_64 only. Set CRSQLITE_EXT_PATH to a compatible extension.",
    );
  }

  const vendored = path.join(__dirname, "native", "crsqlite.so");
  if (fs.existsSync(vendored)) return vendored;

  throw new Error(
    "Could not locate vendored crsqlite.so. Set CRSQLITE_EXT_PATH to its absolute path.",
  );
}

function ensureCrr(db) {
  for (const table of CRR_TABLES) {
    db.prepare("SELECT crsql_as_crr(?)").get(table);
    const trigger = crrUpdateTriggerSql(db, table);
    if (!trigger) throw new Error(`Failed to register ${table} as a CRR.`);
  }
}

function ensureGlobalsSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info('globals')").all();
    if (!columns || columns.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS globals (
          key TEXT PRIMARY KEY NOT NULL,
          id TEXT NOT NULL DEFAULT '',
          value TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          display_key TEXT NOT NULL DEFAULT ''
        )
      `);
      db.exec("SELECT crsql_as_crr('globals')");
      return;
    }

    const names = new Set(columns.map((c) => c.name));
    const indexes = db.prepare("PRAGMA index_list('globals')").all();
    const hasExtraUnique = (indexes || []).some(
      (idx) => idx?.unique && idx?.origin !== "pk",
    );

    if (hasExtraUnique) {
      const selectId = names.has("id") ? "id" : "key";
      const selectCreated = names.has("created_at")
        ? "created_at"
        : "datetime('now')";
      const selectUpdated = names.has("updated_at")
        ? "updated_at"
        : "datetime('now')";
      const selectDisplay = names.has("display_key") ? "display_key" : "key";

      db.exec("BEGIN");
      try {
        db.exec(`
          CREATE TABLE globals_new (
            key TEXT PRIMARY KEY NOT NULL,
            id TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            display_key TEXT NOT NULL DEFAULT ''
          )
        `);
        db.exec(`
          INSERT INTO globals_new (key, id, value, created_at, updated_at, display_key)
          SELECT
            key,
            ${selectId} as id,
            value,
            ${selectCreated} as created_at,
            ${selectUpdated} as updated_at,
            ${selectDisplay} as display_key
          FROM globals
        `);
        db.exec("DROP TABLE globals");
        db.exec("ALTER TABLE globals_new RENAME TO globals");
        db.exec("SELECT crsql_as_crr('globals')");
        db.exec("COMMIT");
        return;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    if (!names.has("id")) {
      db.exec("ALTER TABLE globals ADD COLUMN id TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE globals SET id = key WHERE id IS NULL");
    }
    if (!names.has("created_at")) {
      db.exec(
        "ALTER TABLE globals ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))",
      );
      db.exec(
        "UPDATE globals SET created_at = datetime('now') WHERE created_at IS NULL",
      );
    }
    if (!names.has("updated_at")) {
      db.exec(
        "ALTER TABLE globals ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
      );
      db.exec(
        "UPDATE globals SET updated_at = datetime('now') WHERE updated_at IS NULL",
      );
    }
    if (!names.has("display_key")) {
      db.exec(
        "ALTER TABLE globals ADD COLUMN display_key TEXT NOT NULL DEFAULT ''",
      );
      db.exec("UPDATE globals SET display_key = key WHERE display_key IS NULL");
    }
    db.exec("SELECT crsql_as_crr('globals')");
  } catch (err) {
    console.error("[db] Failed to ensure globals schema:", err);
    throw err;
  }
}

function ensureBackupConfigSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info('backup_config')").all();
    if (!columns || columns.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_config (
          id TEXT PRIMARY KEY NOT NULL,
          provider TEXT NOT NULL UNIQUE,
          access_token_enc TEXT,
          username TEXT,
          avatar_url TEXT,
          repo_full_name TEXT,
          auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
          last_backup_at TEXT,
          last_backup_sha TEXT,
          last_warning TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL
        )
      `);
      return;
    }

    const names = new Set(columns.map((column) => column.name));

    if (!names.has("provider")) {
      db.exec(
        "ALTER TABLE backup_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'github'",
      );
      db.exec(
        "UPDATE backup_config SET provider = 'github' WHERE provider IS NULL OR provider = ''",
      );
    }
    if (!names.has("access_token_enc")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN access_token_enc TEXT");
    }
    if (!names.has("username")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN username TEXT");
    }
    if (!names.has("avatar_url")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN avatar_url TEXT");
    }
    if (!names.has("repo_full_name")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN repo_full_name TEXT");
    }
    if (!names.has("auto_backup_enabled")) {
      db.exec(
        "ALTER TABLE backup_config ADD COLUMN auto_backup_enabled INTEGER NOT NULL DEFAULT 1",
      );
      db.exec(
        "UPDATE backup_config SET auto_backup_enabled = 1 WHERE auto_backup_enabled IS NULL",
      );
    }
    if (!names.has("last_backup_at")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN last_backup_at TEXT");
    }
    if (!names.has("last_backup_sha")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN last_backup_sha TEXT");
    }
    if (!names.has("last_warning")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN last_warning TEXT");
    }
    if (!names.has("last_error")) {
      db.exec("ALTER TABLE backup_config ADD COLUMN last_error TEXT");
    }
    if (!names.has("created_at")) {
      db.exec(
        "ALTER TABLE backup_config ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))",
      );
      db.exec(
        "UPDATE backup_config SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''",
      );
    }
  } catch (err) {
    console.error("[db] Failed to ensure backup config schema:", err);
    throw err;
  }
}

function ensureTemplatesSchema(db) {
  try {
    const columns = db.prepare("PRAGMA table_info('templates')").all();
    if (!columns || columns.length === 0) {
      return; // BASE_SCHEMA creates it with correct defaults
    }

    // Check if existing table has the old schema (NOT NULL columns without DEFAULTs)
    // CR-SQLite requires DEFAULTs on all NOT NULL columns
    const needsMigration = columns.some(
      (c) =>
        (c.name === "name" ||
          c.name === "created_at" ||
          c.name === "updated_at") &&
        c.notnull === 1 &&
        c.dflt_value === null,
    );

    if (needsMigration) {
      db.exec(`
        ALTER TABLE templates RENAME TO templates_old;

        CREATE TABLE templates (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          title_pattern TEXT NOT NULL DEFAULT '',
          default_folder_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO templates SELECT * FROM templates_old;
        CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at DESC);
        DROP TABLE templates_old;
      `);
    }
  } catch (err) {
    console.error("[db] Failed to ensure templates schema:", err);
    throw err;
  }
}

const NOTE_REVISION_COLUMNS = `id, note_id, title, content_gzip, type, content_sha256,
  uncompressed_bytes, compressed_bytes, created_at, actor_user_id, actor_kind`;

const NOTE_REVISIONS_TABLE_SQL = `
  CREATE TABLE note_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL,
    title TEXT,
    content_gzip BLOB NOT NULL,
    type TEXT NOT NULL DEFAULT 'auto',
    content_sha256 TEXT NOT NULL,
    uncompressed_bytes INTEGER NOT NULL,
    compressed_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    actor_user_id TEXT,
    actor_kind TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );`;

/**
 * A rebuild of `note_revisions` that died after renaming the table leaves the
 * history in `note_revisions_old` while the schema bootstrap has since created
 * an empty `note_revisions`. Bring the rows back and remove the leftover.
 * Revisions of documents that no longer exist are not restored: they would
 * violate the cascade foreign key, and the cascade would have removed them.
 */
function recoverInterruptedRevisionRebuild(db) {
  const leftover = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'note_revisions_old'")
    .get();
  if (!leftover) return;

  const oldColumns = new Set(
    db.prepare("PRAGMA table_info('note_revisions_old')").all().map((column) => column.name),
  );
  const source = NOTE_REVISION_COLUMNS.split(",")
    .map((name) => name.trim())
    .map((name) => (oldColumns.has(name) ? name : `NULL AS ${name}`))
    .join(", ");

  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO note_revisions (${NOTE_REVISION_COLUMNS})
      SELECT ${source} FROM note_revisions_old
      WHERE note_id IN (SELECT id FROM notes);
      DROP TABLE note_revisions_old;
    `);
  })();
  console.warn("[db] Recovered note revisions left behind by an interrupted table rebuild.");
}

export function ensureNoteRevisionsSchema(db) {
  try {
    recoverInterruptedRevisionRebuild(db);
    const cols = db.prepare("PRAGMA table_info('note_revisions')").all();
    if (!cols || cols.length === 0) {
      // BASE_SCHEMA creates the table with the correct (cascade) FK and the
      // actor columns already.
      return;
    }

    const columnNames = new Set(cols.map((c) => c.name));
    const hasActorColumns =
      columnNames.has("actor_user_id") && columnNames.has("actor_kind");

    // SQLite does not expose FK actions via PRAGMA table_info; inspect
    // foreign_key_list to see if the existing FK still has NO ACTION.
    const fks = db.prepare("PRAGMA foreign_key_list('note_revisions')").all();
    const needsFkMigration = fks.some(
      (f) =>
        f.table === "notes" && (f.on_delete || "NO ACTION") === "NO ACTION",
    );

    if (!needsFkMigration && hasActorColumns) return;

    if (!needsFkMigration && !hasActorColumns) {
      // Already has the cascade FK from an earlier repair/initializer run;
      // just add the two backend-only actor columns in place. Each is added
      // only if missing: a process that died between the two statements
      // otherwise fails here on "duplicate column" at every later open, and
      // that user's database can never be opened again.
      if (!columnNames.has("actor_user_id")) {
        db.exec("ALTER TABLE note_revisions ADD COLUMN actor_user_id TEXT");
      }
      if (!columnNames.has("actor_kind")) {
        db.exec("ALTER TABLE note_revisions ADD COLUMN actor_kind TEXT");
      }
      return;
    }

    // Standard SQLite pattern for changing FK actions: turn FK enforcement off,
    // rebuild the table, then re-enable. crsqlite's merge_delete deletes the
    // parent `notes` row mid-transaction during sync, so a non-cascade FK to a
    // CRR parent table breaks sync transactions whenever the parent is
    // deleted before the application-level cleanup runs. The new table
    // definition always includes the actor columns; an explicit source
    // column list keeps the INSERT working whether or not the old table
    // already had them (SELECT * would break once the column counts
    // diverge).
    const sourceColumns = [
      "id",
      "note_id",
      "title",
      "content_gzip",
      "type",
      "content_sha256",
      "uncompressed_bytes",
      "compressed_bytes",
      "created_at",
      hasActorColumns ? "actor_user_id" : "NULL AS actor_user_id",
      hasActorColumns ? "actor_kind" : "NULL AS actor_kind",
    ].join(", ");

    // SQLite ignores PRAGMA foreign_keys inside a transaction, so it is
    // switched around one. Everything between runs as a single transaction: a
    // process that dies midway leaves the original table as it was. Run as
    // separate statements, a death after the rename left `note_revisions_old`
    // behind, the next start created an empty `note_revisions`, and the
    // revision history was gone without an error.
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          ALTER TABLE note_revisions RENAME TO note_revisions_old;
          ${NOTE_REVISIONS_TABLE_SQL}
          INSERT INTO note_revisions (${NOTE_REVISION_COLUMNS})
          SELECT ${sourceColumns} FROM note_revisions_old;
          -- The renamed table still owns the old named indexes, which would make
          -- CREATE INDEX IF NOT EXISTS silently skip re-creation. Drop them first.
          DROP INDEX IF EXISTS idx_note_revisions_note_created;
          DROP INDEX IF EXISTS idx_note_revisions_note_type_created;
          CREATE INDEX IF NOT EXISTS idx_note_revisions_note_created
            ON note_revisions(note_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_note_revisions_note_type_created
            ON note_revisions(note_id, type, created_at DESC);
          DROP TABLE note_revisions_old;
        `);
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  } catch (err) {
    console.error("[db] Failed to ensure note_revisions schema:", err);
    throw err;
  }
}

export function initializeContentDb(db, kind) {
  if (kind !== "user" && kind !== "space") {
    throw new Error("Content database kind must be user or space.");
  }

  db.exec(CONTENT_SCHEMA_METADATA);
  const recorded = db.prepare(
    "SELECT kind, version FROM application_schema WHERE singleton = 1",
  ).get();
  if (recorded && recorded.kind !== kind) {
    throw new Error(`Content database kind mismatch: expected ${kind}, found ${recorded.kind}.`);
  }
  if (Number(recorded?.version ?? 0) > CONTENT_SCHEMA_VERSION) {
    throw new Error("Content database schema is newer than this server supports.");
  }

  db.exec(BASE_SCHEMA);
  if (kind === "user") db.exec(USER_LOCAL_SCHEMA);
  if (kind === "space") db.exec(SPACE_LOCAL_SCHEMA);
  ensureNotesSchema(db);
  ensureImagesSchema(db);
  ensureGlobalsSchema(db);
  if (kind === "user") ensureBackupConfigSchema(db);
  ensureTemplatesSchema(db);
  ensureNoteRevisionsSchema(db);
  ensureCrr(db);

  db.prepare(
    `INSERT INTO application_schema (singleton, kind, version, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(singleton) DO UPDATE SET
       kind = excluded.kind,
       version = excluded.version,
       updated_at = excluded.updated_at`,
  ).run(kind, CONTENT_SCHEMA_VERSION, new Date().toISOString());
}

function maskDbKey(dbKey) {
  const value = String(dbKey ?? "");
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}…${value.slice(-2)}`;
}

export function getDb(dbKey) {
  const resolved = resolveDbPath(dbKey);
  if (dbConnections.has(resolved.dbKey)) {
    dbLastUsed.set(resolved.dbKey, Date.now());
    return dbConnections.get(resolved.dbKey);
  }

  evictIdleDbConnections({ limit: DB_CACHE_LIMIT - 1 });
  fs.mkdirSync(resolved.root, { recursive: true });
  const db = new Database(resolved.dbPath);

  try {
    db.loadExtension(resolveCrsqlitePath());
    initializeContentDb(db, resolved.kind);
    db.pragma("journal_mode = wal");
    db.pragma("synchronous = normal");
  } catch (error) {
    try {
      db.close();
    } catch (closeError) {
      console.error("[db] Failed to close database after initialization failure:", closeError);
    }
    throw error;
  }

  dbConnections.set(resolved.dbKey, db);
  dbLastUsed.set(resolved.dbKey, Date.now());
  return db;
}

export function getUserDb(userId) {
  return getDb(`user:${userId}`);
}

/** Remove and close one cached content connection without affecting other databases. */
export function invalidateDb(dbKey, expectedDb = null, reason = "unknown") {
  const { dbKey: canonicalKey } = parseDbKey(dbKey);
  const cachedDb = dbConnections.get(canonicalKey);
  if (!cachedDb || (expectedDb && cachedDb !== expectedDb)) {
    console.info("[db]", JSON.stringify({
      event: "sync_db_connection_invalidated",
      dbKey: maskDbKey(canonicalKey),
      reason,
      cached: false,
      closed: false,
    }));
    return false;
  }

  dbConnections.delete(canonicalKey);
  dbLastUsed.delete(canonicalKey);
  let closed = false;
  try {
    cachedDb.close();
    closed = true;
  } catch (error) {
    console.error("[db] Failed to close invalidated connection:", error);
  }
  console.warn("[db]", JSON.stringify({
    event: "sync_db_connection_invalidated",
    dbKey: maskDbKey(canonicalKey),
    reason,
    cached: true,
    closed,
  }));
  return true;
}

export function invalidateUserDb(userId, expectedDb = null, reason = "unknown") {
  return invalidateDb(`user:${userId}`, expectedDb, reason);
}

/** Reopen a content database if CR-SQLite reports a non-zero internal sync bit. */
export function getHealthyDb(dbKey, operation = "unknown") {
  let db = getDb(dbKey);
  let health;
  try {
    health = db.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get();
  } catch (error) {
    invalidateDb(dbKey, db, `health-check-failure:${operation}`);
    db = getDb(dbKey);
    health = db.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get();
  }

  const syncBit = Number(health?.sync_bit ?? 0);
  if (syncBit !== 0) {
    console.warn("[db]", JSON.stringify({
      event: "crsqlite_connection_health_reset",
      dbKey: maskDbKey(dbKey),
      operation,
      syncBit,
    }));
    invalidateDb(dbKey, db, `unhealthy-sync-bit:${operation}`);
    db = getDb(dbKey);
    const reopenedBit = Number(
      db.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get()?.sync_bit ?? 0,
    );
    if (reopenedBit !== 0) {
      invalidateDb(dbKey, db, `reopen-health-check-failure:${operation}`);
      throw new Error("CR-SQLite connection health check failed");
    }
  }
  return db;
}

export function getHealthyUserDb(userId, operation = "unknown") {
  return getHealthyDb(`user:${userId}`, operation);
}

export function getDbSizeBytes(dbKey) {
  const { dbPath } = resolveDbPath(dbKey);
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].reduce((total, filePath) => {
    try {
      if (fs.existsSync(filePath)) return total + fs.statSync(filePath).size;
    } catch (error) {
      console.error(`[db] Failed to read file size for ${filePath}:`, error);
    }
    return total;
  }, 0);
}

export function getUserDbSizeBytes(userId) {
  if (!userId) return 0;
  return getDbSizeBytes(`user:${userId}`);
}

/** Delete one validated content database and its SQLite sidecars. */
export function deleteDb(dbKey) {
  const resolved = resolveDbPath(dbKey);
  invalidateDb(resolved.dbKey, null, "database-delete");
  const removed = [];
  for (const filePath of [resolved.dbPath, `${resolved.dbPath}-wal`, `${resolved.dbPath}-shm`]) {
    try {
      fs.unlinkSync(filePath);
      removed.push(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { dbKey: resolved.dbKey, removedCount: removed.length };
}

const AUTH_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    email_verified_at TEXT
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_email_verifications_user
    ON email_verifications(user_id, created_at);
`;

const SPACES_MIGRATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS spaces_schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

const SPACES_SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'pending_delete')),
    delete_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS space_members (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor'
      CHECK (role IN ('owner', 'editor')),
    invited_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS space_invites (
    token_hash TEXT PRIMARY KEY NOT NULL,
    space_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role = 'editor'),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_space_members_one_owner
    ON space_members(space_id) WHERE role = 'owner';
  CREATE TABLE IF NOT EXISTS space_user_versions (
    user_id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
`;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().some((row) => row.name === column);
}

function addColumnIfMissing(db, table, column, definition) {
  if (hasColumn(db, table, column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    // Another server/test worker may have completed the idempotent migration
    // after this connection read the version marker but before it acquired
    // the schema write lock. Only the now-present target column makes that
    // race a success; every other migration failure still propagates.
    if (!hasColumn(db, table, column)) throw error;
  }
}

function migrateSpacesSchemaV2(db) {
  addColumnIfMissing(db, "space_invites", "invite_id", "TEXT");
  addColumnIfMissing(db, "space_invites", "revoked_at", "TEXT");
  const missingIds = db.prepare(
    "SELECT token_hash AS tokenHash FROM space_invites WHERE invite_id IS NULL",
  ).all();
  const setId = db.prepare(
    "UPDATE space_invites SET invite_id = ? WHERE token_hash = ? AND invite_id IS NULL",
  );
  for (const row of missingIds) setId.run(randomUUID(), row.tokenHash);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_space_invites_id
      ON space_invites(invite_id);
    CREATE INDEX IF NOT EXISTS idx_space_invites_space_pending
      ON space_invites(space_id, used_at, revoked_at, expires_at);
  `);
}

function migrateSpacesSchemaV3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_transfers (
      id TEXT PRIMARY KEY NOT NULL,
      actor_user_id TEXT NOT NULL,
      source_db_key TEXT NOT NULL,
      destination_db_key TEXT NOT NULL,
      source_note_id TEXT NOT NULL,
      destination_note_id TEXT NOT NULL,
      destination_folder_id TEXT,
      source_updated_at TEXT,
      source_content_sha256 TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN (
          'checkpointed',
          'copying_images',
          'copying_document',
          'destination_confirmed',
          'recoverable_duplicate',
          'kept_both',
          'source_deleted',
          'complete'
        )),
      image_map_json TEXT NOT NULL DEFAULT '{}',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      destination_confirmed_at TEXT,
      source_deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_space_transfers_actor_status
      ON space_transfers(actor_user_id, status, updated_at DESC);
  `);
}

export function getAuthDb() {
  const key = "_auth";
  if (dbConnections.has(key)) return dbConnections.get(key);

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const dbPath = path.join(DB_DIR, "_users.db");
  const db = new Database(dbPath);
  db.exec(AUTH_SCHEMA);
  db.pragma(`busy_timeout = ${METADATA_DB_BUSY_TIMEOUT_MS}`);
  enableWriteAheadLog(db, "_users.db");
  // When the address was proven to reach the account holder (accountEmail.js).
  // Older builds ignore the column. If it cannot be added right now the service
  // still starts, and every account simply counts as unverified until it can.
  try {
    addColumnIfMissing(db, "users", "email_verified_at", "TEXT");
  } catch (error) {
    console.warn(`[db] could not add users.email_verified_at (${error?.code || "unknown"}); will retry at next start.`);
  }

  dbConnections.set(key, db);
  return db;
}

/**
 * Put a metadata database in WAL mode, as the content databases already are.
 * In WAL mode a reader never waits for a writer and a writer never waits for a
 * reader, so logins, token refreshes and WebSocket handshakes (all reads) are
 * unaffected by a backup or an operator session holding the file. Only a
 * second WRITER can still make this process wait, and then only for
 * `busy_timeout`.
 *
 * The mode is stored in the file and survives restarts and older builds.
 * Switching needs the file to itself for an instant; if something else has it
 * open the switch is skipped and tried again at the next start, because a
 * database in the old mode still works and must not stop the service starting.
 */
function enableWriteAheadLog(db, label) {
  try {
    const mode = db.pragma("journal_mode = wal", { simple: true });
    if (String(mode).toLowerCase() !== "wal") {
      console.warn(`[db] ${label} stayed in ${mode} journal mode; will retry at next start.`);
    }
  } catch (error) {
    console.warn(`[db] could not switch ${label} to WAL (${error?.code || "unknown"}); will retry at next start.`);
  }
}

export function initializeSpacesDb(db) {
  db.exec(SPACES_MIGRATION_SCHEMA);
  const currentVersion = Number(
    db.prepare("SELECT MAX(version) AS version FROM spaces_schema_migrations").get()?.version ?? 0,
  );
  if (currentVersion > SPACES_SCHEMA_VERSION) {
    throw new Error("Shared-space metadata schema is newer than this server supports.");
  }
  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(SPACES_SCHEMA_V1);
      db.prepare(
        // Multiple server/test workers can initialize the metadata file at the
        // same time. The schema DDL is idempotent, so its version marker must
        // be idempotent too after a competing worker commits first.
        "INSERT OR IGNORE INTO spaces_schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(1, new Date().toISOString());
    })();
  }
  if (currentVersion < 2) {
    db.transaction(() => {
      migrateSpacesSchemaV2(db);
      db.prepare(
        "INSERT OR IGNORE INTO spaces_schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(2, new Date().toISOString());
    })();
  }
  if (currentVersion < 3) {
    db.transaction(() => {
      migrateSpacesSchemaV3(db);
      db.prepare(
        "INSERT OR IGNORE INTO spaces_schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(3, new Date().toISOString());
    })();
  }
  // Whether a transfer is a copy (1) or a move (0). Added without a schema
  // version on purpose: a build that does not know the column still opens this
  // database, and every row it writes gets the default, a move, which is what
  // it does. A version bump would make that build refuse to start.
  addColumnIfMissing(db, "space_transfers", "keep_source", "INTEGER NOT NULL DEFAULT 0");
}

export function getSpacesDb() {
  const key = "_spaces";
  if (dbConnections.has(key)) return dbConnections.get(key);

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(path.join(DB_DIR, "_spaces.db"));
  db.pragma(`busy_timeout = ${METADATA_DB_BUSY_TIMEOUT_MS}`);
  try {
    initializeSpacesDb(db);
  } catch (error) {
    db.close();
    throw error;
  }
  db.pragma("journal_mode = wal");
  db.pragma("synchronous = normal");
  dbConnections.set(key, db);
  return db;
}

export function initDb() {
  getAuthDb();
  try {
    getSpacesDb();
  } catch (error) {
    // Shared spaces are optional and off by default; personal Documents do not
    // use this database at all. A file that cannot be created or migrated must
    // not keep every user out. It is left unopened, so anything that needs it
    // tries again and fails closed for that request only.
    console.error("[db] Shared-space metadata database is unavailable:", error?.code || error?.message || "unknown");
  }
  if (process.env.LIVE_SESSIONS_ENABLED === "true") {
    for (const dbKey of listUuidDatabaseFiles(SPACES_DB_DIR, "space")) {
      try {
        // Open only to run the migration, then close again. Keeping every
        // space open from boot onwards is how a server with many spaces ran
        // out of file descriptors before it had served a request.
        getDb(dbKey);
        releaseDb(dbKey);
      } catch (error) {
        // Keep the service available for healthy spaces, but leave this key
        // uncached: collab admission will retry initialization and fail closed
        // until its ordered local recovery migration succeeds.
        console.error("[db] Live-session space migration failed:", error?.code || error?.message || "unknown");
      }
    }
  }
  console.info("Authentication and shared-space metadata databases initialized.");
}

function listUuidDatabaseFiles(directory, kind) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => entry.name.slice(0, -3))
    .filter((id) => UUID_PATTERN.test(id))
    .map((id) => `${kind}:${id.toLowerCase()}`);
}

/**
 * Compatibility name retained for background jobs. Entries are canonical
 * database keys so user and space databases cannot collide on the same UUID.
 */
export function listUserDbIds() {
  return [
    ...listUuidDatabaseFiles(DB_DIR, "user"),
    ...listUuidDatabaseFiles(SPACES_DB_DIR, "space"),
  ].sort();
}

export const listDbKeys = listUserDbIds;

/**
 * Close all database connections
 */
export function closeAllConnections() {
  for (const [key, db] of dbConnections.entries()) {
    try {
      db.close();
    } catch (e) {
      console.error(`Error closing connection for ${key}:`, e);
    }
  }
  dbConnections.clear();
  dbLastUsed.clear();
}

/**
 * Clear connection cache without closing (for testing)
 */
export function clearConnectionCache() {
  dbConnections.clear();
  dbLastUsed.clear();
}

function resolveTestDatabase(identifier) {
  if (typeof identifier !== "string") throw new TypeError("Test database identifier must be a string.");
  if (identifier.includes(":")) return resolveDbPath(identifier);
  if (UUID_PATTERN.test(identifier)) return resolveDbPath(`user:${identifier}`);
  if (!/^[a-z0-9_-]+$/i.test(identifier)) throw new Error("Unsafe test database identifier.");
  return {
    kind: "user",
    id: identifier,
    dbKey: `test:${identifier}`,
    root: DB_DIR,
    dbPath: path.join(DB_DIR, `${identifier}.db`),
  };
}

/** Create a content database for tests. Canonical dbKeys are preferred. */
export function getTestDb(identifier, options = {}) {
  const { inMemory = false } = options;
  const resolved = resolveTestDatabase(identifier);
  if (dbConnections.has(resolved.dbKey)) return dbConnections.get(resolved.dbKey);

  if (!inMemory) fs.mkdirSync(resolved.root, { recursive: true });
  const db = new Database(inMemory ? ":memory:" : resolved.dbPath);
  try {
    db.loadExtension(resolveCrsqlitePath());
    initializeContentDb(db, resolved.kind);
    db.pragma("journal_mode = wal");
    db.pragma("synchronous = normal");
  } catch (error) {
    try {
      db.close();
    } catch {
      // The original initialization error is more actionable.
    }
    throw error;
  }

  dbConnections.set(resolved.dbKey, db);
  return db;
}

export function deleteTestDb(identifier) {
  const resolved = resolveTestDatabase(identifier);
  if (dbConnections.has(resolved.dbKey)) {
    try {
      dbConnections.get(resolved.dbKey).close();
    } catch (error) {
      console.error(`Error closing database for ${resolved.dbKey}:`, error);
    }
    dbConnections.delete(resolved.dbKey);
    dbLastUsed.delete(resolved.dbKey);
  }

  [resolved.dbPath, `${resolved.dbPath}-wal`, `${resolved.dbPath}-shm`].forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Error deleting ${filePath}:`, error);
    }
  });
}
