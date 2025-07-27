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
    data BLOB,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
`;

const CRR_TABLES = ['users', 'folders', 'notes', 'images', 'settings'];

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
    ensureCrr(db);

    db.pragma('journal_mode = wal');
    db.pragma('synchronous = normal');

    dbConnections.set(userId, db);
    return db;
}

const AUTH_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
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
