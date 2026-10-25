// Unit tests for db.js
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import {
  initDb,
  getAuthDb,
  getSpacesDb,
  getDb,
  parseDbKey,
  resolveDbPath,
  listUserDbIds,
  initializeContentDb,
  initializeSpacesDb,
  getUserDb,
  getTestDb,
  deleteTestDb,
  closeAllConnections,
  clearConnectionCache,
  evictIdleDbConnections,
  openContentDbCount,
  invalidateUserDb,
  getHealthyUserDb,
  ensureNoteRevisionsSchema,
  ensureImagesSchema,
  ensureNotesSchema,
  METADATA_DB_BUSY_TIMEOUT_MS,
  isDatabaseBusyError,
  resolveMetadataBusyTimeoutMs,
} from "../../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "../../data");
const SPACES_DB_DIR = path.join(DB_DIR, "spaces");

describe("Database keys and content initialization (COLLAB-04 Phase 1)", () => {
  const userId = uuidv4();
  const spaceId = uuidv4();
  const sharedId = uuidv4();

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(`user:${userId}`);
    deleteTestDb(`space:${spaceId}`);
    deleteTestDb(`user:${sharedId}`);
    deleteTestDb(`space:${sharedId}`);
  });

  it("parses only canonical user and space UUID keys", () => {
    expect(parseDbKey(`user:${userId}`)).toEqual({
      kind: "user",
      id: userId,
      dbKey: `user:${userId}`,
    });
    expect(parseDbKey(`space:${spaceId}`).kind).toBe("space");

    for (const invalid of [
      userId,
      "user:not-a-uuid",
      "user:../../_users",
      "space:/tmp/escape",
      `unknown:${userId}`,
      `user:${userId}:extra`,
    ]) {
      expect(() => parseDbKey(invalid)).toThrow();
    }
  });

  it("resolves user and space paths inside their dedicated roots", () => {
    const userPath = resolveDbPath(`user:${userId}`);
    const spacePath = resolveDbPath(`space:${spaceId}`);
    expect(userPath.dbPath).toBe(path.join(DB_DIR, `${userId}.db`));
    expect(spacePath.dbPath).toBe(path.join(SPACES_DB_DIR, `${spaceId}.db`));
    expect(path.relative(DB_DIR, userPath.dbPath).startsWith("..")).toBe(false);
    expect(path.relative(SPACES_DB_DIR, spacePath.dbPath).startsWith("..")).toBe(false);
  });

  it("shares one canonical user connection while keeping equal user/space UUIDs distinct", () => {
    const userDb = getDb(`user:${sharedId}`);
    expect(getUserDb(sharedId)).toBe(userDb);
    expect(getDb(`space:${sharedId}`)).not.toBe(userDb);
  });

  it("records the versioned initializer kind and keeps backup config user-only", () => {
    const userDb = getDb(`user:${userId}`);
    const spaceDb = getDb(`space:${spaceId}`);
    expect(userDb.prepare("SELECT kind, version FROM application_schema").get()).toEqual({
      kind: "user",
      version: 2,
    });
    expect(spaceDb.prepare("SELECT kind, version FROM application_schema").get()).toEqual({
      kind: "space",
      version: 2,
    });
    expect(userDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_config'").get()).toBeDefined();
    expect(spaceDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_config'").get()).toBeUndefined();
    expect(spaceDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collab_sessions'").get()).toBeDefined();
    expect(userDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collab_sessions'").get()).toBeUndefined();
  });

  it("upgrades an unversioned content database idempotently without losing rows", () => {
    const db = getDb(`user:${userId}`);
    db.prepare(
      `INSERT INTO notes (id, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("legacy-note", "Legacy", "preserved", "now", "now");
    db.prepare("DELETE FROM application_schema").run();

    initializeContentDb(db, "user");
    initializeContentDb(db, "user");

    expect(db.prepare("SELECT content FROM notes WHERE id = ?").get("legacy-note")).toEqual({
      content: "preserved",
    });
    expect(db.prepare("SELECT kind, version FROM application_schema").get()).toEqual({
      kind: "user",
      version: 2,
    });
  });

  it("does not record a content schema version when CRR initialization fails", () => {
    const db = new Database(":memory:");
    expect(() => initializeContentDb(db, "space")).toThrow();
    expect(db.prepare("SELECT version FROM application_schema").get()).toBeUndefined();
    db.close();
  });

  it("runs the shared-space metadata migration idempotently and records it once", () => {
    const db = new Database(":memory:");
    initializeSpacesDb(db);
    initializeSpacesDb(db);
    expect(db.prepare("SELECT version FROM spaces_schema_migrations").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
    expect(db.prepare("PRAGMA table_info('space_invites')").all().map((column) => column.name))
      .toEqual(expect.arrayContaining(["invite_id", "revoked_at"]));
    expect(db.prepare("PRAGMA table_info('space_transfers')").all().map((column) => column.name))
      .toEqual(expect.arrayContaining([
        "source_db_key",
        "destination_db_key",
        "image_map_json",
        "warnings_json",
      ]));
    db.close();
  });

  it("adds the copy-or-move column to a version-three database without raising its version", () => {
    const db = new Database(":memory:");
    initializeSpacesDb(db);
    // As a database written by the build before the column existed.
    db.exec("ALTER TABLE space_transfers DROP COLUMN keep_source");
    db.prepare(
      `INSERT INTO space_transfers (
         id, actor_user_id, source_db_key, destination_db_key, source_note_id, destination_note_id,
         source_updated_at, source_content_sha256, status, created_at, updated_at
       ) VALUES ('t', 'u', 'user:a', 'space:b', 'n', 'd', 'at', 'hash', 'checkpointed', 'at', 'at')`,
    ).run();

    initializeSpacesDb(db);
    initializeSpacesDb(db);

    // An older build refuses a database whose version is above its own, so
    // the column must not carry one. Rows it wrote, and will write, are moves.
    expect(db.prepare("SELECT MAX(version) AS version FROM spaces_schema_migrations").get().version)
      .toBe(3);
    expect(db.prepare("SELECT keep_source AS keepSource FROM space_transfers").get().keepSource).toBe(0);
    db.close();
  });

  it("upgrades version-one invitations with stable management ids", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE spaces_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO spaces_schema_migrations VALUES (1, '2026-01-01T00:00:00.000Z');
      CREATE TABLE space_invites (
        token_hash TEXT PRIMARY KEY NOT NULL,
        space_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'editor' CHECK (role = 'editor'),
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO space_invites
        (token_hash, space_id, email, expires_at, created_at)
      VALUES
        ('legacy-token-hash', 'space-id', 'person@example.test',
         '2026-08-25T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
    `);
    initializeSpacesDb(db);
    const migrated = db.prepare(
      "SELECT invite_id AS inviteId, revoked_at AS revokedAt FROM space_invites",
    ).get();
    expect(migrated.inviteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(migrated.revokedAt).toBeNull();
    expect(db.prepare("SELECT MAX(version) AS version FROM spaces_schema_migrations").get().version)
      .toBe(3);
    db.close();
  });

  it("enumerates both user and space databases as canonical keys", () => {
    getDb(`user:${userId}`);
    getDb(`space:${spaceId}`);
    expect(listUserDbIds()).toEqual(expect.arrayContaining([
      `user:${userId}`,
      `space:${spaceId}`,
    ]));
  });
});

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
    expect(tableNames).toContain("email_verifications");

    const spacesDb = getSpacesDb();
    const spaceTables = spacesDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    expect(spaceTables).toEqual(expect.arrayContaining([
      "spaces",
      "space_members",
      "space_invites",
      "space_user_versions",
      "spaces_schema_migrations",
    ]));
  });

  it("should return the same auth database instance on multiple calls", () => {
    const db1 = getAuthDb();
    const db2 = getAuthDb();

    expect(db1).toBe(db2);
  });

  it("sets a bounded busy_timeout on both the auth and shared-spaces connections", () => {
    // Guards against the concurrent-lock regression where invariant checks
    // (writes against `_spaces.db`) and actor lookups (reads against
    // `_users.db`) could hit an immediate SQLITE_BUSY instead of retrying
    // briefly, since neither long-lived metadata connection configured a
    // busy timeout.
    const authDb = getAuthDb();
    const spacesDb = getSpacesDb();

    expect(authDb.pragma("busy_timeout", { simple: true })).toBe(METADATA_DB_BUSY_TIMEOUT_MS);
    expect(spacesDb.pragma("busy_timeout", { simple: true })).toBe(METADATA_DB_BUSY_TIMEOUT_MS);
  });

  it("keeps both metadata databases in WAL mode so readers never wait for a writer", () => {
    expect(getAuthDb().pragma("journal_mode", { simple: true })).toBe("wal");
    expect(getSpacesDb().pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("waits only briefly for a lock in the running service, and long only under test", () => {
    // The driver is synchronous: a lock wait freezes every request, not just
    // the one waiting. A held lock on `_users.db` with a 30 s wait was measured
    // stalling unrelated /sync requests for its whole duration.
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "production" })).toBe(250);
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "development" })).toBe(250);
    expect(resolveMetadataBusyTimeoutMs({})).toBe(250);
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "test" })).toBe(30_000);
  });

  it("honours an explicit timeout but never an unbounded or malformed one", () => {
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "production", METADATA_DB_BUSY_TIMEOUT_MS: "1000" })).toBe(1000);
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "production", METADATA_DB_BUSY_TIMEOUT_MS: "0" })).toBe(0);
    expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "production", METADATA_DB_BUSY_TIMEOUT_MS: "900000" })).toBe(60_000);
    for (const bad of ["", "abc", "-5", "NaN"]) {
      expect(resolveMetadataBusyTimeoutMs({ NODE_ENV: "production", METADATA_DB_BUSY_TIMEOUT_MS: bad })).toBe(250);
    }
  });

  it("recognises lock errors and nothing else", () => {
    for (const code of ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_TIMEOUT", "SQLITE_LOCKED", "SQLITE_LOCKED_SHAREDCACHE"]) {
      expect(isDatabaseBusyError({ code })).toBe(true);
    }
    for (const error of [null, undefined, {}, { code: "SQLITE_CONSTRAINT" }, { code: "ENOENT" }, new Error("database is locked")]) {
      expect(isDatabaseBusyError(error)).toBe(false);
    }
  });
});

