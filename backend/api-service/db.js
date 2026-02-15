// /app/db.js  (api-service)
// ---------------------------------
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, 'data');

const dbConnections = new Map();

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
`;

const CRR_TABLES = ['users', 'folders', 'notes', 'images', 'settings', 'globals'];

/**
 * Recursively walk a directory and return all files.
 */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Try to find the crsqlite shared object/binary.
 * Override with CRSQLITE_EXT_PATH if you know it.
 */
function resolveCrsqlitePath() {
  const env = process.env.CRSQLITE_EXT_PATH;
  if (env && fs.existsSync(env)) return env;

  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('@vlcn.io/crsqlite/package.json'));
  } catch (e) {
    throw new Error(
      "Cannot resolve '@vlcn.io/crsqlite'. Is it installed in this service?"
    );
  }

  const candidates = walk(pkgDir).filter((p) =>
    /crsqlite\.(node|so|dylib|dll)$/.test(p)
  );

  if (candidates.length > 0) {
    // Prefer Release over Debug if both exist
    const release = candidates.find((p) => /build\/Release\//.test(p));
    return release || candidates[0];
  }

  throw new Error(
    `Could not locate crsqlite binary. Looked under ${pkgDir}. ` +
    `Set CRSQLITE_EXT_PATH to the absolute path of crsqlite.(node|so|dylib|dll).`
  );
}

function ensureCrr(db) {
  for (const t of CRR_TABLES) {
    try {
      db.prepare('SELECT crsql_as_crr(?)').get(t);
    } catch {
      // ignore if already a CRR or extension issue
    }
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

    const names = new Set(columns.map(c => c.name));
    const indexes = db.prepare("PRAGMA index_list('globals')").all();
    const hasExtraUnique = (indexes || []).some(idx => idx?.unique && idx?.origin !== 'pk');

    if (hasExtraUnique) {
      const selectId = names.has('id') ? 'id' : 'key';
      const selectCreated = names.has('created_at') ? 'created_at' : "datetime('now')";
      const selectUpdated = names.has('updated_at') ? 'updated_at' : "datetime('now')";
      const selectDisplay = names.has('display_key') ? 'display_key' : 'key';

      db.exec('BEGIN');
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
        db.exec('DROP TABLE globals');
        db.exec('ALTER TABLE globals_new RENAME TO globals');
        db.exec("SELECT crsql_as_crr('globals')");
        db.exec('COMMIT');
        return;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    if (!names.has('id')) {
      db.exec("ALTER TABLE globals ADD COLUMN id TEXT NOT NULL DEFAULT ''");
      db.exec('UPDATE globals SET id = key WHERE id IS NULL');
    }
    if (!names.has('created_at')) {
      db.exec("ALTER TABLE globals ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
      db.exec("UPDATE globals SET created_at = datetime('now') WHERE created_at IS NULL");
    }
    if (!names.has('updated_at')) {
      db.exec("ALTER TABLE globals ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
      db.exec("UPDATE globals SET updated_at = datetime('now') WHERE updated_at IS NULL");
    }
    if (!names.has('display_key')) {
      db.exec("ALTER TABLE globals ADD COLUMN display_key TEXT NOT NULL DEFAULT ''");
      db.exec('UPDATE globals SET display_key = key WHERE display_key IS NULL');
    }
    db.exec("SELECT crsql_as_crr('globals')");
  } catch (err) {
    console.error('[db] Failed to ensure globals schema:', err);
  }
}

export function getUserDb(userId) {
  if (dbConnections.has(userId)) return dbConnections.get(userId);

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const dbPath = path.join(DB_DIR, `${userId}.db`);
  const db = new Database(dbPath);

  // Load CR-SQLite
  try {
    const extPath = resolveCrsqlitePath();
    db.loadExtension(extPath);
  } catch (e) {
    console.error('Failed to load crsqlite extension:', e);
    throw e;
  }

  db.exec(BASE_SCHEMA);
  ensureGlobalsSchema(db);
  ensureCrr(db);

  db.pragma('journal_mode = wal');
  db.pragma('synchronous = normal');

  dbConnections.set(userId, db);
  return db;
}

export function getUserDbSizeBytes(userId) {
  if (!userId) return 0;

  const dbPath = path.join(DB_DIR, `${userId}.db`);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  return [dbPath, walPath, shmPath].reduce((total, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        return total + fs.statSync(filePath).size;
      }
    } catch (error) {
      console.error(`[db] Failed to read file size for ${filePath}:`, error);
    }
    return total;
  }, 0);
}

const AUTH_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

export function getAuthDb() {
  const key = '_auth';
  if (dbConnections.has(key)) return dbConnections.get(key);

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const dbPath = path.join(DB_DIR, '_users.db');
  const db = new Database(dbPath);
  db.exec(AUTH_SCHEMA);

  dbConnections.set(key, db);
  return db;
}

export function initDb() {
  getAuthDb();
  console.log('Authentication database initialized.');
}

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
}

/**
 * Clear connection cache without closing (for testing)
 */
export function clearConnectionCache() {
  dbConnections.clear();
}

/**
 * Create a test database (for testing purposes)
 * @param {string} userId - User ID for the test database
 * @param {Object} options - Options
 * @param {boolean} options.inMemory - Use in-memory database
 * @returns {Database} Database instance
 */
export function getTestDb(userId, options = {}) {
  const { inMemory = false } = options;

  if (dbConnections.has(userId)) return dbConnections.get(userId);

  if (!inMemory && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const dbPath = inMemory ? ':memory:' : path.join(DB_DIR, `${userId}.db`);
  const db = new Database(dbPath);

  // Load CR-SQLite
  try {
    const extPath = resolveCrsqlitePath();
    db.loadExtension(extPath);
  } catch (e) {
    console.error('Failed to load crsqlite extension:', e);
    throw e;
  }

  db.exec(BASE_SCHEMA);
  ensureCrr(db);

  db.pragma('journal_mode = wal');
  db.pragma('synchronous = normal');

  dbConnections.set(userId, db);
  return db;
}

/**
 * Delete a test database (for testing purposes)
 * @param {string} userId - User ID for the test database
 */
export function deleteTestDb(userId) {
  // Close connection if exists
  if (dbConnections.has(userId)) {
    try {
      dbConnections.get(userId).close();
    } catch (e) {
      console.error(`Error closing database for ${userId}:`, e);
    }
    dbConnections.delete(userId);
  }

  // Delete database files
  const dbPath = path.join(DB_DIR, `${userId}.db`);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  [dbPath, walPath, shmPath].forEach(filePath => {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error(`Error deleting ${filePath}:`, e);
      }
    }
  });
}