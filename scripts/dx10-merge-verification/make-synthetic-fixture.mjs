/**
 * Build a synthetic CR-SQLite database for the DX-10 step 8 comparison.
 *
 * Run this inside the OLD arm (better-sqlite3 9.6.0 / SQLite 3.45.3). That is the whole
 * point: the risk DX-10 §2.4 describes is CR-SQLite state written by SQLite 3.45.3 being
 * read and merged by 3.53.2, so the fixture has to be *written* by the old amalgamation for
 * the comparison to mean anything. A fixture generated on the new stack tests nothing.
 *
 * The shape is derived from what production actually looks like in aggregate — many small
 * notes, a folder tree, images, accumulated deletions — not from any user's content. No
 * production data is read or required.
 *
 * Usage:  node make-synthetic-fixture.mjs <output-path> [--notes N] [--seed S]
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadDatabaseDriver() {
  const candidates = [
    () => require("better-sqlite3"),
    () => createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3"),
  ];
  for (const candidate of candidates) {
    try {
      return candidate();
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Could not resolve better-sqlite3 for the fixture generator");
}

// Mirrors backend/api-service/db.js BASE_SCHEMA for the CRR tables. Kept inline rather than
// imported because this runs in a standalone image that has no backend checkout.
const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL, name TEXT, email TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT, name TEXT, parent_id TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT, folder_id TEXT, title TEXT,
    content TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT, filename TEXT, mime_type TEXT, path TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL, value TEXT
  );
  CREATE TABLE IF NOT EXISTS globals (
    key TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), display_key TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '', title_pattern TEXT NOT NULL DEFAULT '',
    default_folder_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const CRR_TABLES = ["users", "folders", "notes", "images", "settings", "globals", "templates"];

/** Deterministic PRNG so a given seed always yields a byte-identical fixture. */
function makeRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function parseArgs(argv) {
  const options = { output: argv[2], notes: 400, seed: 20260816 };
  for (let i = 3; i < argv.length; i += 2) {
    if (argv[i] === "--notes") options.notes = Number(argv[i + 1]);
    else if (argv[i] === "--seed") options.seed = Number(argv[i + 1]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  if (!options.output) throw new Error("usage: make-synthetic-fixture.mjs <output-path>");
  return options;
}

function main() {
  const { output, notes: noteCount, seed } = parseArgs(process.argv);
  const random = makeRandom(seed);

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${output}${suffix}`, { force: true });
  }

  const Database = loadDatabaseDriver();
  const db = new Database(output);
  db.loadExtension(process.env.CRSQLITE_EXT_PATH);
  db.pragma("journal_mode = wal");
  db.exec(BASE_SCHEMA);
  for (const table of CRR_TABLES) db.prepare("SELECT crsql_as_crr(?)").get(table);

  const timestamp = (n) => new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString();
  const userId = "synthetic-user-0000-0000-000000001";

  db.prepare("INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)").run(
    userId, "Synthetic User", "synthetic@example.invalid", timestamp(0),
  );

  // A folder tree three deep, so clock rows exist at several parent_id depths.
  const folderIds = [];
  const insertFolder = db.prepare(
    "INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (let i = 0; i < 24; i += 1) {
    const id = `synthetic-folder-${String(i).padStart(20, "0")}`;
    const parent = i < 4 ? null : folderIds[Math.floor(random() * Math.min(i, 8))];
    insertFolder.run(id, userId, `Folder ${i}`, parent, timestamp(i));
    folderIds.push(id);
  }

  // Notes, each written then edited a few times so col_version climbs the way it does in a
  // real database rather than sitting at 1 everywhere.
  const insertNote = db.prepare(
    `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateNote = db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?");
  const noteIds = [];
  for (let i = 0; i < noteCount; i += 1) {
    const id = `synthetic-note-${String(i).padStart(22, "0")}`;
    insertNote.run(
      id, userId, folderIds[Math.floor(random() * folderIds.length)],
      `Note ${i}`, `# Note ${i}\n\n${"body ".repeat(20)}`, timestamp(i), timestamp(i),
    );
    noteIds.push(id);
    const edits = Math.floor(random() * 4);
    for (let e = 0; e < edits; e += 1) {
      updateNote.run(`# Note ${i}\n\nrevision ${e}`, timestamp(i + e + 1), id);
    }
  }

  const insertImage = db.prepare(
    `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const imageIds = [];
  for (let i = 0; i < 60; i += 1) {
    const id = `synthetic-image-${String(i).padStart(21, "0")}`;
    insertImage.run(
      id, userId, `image-${i}.png`, "image/png", `${id}.png`,
      1024 + Math.floor(random() * 100_000), String(i).padStart(64, "0"), timestamp(i),
    );
    imageIds.push(id);
  }

  // Accumulated deletions. This is the part that matters most: it leaves `-1` tombstone
  // sentinels written by the old SQLite, which is precisely the state the new amalgamation
  // has to read back correctly.
  const deleteNote = db.prepare("DELETE FROM notes WHERE id = ?");
  for (let i = 0; i < Math.floor(noteCount / 8); i += 1) {
    deleteNote.run(noteIds[Math.floor(random() * noteIds.length)]);
  }
  const deleteImage = db.prepare("DELETE FROM images WHERE id = ?");
  for (let i = 0; i < 10; i += 1) {
    deleteImage.run(imageIds[i]);
  }

  const summary = {
    output,
    seed,
    sqliteVersion: db.prepare("SELECT sqlite_version() AS v").get().v,
    betterSqlite3Version: require("better-sqlite3/package.json").version,
    dbVersion: Number(db.prepare("SELECT crsql_db_version() AS v").get().v),
    notes: db.prepare("SELECT COUNT(*) AS n FROM notes").get().n,
    images: db.prepare("SELECT COUNT(*) AS n FROM images").get().n,
    changeRows: db.prepare("SELECT COUNT(*) AS n FROM crsql_changes").get().n,
  };

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
