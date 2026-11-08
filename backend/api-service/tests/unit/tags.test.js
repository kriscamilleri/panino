// The `tags` CRR (docs/specs/active/tag-system.md §4, §6): created and registered on
// every content database, repaired on an older one, named exactly by the space sync
// allowlist, and merged to one row when two replicas style the same tag.
import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import {
  CONTENT_SCHEMA_VERSION,
  MINIMUM_CLIENT_SCHEMA_VERSION,
  TAGS_COLUMNS,
  closeAllConnections,
  deleteTestDb,
  ensureTagsSchema,
  getDb,
  initializeContentDb,
} from "../../db.js";
import { SPACE_CHANGE_ALLOWLIST, validateSpaceChangeBatch } from "../../sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = process.env.CRSQLITE_EXT_PATH || path.join(__dirname, "../../native/crsqlite.so");

function rawDb() {
  const db = new Database(":memory:");
  db.loadExtension(EXT_PATH);
  return db;
}

const tagColumns = (db) => db.prepare("PRAGMA table_info('tags')").all().map((column) => column.name);
const isCrr = (db, table) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(`${table}__crsql_utrig`),
);

function styleTag(db, name, { color = "", displayName = "" } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tags (name, display_name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET color = excluded.color, display_name = excluded.display_name,
       updated_at = excluded.updated_at`,
  ).run(name, displayName, color, now, now);
}

function changesOf(db) {
  return db.prepare(
    `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_changes`,
  ).all();
}

function apply(db, changes) {
  const insert = db.prepare(
    `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const c of changes) insert.run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.cl, c.seq);
  })();
}

describe("tags table", () => {
  const userId = uuidv4();
  const spaceId = uuidv4();

  afterEach(() => {
    closeAllConnections();
    deleteTestDb(`user:${userId}`);
    deleteTestDb(`space:${spaceId}`);
  });

  it("is a CRR in personal and space databases at content schema 3, with the client floor unchanged", () => {
    expect(CONTENT_SCHEMA_VERSION).toBe(3);
    expect(MINIMUM_CLIENT_SCHEMA_VERSION).toBe(1);
    for (const dbKey of [`user:${userId}`, `space:${spaceId}`]) {
      const db = getDb(dbKey);
      expect(isCrr(db, "tags"), dbKey).toBe(true);
      expect(tagColumns(db)).toEqual(["name", ...Object.keys(TAGS_COLUMNS)]);
      expect(db.prepare("SELECT version FROM application_schema").get().version).toBe(3);
    }
  });

  it("is added to a database the previous build created (content schema 2, no tags table)", () => {
    const db = rawDb();
    db.exec(`
      CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, folder_id TEXT, title TEXT,
        content TEXT, created_at TEXT, updated_at TEXT, pinned INTEGER NOT NULL DEFAULT 0);
      SELECT crsql_as_crr('notes');
      CREATE TABLE application_schema (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
        kind TEXT NOT NULL CHECK (kind IN ('user', 'space')), version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO application_schema VALUES (1, 'space', 2, 'then');
      INSERT INTO notes (id, title, content, created_at, updated_at) VALUES ('n1', 'Kept', 'body', 'then', 'then');
    `);
    expect(tagColumns(db)).toEqual([]);

    initializeContentDb(db, "space");

    expect(isCrr(db, "tags")).toBe(true);
    expect(db.prepare("SELECT version FROM application_schema").get().version).toBe(3);
    expect(db.prepare("SELECT content FROM notes WHERE id = 'n1'").get().content).toBe("body");
    styleTag(db, "work", { color: "red" });
    expect(changesOf(db).filter((change) => change.table === "tags").map((change) => change.cid))
      .toEqual(expect.arrayContaining(["color", "display_name"]));
    db.close();
  });

  it("adds a missing column to a tags CRR through begin/commit alter", () => {
    const db = rawDb();
    db.exec(`
      CREATE TABLE tags (name TEXT PRIMARY KEY NOT NULL, color TEXT NOT NULL DEFAULT '');
      SELECT crsql_as_crr('tags');
    `);
    ensureTagsSchema(db);
    expect(tagColumns(db)).toEqual(["name", "color", "display_name", "created_at", "updated_at"]);
    // Stale triggers would fail here with "expected N values, got M".
    expect(() => styleTag(db, "work", { color: "red", displayName: "Work" })).not.toThrow();
    expect(changesOf(db).some((change) => change.cid === "display_name")).toBe(true);
    db.close();
  });

  it("rebuilds triggers left stale by a bare ALTER", () => {
    const db = rawDb();
    db.exec(`
      CREATE TABLE tags (name TEXT PRIMARY KEY NOT NULL, color TEXT NOT NULL DEFAULT '');
      SELECT crsql_as_crr('tags');
      ALTER TABLE tags ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE tags ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    `);
    ensureTagsSchema(db);
    expect(() => styleTag(db, "work", { color: "red" })).not.toThrow();
    ensureTagsSchema(db);
    db.close();
  });

  it("leaves a database without the table to the schema bootstrap", () => {
    const db = rawDb();
    expect(() => ensureTagsSchema(db)).not.toThrow();
    expect(tagColumns(db)).toEqual([]);
    db.close();
  });

  it("is named column for column by the space sync allowlist", () => {
    // Fails when `tags` gains a column the allowlist does not name, or the reverse.
    const db = getDb(`space:${spaceId}`);
    expect([...SPACE_CHANGE_ALLOWLIST.tags].sort()).toEqual(tagColumns(db).sort());
    const change = (cid) => ({ table: "tags", pk: '["work"]', cid, val: "x", col_version: 1, db_version: 1, site_id: "00", cl: 1, seq: 0 });
    for (const cid of tagColumns(db)) expect(validateSpaceChangeBatch([change(cid)]), cid).toBe(true);
    expect(validateSpaceChangeBatch([change("-1")])).toBe(true);
    expect(validateSpaceChangeBatch([change("user_id")])).toBe(false);
    expect(validateSpaceChangeBatch([{ ...change("color"), pk: "[]" }])).toBe(false);
  });

  it("converges to one row when two replicas style the same tag concurrently", () => {
    const a = rawDb();
    const b = rawDb();
    for (const db of [a, b]) initializeContentDb(db, "space");
    styleTag(a, "work", { color: "red" });
    styleTag(b, "work", { color: "green", displayName: "Work" });

    const fromA = changesOf(a);
    const fromB = changesOf(b);
    apply(a, fromB);
    apply(b, fromA);

    const rowA = a.prepare("SELECT name, display_name, color FROM tags").all();
    const rowB = b.prepare("SELECT name, display_name, color FROM tags").all();
    expect(rowA).toHaveLength(1);
    expect(rowA).toEqual(rowB);
    expect(["red", "green"]).toContain(rowA[0].color);

    // A later color change on one side wins on both.
    a.prepare("UPDATE tags SET color = 'teal' WHERE name = 'work'").run();
    apply(b, changesOf(a).filter((change) => change.cid === "color"));
    expect(b.prepare("SELECT color FROM tags WHERE name = 'work'").get().color).toBe("teal");
    a.close();
    b.close();
  });
});
