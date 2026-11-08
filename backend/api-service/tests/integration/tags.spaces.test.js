// Tag styles in shared spaces (docs/specs/active/tag-system.md §6): a space's /sync
// carries `tags` rows to every member and refuses columns it does not name, and a
// cross-database transfer copies the styles the destination lacks, once.
import request from "supertest";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "@panino/content-merge";
import { deleteTestDb, getDb, getSpacesDb, initializeSpacesDb } from "../../db.js";
import { addEditorMember, createSpace } from "../../spaces.js";
import {
  cleanupTestUser,
  createTestApp,
  generateSiteId,
  getTestToken,
  setupTestUser,
} from "../testHelpers.js";

const FLAG = "SHARED_SPACES_ENABLED";
const ORIGINAL_FLAG = process.env[FLAG];

function tagChange(siteId, name, cid, val, seq) {
  return {
    table: "tags",
    pk: JSON.stringify([name]),
    cid,
    val,
    col_version: 1,
    db_version: 1,
    site_id: siteId,
    cl: 1,
    seq,
  };
}

function styleTag(db, name, color, displayName = "") {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tags (name, display_name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(name, displayName, color, now, now);
}

describe("tags in shared spaces", () => {
  let app;
  let server;
  let owner;
  let editor;
  let spaceId;

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });

  beforeEach(async () => {
    process.env[FLAG] = "true";
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    owner = await setupTestUser(`tags-owner-${stamp}@example.test`, "password123");
    editor = await setupTestUser(`tags-editor-${stamp}@example.test`, "password123");
    spaceId = createSpace({ actorUserId: owner.userId, name: "Tagged" }).spaceId;
    addEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
  });

  afterEach(() => {
    const spaces = getSpacesDb();
    spaces.prepare("DELETE FROM space_transfers WHERE actor_user_id IN (?, ?)").run(owner.userId, editor.userId);
    spaces.prepare("DELETE FROM space_members WHERE space_id = ?").run(spaceId);
    spaces.prepare("DELETE FROM space_invites WHERE space_id = ?").run(spaceId);
    spaces.prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
    spaces.prepare("DELETE FROM space_user_versions WHERE user_id IN (?, ?)").run(owner.userId, editor.userId);
    deleteTestDb(`space:${spaceId}`);
    cleanupTestUser(owner.userId);
    cleanupTestUser(editor.userId);
  });

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_FLAG;
    return new Promise((resolve) => server.close(resolve));
  });

  const auth = (user) => ({ Authorization: `Bearer ${getTestToken(user.userId)}` });

  it("accepts a tag style from one member and serves it to another", async () => {
    const ownerSite = generateSiteId("a");
    const upload = await request(app)
      .post("/sync")
      .set(auth(owner))
      .send({
        space: spaceId,
        since: 0,
        siteId: ownerSite,
        changes: [
          tagChange(ownerSite, "urgent", "color", "red", 0),
          tagChange(ownerSite, "urgent", "display_name", "Urgent", 1),
          tagChange(ownerSite, "urgent", "created_at", "2026-11-08T10:00:00.000Z", 2),
          tagChange(ownerSite, "urgent", "updated_at", "2026-11-08T10:00:00.000Z", 3),
        ],
      });
    expect(upload.status).toBe(200);
    expect(getDb(`space:${spaceId}`).prepare("SELECT display_name, color FROM tags WHERE name = 'urgent'").get())
      .toEqual({ display_name: "Urgent", color: "red" });

    const pull = await request(app)
      .post("/sync")
      .set(auth(editor))
      .send({ space: spaceId, since: 0, siteId: generateSiteId("b"), changes: [] });
    expect(pull.status).toBe(200);
    const colors = pull.body.changes.filter((change) => change.table === "tags" && change.cid === "color");
    expect(colors.map((change) => change.val)).toEqual(["red"]);
  });

  it("rejects a tags column the allowlist does not name, merging nothing", async () => {
    const siteId = generateSiteId("c");
    const response = await request(app)
      .post("/sync")
      .set(auth(owner))
      .send({
        space: spaceId,
        since: 0,
        siteId,
        changes: [
          tagChange(siteId, "urgent", "color", "red", 0),
          tagChange(siteId, "urgent", "user_id", owner.userId, 1),
        ],
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("SPACE_CHANGE_NOT_ALLOWED");
    expect(getDb(`space:${spaceId}`).prepare("SELECT 1 FROM tags").get()).toBeUndefined();
  });

  it("accepts a tag reset (tombstone) from a member", async () => {
    const db = getDb(`space:${spaceId}`);
    styleTag(db, "old", "teal");
    const siteId = generateSiteId("d");
    const response = await request(app)
      .post("/sync")
      .set(auth(editor))
      .send({
        space: spaceId,
        since: 0,
        siteId,
        changes: [{ ...tagChange(siteId, "old", "-1", null, 0), cl: 2, col_version: 1 }],
      });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT 1 FROM tags WHERE name = 'old'").get()).toBeUndefined();
  });

  describe("moving a Document between databases", () => {
    function seedSource(content) {
      const dbKey = `user:${owner.userId}`;
      const db = getDb(dbKey);
      const noteId = uuidv4();
      const updatedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
         VALUES (?, ?, NULL, 'Tagged', ?, ?, ?)`,
      ).run(noteId, owner.userId, content, updatedAt, updatedAt);
      return { db, dbKey, noteId, content, updatedAt };
    }

    const CONTENT = "---\ntitle: Plan\ntags:\n  - Work\n  - urgent\n  - plain\n  - unstyled\n---\n\nBody";

    it("copies the styles the destination lacks and leaves its own untouched", async () => {
      const source = seedSource(CONTENT);
      styleTag(source.db, "work", "red", "Work");
      styleTag(source.db, "urgent", "orange");
      styleTag(source.db, "plain", "");
      styleTag(source.db, "elsewhere", "green");
      const destination = getDb(`space:${spaceId}`);
      styleTag(destination, "urgent", "violet", "URGENT");

      const response = await request(app)
        .post("/space-transfers")
        .set(auth(owner))
        .send({
          sourceDbKey: source.dbKey,
          destinationDbKey: `space:${spaceId}`,
          sourceNoteId: source.noteId,
          destinationFolderId: null,
          mode: "move",
        })
        .expect(201);
      expect(response.body.transfer.status).toBe("complete");

      const rows = destination.prepare("SELECT name, display_name, color FROM tags ORDER BY name").all();
      expect(rows).toEqual([
        { name: "urgent", display_name: "URGENT", color: "violet" },
        { name: "work", display_name: "Work", color: "red" },
      ]);
      const record = getSpacesDb().prepare("SELECT copied_tags_json FROM space_transfers WHERE id = ?")
        .get(response.body.transfer.id);
      expect(JSON.parse(record.copied_tags_json)).toEqual(["work"]);
      // The source keeps its styles.
      expect(source.db.prepare("SELECT color FROM tags WHERE name = 'work'").get().color).toBe("red");
    });

    async function pendingTransfer(source, copiedTagsJson) {
      const transferId = uuidv4();
      getSpacesDb().prepare(
        `INSERT INTO space_transfers (
           id, actor_user_id, source_db_key, destination_db_key, source_note_id, destination_note_id,
           destination_folder_id, source_updated_at, source_content_sha256, status,
           image_map_json, warnings_json, created_at, updated_at, keep_source, copied_tags_json
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'checkpointed', '{}', '[]', ?, ?, 1, ?)`,
      ).run(transferId, owner.userId, source.dbKey, `space:${spaceId}`, source.noteId, uuidv4(),
        source.updatedAt, await contentHash(source.content), new Date().toISOString(),
        new Date().toISOString(), copiedTagsJson);
      return transferId;
    }

    it("does not repeat the step when a resumed transfer has already recorded it", async () => {
      const source = seedSource(CONTENT);
      styleTag(source.db, "work", "red");
      // As if an earlier attempt copied `work` and a member then reset it.
      const transferId = await pendingTransfer(source, JSON.stringify(["work"]));

      const retried = await request(app)
        .post(`/space-transfers/${transferId}/retry`)
        .set(auth(owner))
        .expect(200);
      expect(retried.body.transfer.status).toBe("kept_both");
      expect(getDb(`space:${spaceId}`).prepare("SELECT 1 FROM tags").get()).toBeUndefined();
    });

    it("runs the step on a resumed transfer that has not recorded it", async () => {
      const source = seedSource(CONTENT);
      styleTag(source.db, "work", "red");
      const transferId = await pendingTransfer(source, null);

      await request(app).post(`/space-transfers/${transferId}/retry`).set(auth(owner)).expect(200);
      expect(getDb(`space:${spaceId}`).prepare("SELECT color FROM tags WHERE name = 'work'").get())
        .toEqual({ color: "red" });
    });
  });

  it("adds the copied-tags column to a transfer database without raising its version", () => {
    const db = new Database(":memory:");
    initializeSpacesDb(db);
    db.exec("ALTER TABLE space_transfers DROP COLUMN copied_tags_json");
    initializeSpacesDb(db);
    const columns = db.prepare("PRAGMA table_info('space_transfers')").all().map((column) => column.name);
    expect(columns).toContain("copied_tags_json");
    expect(db.prepare("SELECT MAX(version) AS version FROM spaces_schema_migrations").get().version).toBe(3);
    db.close();
  });
});
