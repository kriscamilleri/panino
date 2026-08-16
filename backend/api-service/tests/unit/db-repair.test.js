// Unit tests for db-repair.js
//
// Reproduces the production sync 500 corruption shape described in
// docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md and asserts
// the repair helper detects and removes it cleanly. Sentinels (deletion
// tombstones) and legitimate (base-row present) clock rows must be left
// untouched.
//
// Each test owns a fresh in-memory database so it is immune to the global
// `closeAllConnections` afterEach hook installed by tests/setup.js.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  findOrphanImagesClockRows,
  repairOrphanImagesClocks,
} from "../../db-repair.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXT_PATH =
  process.env.CRSQLITE_EXT_PATH ||
  path.join(__dirname, "../../native/crsqlite.so");

const IMAGES_SCHEMA = `
  CREATE TABLE images (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    filename TEXT,
    mime_type TEXT,
    path TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    created_at TEXT
  );
`;

function makeDb() {
  const db = new Database(":memory:");
  if (EXT_PATH) db.loadExtension(EXT_PATH);
  db.exec(IMAGES_SCHEMA);
  db.prepare("SELECT crsql_as_crr('images')").get();
  return db;
}

function injectSingleOrphan(db, imageId) {
  // Mirror what crsqlite's AFTER INSERT trigger would have written, but
  // bypass the trigger by inserting directly into the CRR support tables
  // and never inserting the base row. This is the precise corruption
  // shape that produced the production sync 500.
  db.prepare(`INSERT INTO images__crsql_pks (id) VALUES (?)`).run(imageId);
  const { __crsql_key: key } = db
    .prepare(`SELECT __crsql_key FROM images__crsql_pks WHERE id = ?`)
    .get(imageId);
  const cols = [
    "user_id",
    "filename",
    "mime_type",
    "path",
    "sha256",
    "size_bytes",
    "created_at",
  ];
  const stmt = db.prepare(
    `INSERT INTO images__crsql_clock
       (key, col_name, col_version, db_version, site_id, seq)
     VALUES (?, ?, 1, 1, 0, 1)`,
  );
  for (const c of cols) stmt.run(key, c);
  return key;
}

function insertHealthyImage(db, imageId) {
  // Insert a real image row the normal way — the AFTER-INSERT trigger
  // writes the clock rows; base + clock stay consistent.
  db.prepare(
    `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
     VALUES (?, 'u', 'f.png', 'image/png', '/f.png', 0, '', '2026-01-01')`,
  ).run(imageId);
}

function insertDeletedTombstone(db, imageId) {
  // Insert then delete a real image; the AFTER-DELETE trigger leaves the
  // deletion sentinel (`col_name='-1'`, col_version=2) and removes the
  // non-sentinel clock rows — the normal, post-delete state.
  insertHealthyImage(db, imageId);
  db.prepare(`DELETE FROM images WHERE id = ?`).run(imageId);
}

describe("db-repair: findOrphanImagesClockRows / repairOrphanImagesClocks", () => {
  it("returns an empty list when there are no clock orphans", () => {
    const db = makeDb();
    insertHealthyImage(db, "healthy-image");
    const orphans = findOrphanImagesClockRows(db);
    // A healthy row produces non-sentinel clock rows but its base row
    // exists, so it is not an orphan.
    expect(orphans.filter((o) => o.pk_id === "healthy-image")).toEqual([]);
    db.close();
  });

  it("ignores the deletion sentinel left behind by a normal DELETE", () => {
    const db = makeDb();
    insertDeletedTombstone(db, "deleted-image-tombstone");
    const orphans = findOrphanImagesClockRows(db).filter(
      (o) => o.pk_id === "deleted-image-tombstone",
    );
    expect(orphans).toEqual([]);
    db.close();
  });

  it("detects a non-sentinel clock orphan with no base row", () => {
    const db = makeDb();
    injectSingleOrphan(db, "orphan-image-1");
    const orphans = findOrphanImagesClockRows(db).filter(
      (o) => o.pk_id === "orphan-image-1",
    );
    expect(orphans.length).toBeGreaterThan(0);
    // All detected orphans must be non-sentinel and mapped to the test id.
    for (const o of orphans) {
      expect(o.col_name).not.toBe("-1");
      expect(o.pk_id).toBe("orphan-image-1");
    }
    db.close();
  });

  it("dry-run does not touch clock rows", () => {
    const db = makeDb();
    injectSingleOrphan(db, "orphan-image-1");
    const before = findOrphanImagesClockRows(db).filter(
      (o) => o.pk_id === "orphan-image-1",
    ).length;
    expect(before).toBeGreaterThan(0);

    const result = repairOrphanImagesClocks(db, { apply: false });
    expect(result.applied).toBe(false);
    expect(result.removed).toBe(0);

    const after = findOrphanImagesClockRows(db).filter(
      (o) => o.pk_id === "orphan-image-1",
    ).length;
    expect(after).toBe(before);
    db.close();
  });

  it("apply removes only the non-sentinel orphan rows (keeps sentinels and healthy rows)", () => {
    const db = makeDb();
    // Healthy row — clock rows must be kept.
    insertHealthyImage(db, "healthy-image");
    const healthyBefore = db
      .prepare(
        `SELECT COUNT(*) c FROM images__crsql_clock k
          JOIN images__crsql_pks p ON p.__crsql_key = k.key
         WHERE p.id='healthy-image'`,
      )
      .get().c;

    // Real delete tombstone — sentinel must be kept.
    insertDeletedTombstone(db, "deleted-image-tombstone");
    const tomb = db
      .prepare(
        `SELECT __crsql_key FROM images__crsql_pks WHERE id = ?`,
      )
      .get("deleted-image-tombstone");
    const tombKey = tomb.__crsql_key;

    // Orphan injected directly into the CRR support tables.
    injectSingleOrphan(db, "orphan-image-1");
    const orphanBefore = findOrphanImagesClockRows(db).filter(
      (o) => o.pk_id === "orphan-image-1",
    ).length;
    expect(orphanBefore).toBeGreaterThan(0);

    const result = repairOrphanImagesClocks(db, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.removed).toBeGreaterThanOrEqual(orphanBefore);

    // Orphan gone.
    expect(
      findOrphanImagesClockRows(db).filter(
        (o) => o.pk_id === "orphan-image-1",
      ),
    ).toEqual([]);

    // Sentinel tombstone preserved.
    const sentinelAfter = db
      .prepare(
        `SELECT 1 FROM images__crsql_clock WHERE key=? AND col_name='-1'`,
      )
      .get(tombKey);
    expect(sentinelAfter).toBeDefined();

    // Healthy row clock rows preserved.
    const healthyAfter = db
      .prepare(
        `SELECT COUNT(*) c FROM images__crsql_clock k
          JOIN images__crsql_pks p ON p.__crsql_key = k.key
         WHERE p.id='healthy-image'`,
      )
      .get().c;
    expect(healthyAfter).toBe(healthyBefore);
    db.close();
  });

  it("is safe to run on a Database with no images CRR tables", () => {
    const bare = new Database(":memory:");
    expect(findOrphanImagesClockRows(bare)).toEqual([]);
    expect(repairOrphanImagesClocks(bare, { apply: true })).toEqual({
      removed: 0,
      orphans: [],
      applied: false,
    });
    bare.close();
  });
});