describe("User Database Management", () => {
  const testUserId = uuidv4();

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
    const dbVersion = db.prepare("SELECT crsql_db_version() AS value").get();

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
    expect(Number(dbVersion.value)).toBeGreaterThanOrEqual(0);

    // Check base tables exist
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("folders");
    expect(tableNames).toContain("notes");
    expect(tableNames).toContain("images");
    expect(tableNames).toContain("settings");
  });

  it("registers the named-style tables as CRRs", () => {
    const db = getUserDb(testUserId);
    for (const table of ["style_presets", "style_assignments"]) {
      const trigger = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get(`${table}__crsql_utrig`);
      expect(trigger, table).toBeDefined();
    }
  });

  it("should enable WAL mode", () => {
    const db = getUserDb(testUserId);

    const result = db.pragma("journal_mode", { simple: true });
    expect(result).toBe("wal");
  });
});

describe("Test Database Utilities", () => {
  const testUserId = uuidv4();

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
  const testUserId1 = uuidv4();
  const testUserId2 = uuidv4();

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
    getUserDb(testUserId1);

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

  // Background-job guard: maintenance jobs must never write a CRR table through a
  // connection whose internal sync bit is still set, or their deletes skip the
  // CR-SQLite triggers and leave orphan clock rows.
  // These two use their own ids rather than testUserId1. afterEach deletes the .db/-wal/-shm
  // files, and reopening the same path immediately afterwards races the OS releasing the WAL:
  // under full-suite parallel load `getUserDb` then intermittently throws "Safety level may
  // not be changed inside a transaction" from its `synchronous = normal` pragma, because the
  // preceding `journal_mode = wal` left a read transaction open when it could not take the
  // lock cleanly. A distinct id per test sidesteps the race. See the agent log — the
  // underlying fragility is in getUserDb, not here.
  const healthyUserIdClean = uuidv4();
  const healthyUserIdPoisoned = uuidv4();

  afterEach(() => {
    deleteTestDb(healthyUserIdClean);
    deleteTestDb(healthyUserIdPoisoned);
  });

  it("returns the cached connection unchanged when the sync bit is clean", () => {
    const db = getUserDb(healthyUserIdClean);
    expect(getHealthyUserDb(healthyUserIdClean, "test-clean")).toBe(db);
  });

  it("reopens a poisoned connection before handing it to a background job", () => {
    const poisoned = getUserDb(healthyUserIdPoisoned);
    poisoned.prepare("SELECT crsql_internal_sync_bit(1)").get();
    expect(
      poisoned.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get().sync_bit,
    ).toBe(1);

    const healthy = getHealthyUserDb(healthyUserIdPoisoned, "test-image-prune");

    expect(healthy).not.toBe(poisoned);
    expect(
      healthy.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get().sync_bit,
    ).toBe(0);
    // The poisoned handle must be gone from the cache, not merely bypassed.
    expect(getUserDb(healthyUserIdPoisoned)).toBe(healthy);
  });
});

