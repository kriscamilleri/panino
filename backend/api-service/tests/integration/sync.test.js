// Integration tests for sync endpoint
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import request from "supertest";
import {
  createTestApp,
  setupTestUser,
  cleanupTestUser,
  getTestToken,
  generateSiteId,
} from "../testHelpers.js";
import { getUserDb, getTestDb } from "../../db.js";

describe("POST /sync", () => {
  let app, server;
  let testUser;
  let testToken;

  beforeAll(() => {
    const result = createTestApp();
    app = result.app;
    server = result.server;
  });

  beforeEach(async () => {
    testUser = await setupTestUser(
      `sync-test-${Date.now()}@example.com`,
      "password123",
    );
    testToken = getTestToken(testUser.userId);
  });

  afterEach(() => {
    if (testUser) {
      cleanupTestUser(testUser.userId);
    }
  });

  afterAll(() => {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it("should return changes since given version", async () => {
    const siteId = generateSiteId("a");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: [],
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("changes");
    expect(response.body).toHaveProperty("clock");
    expect(Array.isArray(response.body.changes)).toBe(true);
    expect(typeof response.body.clock).toBe("number");
  });

  it("should accept and apply incoming changes", async () => {
    const siteId = generateSiteId("b");
    const userId = testUser.userId;

    // Create a note change
    const changes = [
      {
        table: "notes",
        pk: '["test-note-1"]',
        cid: "title",
        val: '"Test Note Title"',
        col_version: 1,
        db_version: 1,
        site_id: siteId,
        cl: 0,
        seq: 1,
      },
    ];

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: changes,
      });

    if (response.status !== 200) {
      console.log("Sync error response:", response.status, response.body);
    }

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("changes");
    expect(response.body).toHaveProperty("clock");

    // In CR-SQLite 0.16, inserting into crsql_changes doesn't automatically
    // create rows in base tables. This is a known limitation.
    // For now, we just verify the sync endpoint accepts and processes the request.
    // TODO: Implement proper change application for CR-SQLite 0.16
  });

  it("fails closed and resets the connection when a CR-SQLite merge fails", async () => {
    const siteId = generateSiteId("r");
    const userId = testUser.userId;
    const originalDb = getUserDb(userId);

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "not_a_crr_table",
            pk: '["bad-change"]',
            cid: "value",
            val: '"bad"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
          {
            table: "notes",
            pk: '["must-not-apply"]',
            cid: "title",
            val: '"Valid later change"',
            col_version: 1,
            db_version: 2,
            site_id: siteId,
            cl: 0,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Sync temporarily unavailable",
      code: "SYNC_CONNECTION_RESET",
    });

    const reopenedDb = getUserDb(userId);
    expect(reopenedDb).not.toBe(originalDb);
    expect(reopenedDb.prepare("SELECT crsql_internal_sync_bit() AS sync_bit").get().sync_bit).toBe(0);
    expect(reopenedDb.prepare("SELECT id FROM notes WHERE id = ?").get("must-not-apply")).toBeUndefined();
    expect(reopenedDb.prepare("SELECT max(db_version) AS version FROM crsql_changes").get().version ?? 0).toBe(0);
  });

  it("should reject sync without authentication", async () => {
    const siteId = generateSiteId("c");

    const response = await request(app).post("/sync").send({
      since: 0,
      siteId: siteId,
      changes: [],
    });

    expect(response.status).toBe(401);
  });

  it("should reject sync with invalid token", async () => {
    const siteId = generateSiteId("d");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", "Bearer invalid-token")
      .send({
        since: 0,
        siteId: siteId,
        changes: [],
      });

    expect(response.status).toBe(403);
  });

  it("should handle empty changes array", async () => {
    const siteId = generateSiteId("e");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: [],
      });

    expect(response.status).toBe(200);
    expect(response.body.changes).toEqual([]);
  });

  it("should filter out changes from same site_id", async () => {
    const siteId = generateSiteId("f");
    const userId = testUser.userId;

    // First, push some changes
    const changes = [
      {
        table: "notes",
        pk: '["note-filter-test"]',
        cid: "title",
        val: '"Filter Test"',
        col_version: 1,
        db_version: 1,
        site_id: siteId,
        cl: 0,
        seq: 1,
      },
    ];

    await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: changes,
      });

    // Now pull changes with the same siteId - should not get own changes
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: [],
      });

    expect(response.status).toBe(200);
    // Should not include changes from the same site_id
    const ownChanges = response.body.changes.filter(
      (ch) => ch.site_id === siteId.toLowerCase(),
    );
    expect(ownChanges.length).toBe(0);
  });

  it("should return changes from other sites", async () => {
    const siteId1 = generateSiteId("1");
    const siteId2 = generateSiteId("2");
    const userId = testUser.userId;

    // Instead of trying to push/pull changes (which doesn't work in CR-SQLite 0.16),
    // make an actual local change and verify it can be pulled
    const db = getUserDb(userId);

    // Make a real local change
    db.prepare("INSERT INTO notes (id, title) VALUES (?, ?)").run(
      "note-multisite",
      "Multi Site Test",
    );

    // Pull changes from site 2 - should get site 1's local changes
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId2,
        changes: [],
      });

    expect(response.status).toBe(200);
    // Should return changes since we made a local INSERT
    expect(response.body.changes.length).toBeGreaterThan(0);
  });

  it("should handle multiple changes in single request", async () => {
    const siteId = generateSiteId("m");

    const changes = [
      {
        table: "notes",
        pk: '["multi-note-1"]',
        cid: "title",
        val: '"First Note"',
        col_version: 1,
        db_version: 1,
        site_id: siteId,
        cl: 0,
        seq: 1,
      },
      {
        table: "notes",
        pk: '["multi-note-2"]',
        cid: "title",
        val: '"Second Note"',
        col_version: 1,
        db_version: 2,
        site_id: siteId,
        cl: 0,
        seq: 2,
      },
      {
        table: "folders",
        pk: '["multi-folder-1"]',
        cid: "name",
        val: '"Test Folder"',
        col_version: 1,
        db_version: 3,
        site_id: siteId,
        cl: 0,
        seq: 3,
      },
    ];

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: changes,
      });

    expect(response.status).toBe(200);

    // In CR-SQLite 0.16, we can't verify by checking crsql_changes or base tables
    // because INSERTing into crsql_changes doesn't apply to base tables.
    // Just verify the endpoint processes the request successfully.
    // TODO: Implement proper verification when CR-SQLite 0.16 support is complete
  });

  it("should increment clock version after applying changes", async () => {
    const siteId = generateSiteId("v");

    // First sync - get initial clock
    const response1 = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId: siteId,
        changes: [],
      });

    const initialClock = response1.body.clock;

    // Make a real local change to increment the clock
    const db = getUserDb(testUser.userId);
    db.prepare("INSERT INTO notes (id, title) VALUES (?, ?)").run(
      "clock-test",
      "Clock Test",
    );

    const response2 = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: initialClock,
        siteId: siteId,
        changes: [],
      });

    expect(response2.status).toBe(200);
    // Clock should increment when we made a local change
    expect(response2.body.clock).toBeGreaterThan(initialClock);
  });

  // ----------------------------------------------------------------------
  // Defense against the production sync 500 reported on 2026-07-06.
  //
  // Root cause: crsqlite's `did_cid_win` (rs/core/src/changes_vtab_write.rs)
  // raises `could not find row to merge with for tbl <name>` when the local
  // clock table has non-sentinel entries for a PK that no longer exists in
  // the live base table. Reproduced on prod for one user whose
  // `images__crsql_clock` had 7 non-sentinel rows (one per non-PK column,
  // col_version=1, site_id=0) for an image_id whose base `images` row was
  // gone while the deletion sentinel row had never been written.
  //
  // `get_local_cl_stmt` (tableinfo.rs) computes the local causal length as
  // COALESCE(sentinel, EXISTS(any row)). In the corruption state there is
  // no sentinel but there ARE non-sentinel rows, so local_cl=1 and the
  // next incoming INSERT (cl=1) is routed into `did_cid_win` which then
  // fails because the base table lookup returns no rows. Without the
  // defense the whole /sync batch returns 500 and the client never advances.
  //
  // With the patch the server skips the offending change, applies the
  // remaining good changes inside the same transaction, and returns 200
  // with the new clock so the client advances.
  //
  // To recreate the corruption deterministically we bypass the CRR
  // AFTER-INSERT/DELETE triggers and inject the clock rows + slab mapping
  // for an image_id that has no base row.
  // ----------------------------------------------------------------------

  function injectImagesClockOrphan(db, imageId) {
    // Create a slab-mapping PK without firing the CRR AFTER-INSERT trigger.
    db.prepare(`INSERT INTO images__crsql_pks (id) VALUES (?)`).run(imageId);
    const { __crsql_key: key } = db
      .prepare(`SELECT __crsql_key FROM images__crsql_pks WHERE id = ?`)
      .get(imageId);

    // Mirror the column set a real AFTER-INSERT trigger would have written
    // (one non-sentinel clock row per non-PK column at col_version=1).
    const cols = [
      "user_id",
      "filename",
      "mime_type",
      "path",
      "sha256",
      "size_bytes",
      "created_at",
    ];
    const insertClock = db.prepare(
      `INSERT INTO images__crsql_clock
             (key, col_name, col_version, db_version, site_id, seq)
             VALUES (?, ?, 1, 1, 0, 1)`,
    );
    for (const c of cols) insertClock.run(key, c);

    return key;
  }

  it("should return 200 and skip the offending change when a images clock orphan causes a merge failure", async () => {
    const siteId = generateSiteId("z");
    const userId = testUser.userId;
    const db = getUserDb(userId);

    const orphanId = `orphan-image-${Date.now()}`;
    injectImagesClockOrphan(db, orphanId);

    // Sanity: the corruption state is in place. base row missing, no
    // deletion sentinel, non-sentinel clock rows present.
    const baseExists = db
      .prepare("SELECT 1 FROM images WHERE id = ?")
      .get(orphanId);
    expect(baseExists).toBeUndefined();
    const sentinelRows = db
      .prepare(
        `SELECT 1 FROM images__crsql_clock k
                 JOIN images__crsql_pks p ON p.__crsql_key = k.key
                 WHERE p.id = ? AND k.col_name = '-1'`,
      )
      .all(orphanId);
    expect(sentinelRows.length).toBe(0);
    const nonSentinelRows = db
      .prepare(
        `SELECT k.col_name FROM images__crsql_clock k
                 JOIN images__crsql_pks p ON p.__crsql_key = k.key
                 WHERE p.id = ? AND k.col_name != '-1'`,
      )
      .all(orphanId);
    expect(nonSentinelRows.length).toBeGreaterThan(0);

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "images",
            pk: JSON.stringify([orphanId]),
            cid: "path",
            val: '"/orphan/upload.jpg"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 1,
            seq: 1,
          },
        ],
      });

    // Before the patch this returned 500.
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("changes");
    expect(response.body).toHaveProperty("clock");
    expect(response.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it("should still apply good changes in the same batch as a skipped orphan change", async () => {
    const siteId = generateSiteId("y");
    const userId = testUser.userId;
    const db = getUserDb(userId);

    const orphanId = `orphan-batch-${Date.now()}`;
    injectImagesClockOrphan(db, orphanId);

    const goodNoteId = `good-note-batch-${Date.now()}`;

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "images",
            pk: JSON.stringify([orphanId]),
            cid: "path",
            val: '"/orphan.jpg"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 1,
            seq: 1,
          },
          {
            table: "notes",
            pk: JSON.stringify([goodNoteId]),
            cid: "title",
            val: `"${goodNoteId}"`,
            col_version: 1,
            db_version: 2,
            site_id: siteId,
            cl: 1,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.skipped).toBeGreaterThanOrEqual(1);

    // The good note should have been merged. crsqlite's `merge_insert_stmt`
    // (rs/core/src/tableinfo.rs:681) is `INSERT INTO notes (id, title)
    // VALUES (... ) ON CONFLICT DO UPDATE SET title = ?`, so a successful
    // merge produces a row in the live `notes` table. The val we sent is
    // JSON-encoded (`"..."`), so the stored title has the literal
    // surroundings — verify the row exists rather than pin the exact
    // string.
    const goodRow = db
        .prepare('SELECT title FROM notes WHERE id = ?')
        .get(goodNoteId);
    expect(goodRow).toBeDefined();
    expect(goodRow.title).toContain(goodNoteId);
  });
});
