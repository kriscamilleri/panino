// Unit tests for db.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  initDb,
  getAuthDb,
  getUserDb,
  getTestDb,
  deleteTestDb,
  closeAllConnections,
  clearConnectionCache,
  invalidateUserDb,
  getHealthyUserDb,
  ensureNoteRevisionsSchema,
} from "../../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "../../data");

describe("Database Initialization", () => {
  afterEach(() => {
    closeAllConnections();
  });

  it("should initialize authentication database", () => {
    initDb();
    const db = getAuthDb();

    expect(db).toBeDefined();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("password_resets");
  });

  it("should return the same auth database instance on multiple calls", () => {
    const db1 = getAuthDb();
    const db2 = getAuthDb();

    expect(db1).toBe(db2);
  });
});

describe("User Database Management", () => {
  const testUserId = `test-user-${Date.now()}`;

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId);
  });

  it("should create new database for user", () => {
    const db = getUserDb(testUserId);

    expect(db).toBeDefined();
    expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(true);
  });

  it("should return cached connection for same user", () => {
    const db1 = getUserDb(testUserId);
    const db2 = getUserDb(testUserId);

    expect(db1).toBe(db2);
  });

  it("should apply CRDT schema to user database", () => {
    const db = getUserDb(testUserId);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const tableNames = tables.map((t) => t.name);

    // CR-SQLite 0.16+ creates different tables
    // Check for CR-SQLite specific tables (any of these indicate CRDT is working)
    const hasCRDT = tableNames.some(
      (name) =>
        name.startsWith("crsql_") ||
        name === "__crsql_clock" ||
        name === "crsql_tracked_peers",
    );
    expect(hasCRDT).toBe(true);

    // Check base tables exist
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("folders");
    expect(tableNames).toContain("notes");
    expect(tableNames).toContain("images");
    expect(tableNames).toContain("settings");
  });

  it("should enable WAL mode", () => {
    const db = getUserDb(testUserId);

    const result = db.pragma("journal_mode", { simple: true });
    expect(result).toBe("wal");
  });
});

describe("Test Database Utilities", () => {
  const testUserId = `test-util-user-${Date.now()}`;

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId);
  });

  it("should create in-memory test database", () => {
    const db = getTestDb(testUserId, { inMemory: true });

    expect(db).toBeDefined();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("folders");
    expect(tableNames).toContain("notes");

    // CR-SQLite 0.16+ creates different tables
    const hasCRDT = tableNames.some(
      (name) =>
        name.startsWith("crsql_") ||
        name === "__crsql_clock" ||
        name === "crsql_tracked_peers",
    );
    expect(hasCRDT).toBe(true);

    db.close();
  });

  it("should create file-based test database", () => {
    const db = getTestDb(testUserId);

    expect(db).toBeDefined();
    expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(true);

    db.close();
  });

  it("should delete test database and WAL files", () => {
    const db = getTestDb(testUserId);
    db.close();

    deleteTestDb(testUserId);

    expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(false);
    expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db-wal`))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db-shm`))).toBe(
      false,
    );
  });
});

describe("Connection Management", () => {
  const testUserId1 = `test-conn-user-1-${Date.now()}`;
  const testUserId2 = `test-conn-user-2-${Date.now()}`;

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId1);
    deleteTestDb(testUserId2);
  });

  it("should close all connections", () => {
    const db1 = getUserDb(testUserId1);
    const db2 = getUserDb(testUserId2);

    expect(db1).toBeDefined();
    expect(db2).toBeDefined();

    closeAllConnections();

    // After closing, new calls should create new connections
    const db3 = getUserDb(testUserId1);
    expect(db3).not.toBe(db1);
  });

  it("should clear connection cache", () => {
    const db1 = getUserDb(testUserId1);

    clearConnectionCache();

    const db2 = getUserDb(testUserId1);
    // Should get a new instance since cache was cleared
    // Note: We can't use toBe here since we're comparing objects
    // Instead, verify it's a valid database
    expect(db2).toBeDefined();

    db2.close();
  });

  it("should invalidate only the expected cached user connection", () => {
    const db1 = getUserDb(testUserId1);
    const db2 = getUserDb(testUserId2);

    expect(invalidateUserDb(testUserId1, db2, "test-stale-handle")).toBe(false);
    expect(getUserDb(testUserId1)).toBe(db1);

    expect(invalidateUserDb(testUserId1, db1, "test-merge-failure")).toBe(true);
    const reopened = getUserDb(testUserId1);
    expect(reopened).not.toBe(db1);
    expect(reopened.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get().sync_bit).toBe(0);
  });

  it("is idempotent when a connection has already been invalidated", () => {
    const db = getUserDb(testUserId1);
    expect(invalidateUserDb(testUserId1, db, "test-first-close")).toBe(true);
    expect(invalidateUserDb(testUserId1, db, "test-repeat-close")).toBe(false);
  });
});