describe("Connection cache", () => {
  const userIds = [uuidv4(), uuidv4(), uuidv4()];

  afterEach(() => {
    for (const id of userIds) deleteTestDb(`user:${id}`);
  });

  it("closes the least recently used content connections beyond the limit, and reopens on demand", () => {
    const [oldest, middle, newest] = userIds;
    const first = getDb(`user:${oldest}`);
    first.prepare("INSERT INTO notes (id, user_id, title, content) VALUES ('n', ?, 't', 'kept on disk')").run(oldest);
    getDb(`user:${middle}`);
    getDb(`user:${newest}`);
    const before = openContentDbCount();

    // A minute later nobody has asked for any of them; room for one fewer than are open.
    const closed = evictIdleDbConnections({ limit: before - 2, now: Date.now() + 61_000 });

    expect(closed).toBe(2);
    expect(openContentDbCount()).toBe(before - 2);
    expect(first.open).toBe(false);
    // Asking again reopens it, with its data.
    const reopened = getDb(`user:${oldest}`);
    expect(reopened).not.toBe(first);
    expect(reopened.prepare("SELECT content FROM notes WHERE id = 'n'").get().content).toBe("kept on disk");
  });

  it("never closes a connection that was used within the last minute", () => {
    // An asynchronous route holds the handle it was given across awaits.
    const held = getDb(`user:${userIds[0]}`);
    getDb(`user:${userIds[1]}`);

    expect(evictIdleDbConnections({ limit: 0 })).toBe(0);
    expect(held.open).toBe(true);
    expect(held.prepare("SELECT 1 AS ok").get().ok).toBe(1);
  });

  it("leaves the authentication and space metadata connections alone", () => {
    const auth = getAuthDb();
    const spaces = getSpacesDb();
    getDb(`user:${userIds[0]}`);

    evictIdleDbConnections({ limit: 0, minIdleMs: 0, now: Date.now() + 1 });

    expect(auth.open).toBe(true);
    expect(spaces.open).toBe(true);
    expect(getAuthDb()).toBe(auth);
  });
});

