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
import { createHash } from "crypto";
import { gzipSync } from "zlib";
import {
  createTestApp,
  setupTestUser,
  cleanupTestUser,
  getTestToken,
  generateSiteId,
} from "../testHelpers.js";
import { getUserDb } from "../../db.js";

function insertRevision(
  db,
  { id, noteId, title, content, type = "auto", createdAt = "datetime('now')" },
) {
  const safeContent = String(content ?? "");
  const gz = gzipSync(Buffer.from(safeContent, "utf8"));
  const sha = createHash("sha256").update(safeContent, "utf8").digest("hex");
  db.prepare(
    `
    INSERT INTO note_revisions (
      id, note_id, title, content_gzip, type, content_sha256,
      uncompressed_bytes, compressed_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${createdAt})
  `,
  ).run(
    id,
    noteId,
    title ?? null,
    gz,
    type,
    sha,
    Buffer.byteLength(safeContent, "utf8"),
    gz.length,
  );
}

function bufferToNumericKeyObject(buffer) {
  return Object.fromEntries(
    [...buffer].map((value, index) => [String(index), value]),
  );
}

describe("Sync revision capture", () => {
  let app;
  let server;
  let testUser;
  let token;

  beforeAll(() => {
    const created = createTestApp();
    app = created.app;
    server = created.server;
  });

  beforeEach(async () => {
    testUser = await setupTestUser(
      `sync-revision-${Date.now()}@example.com`,
      "password123",
    );
    token = getTestToken(testUser.userId);

    const db = getUserDb(testUser.userId);
    db.prepare(
      `
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `,
    ).run("note-sync", testUser.userId, "Base title", "# base content");
  });

  afterEach(() => {
    if (testUser) cleanupTestUser(testUser.userId);
  });

  afterAll(
    () =>
      new Promise((resolve) => {
        if (server) return server.close(resolve);
        return resolve();
      }),
  );

  it("captures content/title changes directly from incoming change set", async () => {
    const siteId = generateSiteId("c");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "title",
            val: '"New title"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# from change set"',
            col_version: 1,
            db_version: 2,
            site_id: siteId,
            cl: 0,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latest = db
      .prepare(
        `
      SELECT title, type
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `,
      )
      .get("note-sync");

    expect(latest).toBeDefined();
    expect(latest.title).toBe("New title");
    expect(latest.type).toBe("auto");
  });

  it("captures auto revision when note pk is sent as packed numeric-key object", async () => {
    const siteId = generateSiteId("k");
    const db = getUserDb(testUser.userId);
    const packedPk = db
      .prepare("SELECT crsql_pack_columns(?) as pk")
      .get("note-sync").pk;

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: bufferToNumericKeyObject(packedPk),
            cid: "content",
            val: '"# from packed pk"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const latest = db
      .prepare(
        `
      SELECT note_id, type
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `,
      )
      .get("note-sync");

    expect(latest).toBeDefined();
    expect(latest.note_id).toBe("note-sync");
    expect(latest.type).toBe("auto");
  });

  it("skips revision capture when sync mutation references a note absent from the base table", async () => {
    const siteId = generateSiteId("z");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["missing-note"]',
            cid: "title",
            val: '"Missing note title"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const revisionCount = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM note_revisions
      WHERE note_id = ?
    `,
      )
      .get("missing-note");

    expect(revisionCount.count).toBe(0);
  });

  it("keeps the last content value when multiple content changes exist in one payload", async () => {
    const siteId = generateSiteId("g");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# first"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# second"',
            col_version: 2,
            db_version: 2,
            site_id: siteId,
            cl: 0,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latestRevision = db
      .prepare(
        `
      SELECT id
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `,
      )
      .get("note-sync");

    const detail = await request(app)
      .get(`/notes/note-sync/revisions/${latestRevision.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.revision.content).toBe("# second");
  });

  it("captures title-only change using existing base-table content", async () => {
    const siteId = generateSiteId("d");

    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "title",
            val: '"Renamed only"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latest = db
      .prepare(
        `
      SELECT content_gzip
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `,
      )
      .get("note-sync");

    expect(latest).toBeDefined();

    const detail = await request(app)
      .get(
        "/notes/note-sync/revisions/" +
          db
            .prepare(
              `
        SELECT id FROM note_revisions WHERE note_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
      `,
            )
            .get("note-sync").id,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.revision.content).toBe("# base content");
  });

  it("enforces auto capture throttle across rapid sync requests", async () => {
    const siteId1 = generateSiteId("h");
    const siteId2 = generateSiteId("i");

    const first = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId: siteId1,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# throttle-1"',
            col_version: 1,
            db_version: 1,
            site_id: siteId1,
            cl: 0,
            seq: 1,
          },
        ],
      });

    const second = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId: siteId2,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# throttle-2"',
            col_version: 2,
            db_version: 2,
            site_id: siteId2,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const autoCount = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM note_revisions
      WHERE note_id = ? AND type = 'auto'
    `,
      )
      .get("note-sync");

    expect(autoCount.count).toBe(1);
  });

  it("creates a new auto revision after throttle window has elapsed", async () => {
    const db = getUserDb(testUser.userId);
    insertRevision(db, {
      id: "old-auto",
      noteId: "note-sync",
      title: "Older auto",
      content: "# old throttle content",
      type: "auto",
      createdAt: "datetime('now', '-6 minutes')",
    });

    const siteId = generateSiteId("j");
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "content",
            val: '"# new post-window content"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const autoCount = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM note_revisions
      WHERE note_id = ? AND type = 'auto'
    `,
      )
      .get("note-sync");

    expect(autoCount.count).toBe(2);
  });

  it("enforces auth from JWT middleware only", async () => {
    const response = await request(app)
      .post("/sync")
      .send({
        userId: testUser.userId,
        since: 0,
        siteId: generateSiteId("e"),
        changes: [],
      });

    expect(response.status).toBe(401);
  });

  it("proactively deletes revisions on notes tombstone change", async () => {
    const db = getUserDb(testUser.userId);
    db.prepare(
      `
      INSERT INTO note_revisions (
        id, note_id, title, content_gzip, type, content_sha256,
        uncompressed_bytes, compressed_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    ).run(
      "rev-to-delete",
      "note-sync",
      "Title",
      Buffer.from([
        31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
      "manual",
      "hash",
      0,
      20,
    );

    const siteId = generateSiteId("f");
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "-1",
            val: null,
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 1,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const remaining = db
      .prepare("SELECT COUNT(*) as count FROM note_revisions WHERE note_id = ?")
      .get("note-sync");
    expect(remaining.count).toBe(0);
  });

  // Regression test for the production sync 500 (SQLITE_CONSTRAINT_FOREIGNKEY)
  // observed when a client pushes a real crsqlite delete-tombstone (cl=2) for
  // a note that has rows in note_revisions. The crsqlite merge_delete runs
  // DELETE FROM notes during the crsql_changes inserts in Loop 1; with a
  // non-cascade FK and PRAGMA foreign_keys = ON that aborted the transaction
  // before Loop 2 could clean up the child rows. The structural fix is the
  // ON DELETE CASCADE on note_revisions.note_id (see ensureNoteRevisionsSchema
  // in db.js); defer_foreign_keys inside applyChanges is the safety net.
  it("sync-deletes a note with revisions using a cl=2 tombstone without 500", async () => {
    const db = getUserDb(testUser.userId);

    // Insert a note plus a revision plus a revision_meta row, mimicking a note
    // that has been edited and snapshotted before being deleted.
    db.prepare(
      `
      INSERT INTO note_revisions (
        id, note_id, title, content_gzip, type, content_sha256,
        uncompressed_bytes, compressed_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    ).run(
      "rev-cl2",
      "note-sync",
      "Daily 2026-06-29",
      Buffer.from([
        31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
      "auto",
      "fake-sha",
      0,
      20,
    );
    db.prepare(
      `
      INSERT INTO note_revision_meta (note_id, last_pruned_at)
      VALUES (?, datetime('now'))
    `,
    ).run("note-sync");

    const siteId = generateSiteId("p");
    // Real crsqlite delete tombstones arrive with cl=2 (the row's columns are
    // all zeroed; crsqlite's merge_delete fires a DELETE against the base
    // table). cid=-1, val=null signals the delete sentinel.
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "-1",
            val: null,
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 2,
            seq: 1,
          },
        ],
      });

    // No more 500. Before the cascade fix this was
    // SQLITE_CONSTRAINT_FOREIGNKEY → rollback → 500.
    expect(response.status).toBe(200);

    const noteRow = db
      .prepare("SELECT COUNT(*) as count FROM notes WHERE id = ?")
      .get("note-sync");
    expect(noteRow.count).toBe(0);

    const remainingRevisions = db
      .prepare("SELECT COUNT(*) as count FROM note_revisions WHERE note_id = ?")
      .get("note-sync");
    expect(remainingRevisions.count).toBe(0);

    // note_revision_meta has no FK to notes, so it is cleaned up by the
    // application-level deleteNoteRevisionsForDeletedNote call in Loop 2.
    const remainingMeta = db
      .prepare(
        "SELECT COUNT(*) as count FROM note_revision_meta WHERE note_id = ?",
      )
      .get("note-sync");
    expect(remainingMeta.count).toBe(0);
  });

  it("captures a non-delete notes update without stray revision cleanup", async () => {
    const db = getUserDb(testUser.userId);

    // An independent note we do NOT touch in the sync payload — its revisions
    // (if any) must survive untouched.
    db.prepare(
      `
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `,
    ).run("note-untouched", testUser.userId, "Untouched", "# untouched body");

    db.prepare(
      `
      INSERT INTO note_revisions (
        id, note_id, title, content_gzip, type, content_sha256,
        uncompressed_bytes, compressed_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    ).run(
      "rev-untouched",
      "note-untouched",
      "Untouched",
      Buffer.from([
        31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
      "manual",
      "untouched-sha",
      0,
      20,
    );

    db.prepare(
      `
      INSERT INTO note_revision_meta (note_id, last_pruned_at)
      VALUES (?, datetime('now'))
    `,
    ).run("note-untouched");

    const untouchedMetaBefore = db
      .prepare(
        "SELECT COUNT(*) as count FROM note_revision_meta WHERE note_id = ?",
      )
      .get("note-untouched").count;
    expect(untouchedMetaBefore).toBe(1);

    const siteId = generateSiteId("u");
    const response = await request(app)
      .post("/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: "notes",
            pk: '["note-sync"]',
            cid: "title",
            val: '"Renamed via update only"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 1,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    // The synthetic change is used to exercise revision capture; the fixture's
    // direct base-table insert has no CR-SQLite clock row for merge-update to
    // rewrite, so the base row remains present.
    const updatedNote = db
      .prepare("SELECT title FROM notes WHERE id = ?")
      .get("note-sync");
    expect(updatedNote).toBeDefined();

    const capturedRevision = db
      .prepare(
        "SELECT title FROM note_revisions WHERE note_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1",
      )
      .get("note-sync");
    expect(capturedRevision.title).toBe("Renamed via update only");

    // The untouched note's revision and meta rows survive — no stray cleanup.
    const untouchedRev = db
      .prepare("SELECT COUNT(*) as count FROM note_revisions WHERE note_id = ?")
      .get("note-untouched").count;
    expect(untouchedRev).toBe(1);
    const untouchedMeta = db
      .prepare(
        "SELECT COUNT(*) as count FROM note_revision_meta WHERE note_id = ?",
      )
      .get("note-untouched").count;
    expect(untouchedMeta).toBe(1);
  });
});