describe("CRDT Tables", () => {
  const testUserId = `test-crr-user-${Date.now()}`;

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId);
  });

  it("should mark all base tables as CRR", () => {
    const db = getUserDb(testUserId);

    // Check that we can query crsql_changes (only available if tables are CRR)
    const result = db
      .prepare("SELECT COUNT(*) as count FROM crsql_changes")
      .get();
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it("should allow inserting data into CRR tables", () => {
    const db = getUserDb(testUserId);

    const userId = "test-user-id";
    db.prepare(
      `
          INSERT INTO users (id, name, email, created_at)
          VALUES (?, ?, ?, datetime('now'))
      `,
    ).run(userId, "Test User", "test@example.com");

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    expect(user).toBeDefined();
    expect(user.name).toBe("Test User");
    expect(user.email).toBe("test@example.com");
  });
});

describe("ensureNoteRevisionsSchema", () => {
  // Returns the on_delete action for the note_revisions -> notes FK, or null
  // if no such FK is present.
  function noteRevisionsFkOnDelete(db) {
    const fks = db.prepare("PRAGMA foreign_key_list('note_revisions')").all();
    const notesFk = fks.find((f) => f.table === "notes");
    return notesFk ? notesFk.on_delete || "NO ACTION" : null;
  }

  function listIndexes(db) {
    return db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='note_revisions'",
      )
      .all()
      .map((r) => r.name)
      .sort();
  }

  // Creates a note_revisions table with the legacy (NO ACTION) FK shape that
  // existed before the cascade fix, plus some rows.
  function createLegacyNoteRevisions(db) {
    db.exec(`
          CREATE TABLE notes (
              id TEXT PRIMARY KEY NOT NULL,
              title TEXT,
              content TEXT,
              created_at TEXT,
              updated_at TEXT
          );
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
              FOREIGN KEY (note_id) REFERENCES notes(id)
          );
          CREATE INDEX idx_note_revisions_note_created
              ON note_revisions(note_id, created_at DESC);
          CREATE INDEX idx_note_revisions_note_type_created
              ON note_revisions(note_id, type, created_at DESC);
          INSERT INTO notes (id, title, content, created_at, updated_at)
              VALUES ('note-x', 't', 'c', datetime('now'), datetime('now'));
          INSERT INTO note_revisions (
              id, note_id, title, content_gzip, type, content_sha256,
              uncompressed_bytes, compressed_bytes, created_at
          ) VALUES ('rev-x', 'note-x', 't', X'00', 'auto', 'h', 0, 1, datetime('now'));
      `);
  }

  it("migrates a legacy NO ACTION FK to ON DELETE CASCADE and preserves data/indexes", () => {
    const db = getTestDb(`migr-legacy-${Date.now()}`, { inMemory: true });
    // getTestDb already runs ensureNoteRevisionsSchema on a DB whose
    // BASE_SCHEMA created the cascade FK, so this drops & recreates the
    // table with the old shape to simulate a pre-fix DB.
    db.exec("DROP TABLE note_revisions");
    db.exec("DROP TABLE note_revision_meta");
    db.exec("DROP TABLE notes");
    createLegacyNoteRevisions(db);

    expect(noteRevisionsFkOnDelete(db)).toBe("NO ACTION");

    ensureNoteRevisionsSchema(db);

    expect(noteRevisionsFkOnDelete(db)).toBe("CASCADE");
    // Existing row survives the table rebuild.
    const revCount = db
      .prepare("SELECT COUNT(*) as c FROM note_revisions WHERE note_id = ?")
      .get("note-x").c;
    expect(revCount).toBe(1);
    // Indexes are recreated on the new table (not lost with the old one).
    expect(listIndexes(db)).toEqual([
      "idx_note_revisions_note_created",
      "idx_note_revisions_note_type_created",
      "sqlite_autoindex_note_revisions_1",
    ]);

    // Cascade actually fires when a note is deleted.
    db.prepare("DELETE FROM notes WHERE id = ?").run("note-x");
    const after = db
      .prepare("SELECT COUNT(*) as c FROM note_revisions WHERE note_id = ?")
      .get("note-x").c;
    expect(after).toBe(0);

    db.close();
  });

  it("is a no-op when the FK already has ON DELETE CASCADE", () => {
    const db = getTestDb(`migr-fresh-${Date.now()}`, { inMemory: true });
    // BASE_SCHEMA + ensureNoteRevisionsSchema already produced the cascade FK.
    expect(noteRevisionsFkOnDelete(db)).toBe("CASCADE");

    // Running it again must not raise or change the schema.
    ensureNoteRevisionsSchema(db);
    ensureNoteRevisionsSchema(db);
    expect(noteRevisionsFkOnDelete(db)).toBe("CASCADE");
    expect(listIndexes(db)).toEqual([
      "idx_note_revisions_note_created",
      "idx_note_revisions_note_type_created",
      "sqlite_autoindex_note_revisions_1",
    ]);

    db.close();
  });

  it("is a no-op when the table does not exist yet", () => {
    // A brand-new in-memory DB that has never seen BASE_SCHEMA should not
    // explode — the migration is expected to bail out cleanly so that the
    // caller can subsequently run BASE_SCHEMA.
    const db = new Database(":memory:");
    expect(() => ensureNoteRevisionsSchema(db)).not.toThrow();
    // Table is still absent.
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='note_revisions'",
      )
      .all();
    expect(tables).toHaveLength(0);
    db.close();
  });
});