describe("CRDT Tables", () => {
  const testUserId = uuidv4();

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

describe("ensureNoteRevisionsSchema: interrupted migrations", () => {
  const NOTE = "note-rev-crash";
  const insertNote = (db) => db
    .prepare("INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, 'T', 'c', 'now', 'now')")
    .run(NOTE);
  const revisionColumns = (db, table = "note_revisions") =>
    db.prepare(`PRAGMA table_info('${table}')`).all().map((column) => column.name);

  it("finishes an actor-column migration that stopped after the first column", () => {
    // The two columns were added by one multi-statement exec. A process that
    // died between them left only the first; re-running then failed on
    // "duplicate column" at every later open, locking the user out for good.
    const db = getTestDb("rev-half-columns", { inMemory: true });
    db.exec("ALTER TABLE note_revisions DROP COLUMN actor_kind");
    expect(revisionColumns(db)).toContain("actor_user_id");
    expect(revisionColumns(db)).not.toContain("actor_kind");

    expect(() => ensureNoteRevisionsSchema(db)).not.toThrow();
    expect(revisionColumns(db)).toEqual(expect.arrayContaining(["actor_user_id", "actor_kind"]));
    expect(() => ensureNoteRevisionsSchema(db)).not.toThrow();
  });

  it("restores the history left behind by a rebuild that stopped after the rename", () => {
    // Old layout in `note_revisions_old`, and the empty table the schema
    // bootstrap created on the next start: before, the history stayed orphaned.
    const db = getTestDb("rev-orphaned-rebuild", { inMemory: true });
    insertNote(db);
    db.exec(`
      CREATE TABLE note_revisions_old (
        id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL, title TEXT,
        content_gzip BLOB NOT NULL, type TEXT NOT NULL DEFAULT 'auto',
        content_sha256 TEXT NOT NULL, uncompressed_bytes INTEGER NOT NULL,
        compressed_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO note_revisions_old VALUES ('rev-kept', '${NOTE}', 'T', x'00', 'manual', 'sha', 1, 1, 'then');
      INSERT INTO note_revisions_old VALUES ('rev-of-deleted-note', 'gone', 'T', x'00', 'auto', 'sha', 1, 1, 'then');
    `);

    ensureNoteRevisionsSchema(db);

    expect(db.prepare("SELECT id, type, actor_user_id FROM note_revisions").all())
      .toEqual([{ id: "rev-kept", type: "manual", actor_user_id: null }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'note_revisions_old'").get()).toBeUndefined();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rebuilds a legacy table in one transaction and leaves foreign keys on", () => {
    const db = getTestDb("rev-legacy-rebuild", { inMemory: true });
    insertNote(db);
    db.pragma("foreign_keys = OFF");
    db.exec(`
      DROP TABLE note_revisions;
      CREATE TABLE note_revisions (
        id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL, title TEXT,
        content_gzip BLOB NOT NULL, type TEXT NOT NULL DEFAULT 'auto',
        content_sha256 TEXT NOT NULL, uncompressed_bytes INTEGER NOT NULL,
        compressed_bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id)
      );
      INSERT INTO note_revisions VALUES ('rev-legacy', '${NOTE}', 'T', x'00', 'auto', 'sha', 1, 1, 'then');
    `);
    db.pragma("foreign_keys = ON");

    ensureNoteRevisionsSchema(db);

    expect(db.prepare("SELECT id FROM note_revisions").all()).toEqual([{ id: "rev-legacy" }]);
    expect(revisionColumns(db)).toEqual(expect.arrayContaining(["actor_user_id", "actor_kind"]));
    expect(db.prepare("PRAGMA foreign_key_list('note_revisions')").all()[0].on_delete).toBe("CASCADE");
    expect(db.inTransaction).toBe(false);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'note_revisions_old'").get()).toBeUndefined();
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
    // The FK-rebuild path also backfills the actor columns for a DB that
    // predates both fixes, defaulting existing rows to NULL.
    const revisionRow = db
      .prepare("SELECT actor_user_id, actor_kind FROM note_revisions WHERE id = 'rev-x'")
      .get();
    expect(revisionRow).toEqual({ actor_user_id: null, actor_kind: null });
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

  it("adds the actor_user_id/actor_kind columns in place when the cascade FK is already present", () => {
    const db = getTestDb(`migr-actor-cols-${Date.now()}`, { inMemory: true });
    // Simulate a DB that already received the cascade FK fix (from an
    // earlier deploy) but predates the backend-only actor columns.
    db.exec("DROP TABLE note_revisions");
    db.exec(`
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
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_note_revisions_note_created
          ON note_revisions(note_id, created_at DESC);
      CREATE INDEX idx_note_revisions_note_type_created
          ON note_revisions(note_id, type, created_at DESC);
      INSERT INTO notes (id, title, content, created_at, updated_at)
          VALUES ('note-y', 't', 'c', datetime('now'), datetime('now'));
      INSERT INTO note_revisions (
          id, note_id, title, content_gzip, type, content_sha256,
          uncompressed_bytes, compressed_bytes, created_at
      ) VALUES ('rev-y', 'note-y', 't', X'00', 'auto', 'h', 0, 1, datetime('now'));
    `);

    const columnNames = () =>
      db.prepare("PRAGMA table_info('note_revisions')").all().map((c) => c.name);
    expect(noteRevisionsFkOnDelete(db)).toBe("CASCADE");
    expect(columnNames()).not.toContain("actor_user_id");

    ensureNoteRevisionsSchema(db);

    expect(columnNames()).toEqual(
      expect.arrayContaining(["actor_user_id", "actor_kind"]),
    );
    expect(noteRevisionsFkOnDelete(db)).toBe("CASCADE");
    // Existing row preserved; the new columns default to NULL, not an error.
    const row = db
      .prepare(
        "SELECT actor_user_id, actor_kind FROM note_revisions WHERE id = 'rev-y'",
      )
      .get();
    expect(row).toEqual({ actor_user_id: null, actor_kind: null });

    // Running again is a no-op: no duplicate-column error, nothing changes.
    expect(() => ensureNoteRevisionsSchema(db)).not.toThrow();
    expect(columnNames().filter((c) => c === "actor_user_id")).toHaveLength(1);

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

describe("ensureImagesSchema", () => {
  const testUserId = uuidv4();

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId);
  });

  function imageColumns(db) {
    return new Set(
      db
        .prepare("PRAGMA table_info('images')")
        .all()
        .map((column) => column.name),
    );
  }

  /** Rebuild `images` in its pre-migration shape, still registered as a CRR. */
  function makeLegacyCrrImages(db) {
    db.exec("DROP TRIGGER IF EXISTS images__crsql_itrig");
    db.exec("DROP TRIGGER IF EXISTS images__crsql_utrig");
    db.exec("DROP TRIGGER IF EXISTS images__crsql_dtrig");
    db.exec("DROP TABLE IF EXISTS images");
    db.exec("DROP TABLE IF EXISTS images__crsql_clock");
    db.exec("DROP TABLE IF EXISTS images__crsql_pks");
    db.exec(`
      CREATE TABLE images (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        filename TEXT,
        mime_type TEXT,
        path TEXT,
        created_at TEXT
      );
    `);
    db.prepare("SELECT crsql_as_crr('images')").get();
  }

  it("leaves a freshly created user database with both columns and a working CRR", () => {
    const db = getUserDb(testUserId);
    const names = imageColumns(db);

    expect(names.has("size_bytes")).toBe(true);
    expect(names.has("sha256")).toBe(true);

    db.prepare(
      "INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("img-1", testUserId, "a.png", "image/png", "a.png", 10, "abc", "now");

    expect(() =>
      db
        .prepare("UPDATE images SET size_bytes = ? WHERE id = ?")
        .run(20, "img-1"),
    ).not.toThrow();
  });

  // The production case: `images` is already a CRR, so its generated triggers
  // bind the old column count until the alter goes through
  // crsql_begin_alter / crsql_commit_alter.
  it("migrates an existing CRR images table so writes and replication still work", () => {
    const db = getTestDb(testUserId, { inMemory: true });
    makeLegacyCrrImages(db);
    db.prepare(
      "INSERT INTO images (id, user_id, filename, mime_type, path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("legacy-img", testUserId, "a.png", "image/png", "a.png", "now");

    ensureImagesSchema(db);

    const names = imageColumns(db);
    expect(names.has("size_bytes")).toBe(true);
    expect(names.has("sha256")).toBe(true);

    expect(() =>
      db
        .prepare("UPDATE images SET size_bytes = ?, sha256 = ? WHERE id = ?")
        .run(42, "deadbeef", "legacy-img"),
    ).not.toThrow();
    expect(
      db.prepare("SELECT size_bytes FROM images WHERE id = ?").get("legacy-img")
        .size_bytes,
    ).toBe(42);
    expect(
      db
        .prepare(
          `SELECT count(*) AS total FROM crsql_changes WHERE "table" = 'images' AND cid = 'size_bytes'`,
        )
        .get().total,
    ).toBeGreaterThan(0);

    db.close();
  });

  // Regression test for databases already broken in the field: the old
  // migration added the columns with a bare ALTER, leaving stale triggers.
  it("repairs a database whose columns were added without regenerating the triggers", () => {
    const db = getTestDb(testUserId, { inMemory: true });
    makeLegacyCrrImages(db);
    db.exec(
      "ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0",
    );
    db.exec("ALTER TABLE images ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''");
    db.exec("SELECT crsql_as_crr('images')");
    db.prepare(
      "INSERT INTO images (id, user_id, filename, mime_type, path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("half-img", testUserId, "a.png", "image/png", "a.png", "now");

    // Prove the pre-fix state really is broken, so the repair below means something.
    expect(() =>
      db.prepare("UPDATE images SET size_bytes = ? WHERE id = ?").run(1, "half-img"),
    ).toThrow(/expected \d+ values/);

    ensureImagesSchema(db);

    expect(() =>
      db.prepare("UPDATE images SET size_bytes = ? WHERE id = ?").run(7, "half-img"),
    ).not.toThrow();
    expect(
      db.prepare("SELECT size_bytes FROM images WHERE id = ?").get("half-img")
        .size_bytes,
    ).toBe(7);

    db.close();
  });

  it("is idempotent", () => {
    const db = getTestDb(testUserId, { inMemory: true });
    makeLegacyCrrImages(db);

    ensureImagesSchema(db);
    ensureImagesSchema(db);
    ensureImagesSchema(db);

    expect(
      db
        .prepare("PRAGMA table_info('images')")
        .all()
        .filter((c) => c.name === "size_bytes"),
    ).toHaveLength(1);
    db.close();
  });

  it("is a no-op when the images table does not exist yet", () => {
    const db = new Database(":memory:");
    expect(() => ensureImagesSchema(db)).not.toThrow();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='images'",
        )
        .all(),
    ).toHaveLength(0);
    db.close();
  });
});

describe("ensureNotesSchema", () => {
  const testUserId = uuidv4();

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(testUserId);
  });

  it("adds pinned with the default value to a legacy notes table", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        folder_id TEXT,
        title TEXT,
        content TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO notes (id, title, content, created_at, updated_at)
        VALUES ('legacy-note', 'Legacy', 'Body', 'now', 'now');
    `);

    ensureNotesSchema(db);
    ensureNotesSchema(db);

    expect(
      db.prepare("SELECT pinned FROM notes WHERE id = ?").get("legacy-note")
        .pinned,
    ).toBe(0);
    expect(
      db.prepare("PRAGMA table_info('notes')").all().filter((c) => c.name === "pinned"),
    ).toHaveLength(1);
    db.close();
  });

  it("repairs stale CRR triggers after a bare pinned-column migration", () => {
    const db = getTestDb(testUserId, { inMemory: true });
    db.exec("DROP TRIGGER IF EXISTS notes__crsql_itrig");
    db.exec("DROP TRIGGER IF EXISTS notes__crsql_utrig");
    db.exec("DROP TRIGGER IF EXISTS notes__crsql_dtrig");
    db.exec("DROP TABLE IF EXISTS notes");
    db.exec("DROP TABLE IF EXISTS notes__crsql_clock");
    db.exec("DROP TABLE IF EXISTS notes__crsql_pks");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        title TEXT,
        content TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    db.prepare("SELECT crsql_as_crr('notes')").get();
    db.exec("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
    db.prepare(
      "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("half-migrated", "Half", "Body", "now", "now");

    ensureNotesSchema(db);

    expect(() =>
      db.prepare("UPDATE notes SET pinned = 1 WHERE id = ?").run("half-migrated"),
    ).not.toThrow();
    expect(
      db
        .prepare(
          `SELECT count(*) AS total FROM crsql_changes WHERE "table" = 'notes' AND cid = 'pinned'`,
        )
        .get().total,
    ).toBeGreaterThan(0);
    db.close();
  });
});
