import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteTestDb, getDb, getSpacesDb } from "../../db.js";
import { createSpace } from "../../spaces.js";
import {
  deleteSpaceUploads,
  resolveDatabaseUploadRoot,
  resolveStoredImagePath,
} from "../../spaceStorage.js";
import {
  cleanupTestUser,
  createTestApp,
  getTestToken,
  setupTestUser,
} from "../testHelpers.js";

const FLAG = "SHARED_SPACES_ENABLED";
const ORIGINAL_FLAG = process.env[FLAG];

describe("resumable cross-database Document transfer", () => {
  let app;
  let server;
  let owner;
  let outsider;
  let spaceId;
  const personalFiles = [];

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });

  beforeEach(async () => {
    process.env[FLAG] = "true";
    const stamp = `${Date.now()}-${Math.random()}`;
    owner = await setupTestUser(`transfer-owner-${stamp}@example.test`, "password123");
    outsider = await setupTestUser(`transfer-outsider-${stamp}@example.test`, "password123");
    spaceId = createSpace({ actorUserId: owner.userId, name: "Writers" }).spaceId;
  });

  afterEach(() => {
    const spaces = getSpacesDb();
    spaces.prepare("DELETE FROM space_transfers WHERE actor_user_id IN (?, ?)").run(owner.userId, outsider.userId);
    spaces.prepare("DELETE FROM space_invites WHERE space_id = ?").run(spaceId);
    spaces.prepare("DELETE FROM space_members WHERE space_id = ?").run(spaceId);
    spaces.prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
    spaces.prepare("DELETE FROM space_user_versions WHERE user_id IN (?, ?)").run(owner.userId, outsider.userId);
    deleteTestDb(`space:${spaceId}`);
    deleteSpaceUploads(spaceId);
    for (const filePath of personalFiles.splice(0)) fs.rmSync(filePath, { force: true });
    cleanupTestUser(owner.userId);
    cleanupTestUser(outsider.userId);
  });

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_FLAG;
    return new Promise((resolve) => server.close(resolve));
  });

  const auth = (user) => ({ Authorization: `Bearer ${getTestToken(user.userId)}` });

  function seedPersonalDocument() {
    const dbKey = `user:${owner.userId}`;
    const db = getDb(dbKey);
    const noteId = uuidv4();
    const imageId = uuidv4();
    const missingId = uuidv4();
    const bytes = Buffer.from("verified-image-bytes");
    const relativePath = `${imageId}.png`;
    const uploadRoot = resolveDatabaseUploadRoot(dbKey);
    fs.mkdirSync(uploadRoot, { recursive: true });
    const imagePath = path.join(uploadRoot, relativePath);
    fs.writeFileSync(imagePath, bytes);
    personalFiles.push(imagePath);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    db.prepare(
      `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
       VALUES (?, ?, 'hero.png', 'image/png', ?, ?, ?, ?)`,
    ).run(imageId, owner.userId, relativePath, bytes.length, hash, new Date().toISOString());
    const canonical = `/images/${imageId}`;
    const content = [
      `![hero](${canonical})`,
      `![missing](/images/${missingId})`,
      `![noncanonical](${canonical}?unexpected=1)`,
      `[ordinary](${canonical})`,
      `\`![code](${canonical})\``,
    ].join("\n");
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
       VALUES (?, ?, NULL, 'Transfer me', ?, ?, ?)`,
    ).run(noteId, owner.userId, content, updatedAt, updatedAt);
    db.prepare(
      `INSERT INTO note_revisions (
         id, note_id, title, content_gzip, type, content_sha256,
         uncompressed_bytes, compressed_bytes, created_at, actor_user_id, actor_kind
       ) VALUES (?, ?, 'Transfer me', ?, 'manual', 'hash', 1, 1, ?, ?, 'sync')`,
    ).run(uuidv4(), noteId, Buffer.from("x"), updatedAt, owner.userId);
    return { db, dbKey, noteId, imageId, missingId, canonical, content, updatedAt };
  }

  function createTransfer(source) {
    return request(app)
      .post("/space-transfers")
      .set(auth(owner))
      .send({
        sourceDbKey: source.dbKey,
        destinationDbKey: `space:${spaceId}`,
        sourceNoteId: source.noteId,
        destinationFolderId: null,
        mode: "move",
      });
  }

  it("copies and verifies canonical images, preserves warnings, then deletes only the source Document", async () => {
    const source = seedPersonalDocument();
    const response = await createTransfer(source).expect(201);

    expect(response.body.transfer).toMatchObject({
      status: "complete",
      revisionHistoryTransferred: false,
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_IMAGE_MISSING", imageId: source.missingId }),
      ]),
    });
    expect(response.body.transfer.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "NONCANONICAL_SOURCE_IMAGE", imageId: source.imageId }),
    ]));
    expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeUndefined();
    // Revision history is backend-local and disappears with the deleted source
    // note; it is intentionally never copied to the destination database.
    const destination = getDb(`space:${spaceId}`);
    const copied = destination.prepare("SELECT content FROM notes WHERE id = ?")
      .get(response.body.transfer.destinationNoteId);
    expect(copied.content).toContain(`?space=${spaceId}`);
    expect(copied.content).toContain(`/images/${source.missingId}`);
    expect(copied.content).toContain(`[ordinary](${source.canonical})`);
    expect(copied.content).toContain(`![noncanonical](${source.canonical}?unexpected=1)`);
    expect(copied.content).toContain(`\`![code](${source.canonical})\``);
    const copiedImage = destination.prepare("SELECT * FROM images").get();
    const copiedPath = resolveStoredImagePath(`space:${spaceId}`, copiedImage.path);
    expect(fs.readFileSync(copiedPath)).toEqual(Buffer.from("verified-image-bytes"));
    expect(crypto.createHash("sha256").update(fs.readFileSync(copiedPath)).digest("hex"))
      .toBe(copiedImage.sha256);
    // None of the source's history arrives; the copy starts with one revision
    // of what was transferred, attributed to the member who moved it.
    expect(destination.prepare(
      "SELECT note_id AS noteId, actor_user_id AS actor, actor_kind AS kind FROM note_revisions",
    ).all()).toEqual([{ noteId: response.body.transfer.destinationNoteId, actor: owner.userId, kind: "system" }]);
  });

  /** A personal Document whose one image is linked the way the given frontend build writes it. */
  function seedDocumentWithImage(linkFor, { bytes = Buffer.from("image-bytes-as-uploaded") } = {}) {
    const dbKey = `user:${owner.userId}`;
    const db = getDb(dbKey);
    const noteId = uuidv4();
    const imageId = uuidv4();
    const relativePath = `${imageId}.png`;
    const imagePath = path.join(resolveDatabaseUploadRoot(dbKey), relativePath);
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, bytes);
    personalFiles.push(imagePath);
    db.prepare(
      `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
       VALUES (?, ?, 'shot.png', 'image/png', ?, ?, ?, ?)`,
    ).run(imageId, owner.userId, relativePath, bytes.length, crypto.createHash("sha256").update(bytes).digest("hex"), new Date().toISOString());
    const content = `# Report\n\n![shot](${linkFor(imageId)})\n`;
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
       VALUES (?, ?, NULL, 'Report', ?, ?, ?)`,
    ).run(noteId, owner.userId, content, updatedAt, updatedAt);
    return { db, dbKey, noteId, imageId, content, updatedAt, bytes };
  }

  it("moves the images of a Document written by the production frontend", async () => {
    // Production writes "/api/images/<id>". The rewriter used to know only
    // "/images/<id>": nothing was copied, nothing was warned about, the transfer
    // said "complete", and the other members saw a broken image.
    const source = seedDocumentWithImage((id) => `/api/images/${id}`);

    const response = await createTransfer(source).expect(201);

    expect(response.body.transfer).toMatchObject({ status: "complete", warnings: [] });
    const destination = getDb(`space:${spaceId}`);
    const copiedImage = destination.prepare("SELECT id, path, sha256 FROM images").get();
    expect(copiedImage).toBeTruthy();
    expect(fs.readFileSync(resolveStoredImagePath(`space:${spaceId}`, copiedImage.path))).toEqual(source.bytes);
    const copied = destination.prepare("SELECT content FROM notes WHERE id = ?").get(response.body.transfer.destinationNoteId);
    expect(copied.content).toBe(`# Report\n\n![shot](/api/images/${copiedImage.id}?space=${spaceId})\n`);

    // What a member's browser then asks for is served.
    await request(app)
      .get(`/images/${copiedImage.id}?space=${spaceId}`)
      .set(auth(owner))
      .expect(200);
  });

  it("moves the images of a Document written by the development frontend", async () => {
    const before = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = "http://localhost:8000";
    try {
      const source = seedDocumentWithImage((id) => `http://localhost:8000/images/${id}`);
      const response = await createTransfer(source).expect(201);

      const destination = getDb(`space:${spaceId}`);
      const copiedImage = destination.prepare("SELECT id FROM images").get();
      const copied = destination.prepare("SELECT content FROM notes WHERE id = ?").get(response.body.transfer.destinationNoteId);
      expect(copied.content).toContain(`](http://localhost:8000/images/${copiedImage.id}?space=${spaceId})`);
    } finally {
      if (before === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = before;
    }
  });

  it("refuses to move or copy a Document that is open in a live session, and leaves it untouched", async () => {
    // The session holds text that is not in the stored body yet.
    const spaceDb = getDb(`space:${spaceId}`);
    const noteId = uuidv4();
    const stamp = new Date().toISOString();
    spaceDb.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
       VALUES (?, ?, NULL, 'Being edited', 'stored body', ?, ?)`,
    ).run(noteId, owner.userId, stamp, stamp);
    spaceDb.prepare(
      `INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, durable_sequence, started_at, updated_at)
       VALUES (?, ?, ?, 'stored body', 'hash', 3, ?, ?)`,
    ).run(noteId, uuidv4(), Buffer.from([0]), stamp, stamp);

    // A copy would not lose the text, but it would leave it out without saying so.
    for (const mode of ["move", "copy"]) {
      const response = await request(app)
        .post("/space-transfers")
        .set(auth(owner))
        .send({ sourceDbKey: `space:${spaceId}`, destinationDbKey: `user:${owner.userId}`, sourceNoteId: noteId, mode })
        .expect(409);
      expect(response.body.code).toBe("TRANSFER_SOURCE_IN_SESSION");
    }
    expect(spaceDb.prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content).toBe("stored body");
    expect(getDb(`user:${owner.userId}`).prepare("SELECT COUNT(*) AS n FROM notes").get().n).toBe(0);
    expect(getSpacesDb().prepare("SELECT COUNT(*) AS n FROM space_transfers WHERE actor_user_id = ?").get(owner.userId).n).toBe(0);
  });

  it("refuses a transfer that would take the destination past its image quota", async () => {
    const source = seedDocumentWithImage((id) => `/api/images/${id}`);
    const destination = getDb(`space:${spaceId}`);
    // The space already holds its full gibibyte.
    destination.prepare(
      `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
       VALUES (?, ?, 'big.png', 'image/png', 'big.png', ?, 'hash', ?)`,
    ).run(uuidv4(), owner.userId, 1024 * 1024 * 1024, new Date().toISOString());

    const response = await createTransfer(source).expect(413);

    expect(response.body.code).toBe("TRANSFER_QUOTA_EXCEEDED");
    expect(destination.prepare("SELECT COUNT(*) AS n FROM images").get().n).toBe(1);
    expect(destination.prepare("SELECT COUNT(*) AS n FROM notes").get().n).toBe(0);
    expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();
  });

  it("refuses a Document too large to process in one request", async () => {
    const source = seedDocumentWithImage(() => "x");
    source.db.prepare("UPDATE notes SET content = ? WHERE id = ?").run("a".repeat(2 * 1024 * 1024 + 1), source.noteId);

    const response = await createTransfer(source).expect(413);

    expect(response.body.code).toBe("TRANSFER_SOURCE_TOO_LARGE");
  });

  describe("a transfer that stopped before the Document was copied", () => {
    /** As after a crash during image copy: the row, one copied image, no destination Document. */
    async function stuckTransfer({ keepSource = 0 } = {}) {
      const source = seedDocumentWithImage((id) => `/api/images/${id}`);
      const destination = getDb(`space:${spaceId}`);
      const transferId = uuidv4();
      const copiedId = uuidv4();
      const copiedPath = resolveStoredImagePath(`space:${spaceId}`, `${copiedId}.png`);
      fs.mkdirSync(path.dirname(copiedPath), { recursive: true });
      fs.writeFileSync(copiedPath, source.bytes);
      destination.prepare(
        `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
         VALUES (?, ?, 'shot.png', 'image/png', ?, ?, ?, ?)`,
      ).run(copiedId, owner.userId, `${copiedId}.png`, source.bytes.length,
        crypto.createHash("sha256").update(source.bytes).digest("hex"), new Date().toISOString());
      const { contentHash } = await import("@panino/content-merge");
      getSpacesDb().prepare(
        `INSERT INTO space_transfers (
           id, actor_user_id, source_db_key, destination_db_key, source_note_id, destination_note_id,
           destination_folder_id, source_updated_at, source_content_sha256, status,
           image_map_json, warnings_json, created_at, updated_at, keep_source
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'copying_images', ?, '[]', ?, ?, ?)`,
      ).run(transferId, owner.userId, source.dbKey, `space:${spaceId}`, source.noteId, uuidv4(),
        source.updatedAt, await contentHash(source.content), JSON.stringify({ [source.imageId]: copiedId }),
        new Date().toISOString(), new Date().toISOString(), keepSource);
      return { source, destination, transferId, copiedId, copiedPath };
    }

    it("stays a copy when it is retried: the original is not deleted", async () => {
      // Whether to delete the source is read from the transfer, not from the
      // request that resumes it. Retry used to mean "finish the move".
      const { source, transferId } = await stuckTransfer({ keepSource: 1 });

      const retried = await request(app)
        .post(`/space-transfers/${transferId}/retry`)
        .set(auth(owner))
        .expect(200);

      expect(retried.body.transfer).toMatchObject({ status: "kept_both", mode: "copy", sourceDeletedAt: null });
      expect(source.db.prepare("SELECT content FROM notes WHERE id = ?").get(source.noteId).content)
        .toBe(source.content);
      expect(getDb(`space:${spaceId}`).prepare("SELECT 1 FROM notes WHERE id = ?")
        .get(retried.body.transfer.destinationNoteId)).toBeTruthy();
    });

    it("finishes as a move when it is retried and was a move", async () => {
      const { source, transferId } = await stuckTransfer();

      const retried = await request(app)
        .post(`/space-transfers/${transferId}/retry`)
        .set(auth(owner))
        .expect(200);

      expect(retried.body.transfer).toMatchObject({ status: "complete", mode: "move" });
      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeUndefined();
    });

    it("can be cancelled after the source was edited, removing what it had copied", async () => {
      // This was a dead end: every retry answered "source changed", and keeping
      // both was refused because there was nothing to keep.
      const { source, destination, transferId, copiedId, copiedPath } = await stuckTransfer();
      source.db.prepare("UPDATE notes SET content = content || 'edited', updated_at = ? WHERE id = ?")
        .run(new Date(Date.now() + 1000).toISOString(), source.noteId);

      const retry = await request(app).post(`/space-transfers/${transferId}/retry`).set(auth(owner)).expect(409);
      expect(retry.body.code).toBe("TRANSFER_SOURCE_CHANGED");
      await request(app).post(`/space-transfers/${transferId}/keep-both`).set(auth(owner)).expect(409);

      await request(app).delete(`/space-transfers/${transferId}`).set(auth(owner)).expect(204);

      expect(getSpacesDb().prepare("SELECT 1 FROM space_transfers WHERE id = ?").get(transferId)).toBeUndefined();
      expect(destination.prepare("SELECT 1 FROM images WHERE id = ?").get(copiedId)).toBeUndefined();
      expect(fs.existsSync(copiedPath)).toBe(false);
      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();
      await request(app).get("/space-transfers").set(auth(owner)).expect(200, { transfers: [] });
      // And the Document can be moved afresh.
      await createTransfer(source).expect(201);
    });

    it("cannot be cancelled by anyone else, or once the Document has been copied", async () => {
      const { source, transferId } = await stuckTransfer();
      await request(app).delete(`/space-transfers/${transferId}`).set(auth(outsider)).expect(404);

      const finished = await request(app).post(`/space-transfers/${transferId}/retry`).set(auth(owner)).expect(200);
      expect(finished.body.transfer.status).toBe("complete");
      // Model the crash window in which both copies exist.
      source.db.prepare(
        `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
         VALUES (?, ?, NULL, 'Report', ?, ?, ?)`,
      ).run(source.noteId, owner.userId, source.content, source.updatedAt, source.updatedAt);
      getSpacesDb().prepare("UPDATE space_transfers SET status = 'recoverable_duplicate' WHERE id = ?").run(transferId);

      const refused = await request(app).delete(`/space-transfers/${transferId}`).set(auth(owner)).expect(409);
      expect(refused.body.code).toBe("TRANSFER_RECOVERY_INVALID");
      expect(getDb(`space:${spaceId}`).prepare("SELECT COUNT(*) AS n FROM notes").get().n).toBe(1);
    });
  });

  it("lets a duplicate be kept after its source images are gone", async () => {
    // The check compared against the live source image rows, so deleting the
    // duplicate source by hand made both recovery actions fail for ever.
    const source = seedDocumentWithImage((id) => `/api/images/${id}`);
    const created = await createTransfer(source).expect(201);
    source.db.prepare("DELETE FROM images WHERE id = ?").run(source.imageId);
    getSpacesDb().prepare("UPDATE space_transfers SET status = 'recoverable_duplicate' WHERE id = ?")
      .run(created.body.transfer.id);

    await request(app)
      .post(`/space-transfers/${created.body.transfer.id}/delete-source`)
      .set(auth(owner))
      .expect(200)
      .expect((response) => expect(response.body.transfer.status).toBe("complete"));
  });

  it("forgets finished transfers after a month and untouched ones after three", async () => {
    const source = seedDocumentWithImage((id) => `/api/images/${id}`);
    const created = await createTransfer(source).expect(201);
    const spaces = getSpacesDb();
    const insertLike = (id, status, updatedAt) => spaces.prepare(
      `INSERT INTO space_transfers (
         id, actor_user_id, source_db_key, destination_db_key, source_note_id, destination_note_id,
         destination_folder_id, source_updated_at, source_content_sha256, status,
         image_map_json, warnings_json, created_at, updated_at
       ) SELECT ?, actor_user_id, source_db_key, destination_db_key, source_note_id, ?, NULL,
                source_updated_at, source_content_sha256, ?, '{}', '[]', ?, ? FROM space_transfers WHERE id = ?`,
    ).run(id, uuidv4(), status, updatedAt, updatedAt, created.body.transfer.id);
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const oldFinished = uuidv4(); const recentStuck = uuidv4(); const ancientStuck = uuidv4();
    insertLike(oldFinished, "complete", daysAgo(31));
    insertLike(recentStuck, "checkpointed", daysAgo(31));
    insertLike(ancientStuck, "checkpointed", daysAgo(91));

    await request(app).get("/space-transfers").set(auth(owner)).expect(200);

    const left = spaces.prepare("SELECT id FROM space_transfers WHERE actor_user_id = ?").all(owner.userId).map((row) => row.id);
    expect(left).toContain(created.body.transfer.id);
    expect(left).toContain(recentStuck);
    expect(left).not.toContain(oldFinished);
    expect(left).not.toContain(ancientStuck);
  });

  it("offers durable retry, keep-both, and verified delete-source recovery actions", async () => {
    const source = seedPersonalDocument();
    const created = await createTransfer(source).expect(201);
    const transferId = created.body.transfer.id;

    // Recreate the exact checkpointed source to model a crash after the
    // destination commit but before source deletion/checkpoint cleanup.
    source.db.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
       VALUES (?, ?, NULL, 'Transfer me', ?, ?, ?)`,
    ).run(source.noteId, owner.userId, source.content, source.updatedAt, source.updatedAt);
    getSpacesDb().prepare(
      "UPDATE space_transfers SET status = 'recoverable_duplicate', source_deleted_at = NULL WHERE id = ?",
    ).run(transferId);

    await request(app)
      .post(`/space-transfers/${transferId}/keep-both`)
      .set(auth(owner))
      .expect(200)
      .expect((response) => expect(response.body.transfer.status).toBe("kept_both"));
    expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();

    getSpacesDb().prepare(
      "UPDATE space_transfers SET status = 'recoverable_duplicate' WHERE id = ?",
    ).run(transferId);
    await request(app)
      .post(`/space-transfers/${transferId}/delete-source`)
      .set(auth(owner))
      .expect(200)
      .expect((response) => expect(response.body.transfer.status).toBe("complete"));
    expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeUndefined();

    // Retrying the already completed checkpoint is idempotent.
    await request(app)
      .post(`/space-transfers/${transferId}/retry`)
      .set(auth(owner))
      .expect(200)
      .expect((response) => expect(response.body.transfer.status).toBe("complete"));
  });

  describe("copying instead of moving", () => {
    const copyOf = (source, mode = "copy") => request(app)
      .post("/space-transfers")
      .set(auth(owner))
      .send({
        sourceDbKey: source.dbKey,
        destinationDbKey: `space:${spaceId}`,
        sourceNoteId: source.noteId,
        destinationFolderId: null,
        mode,
      });
    const sourceRevisions = (source) => source.db
      .prepare("SELECT COUNT(*) AS count FROM note_revisions WHERE note_id = ?")
      .get(source.noteId).count;

    it("leaves the original and its revision history in place and puts a verified copy in the destination", async () => {
      const source = seedPersonalDocument();
      const before = source.db.prepare("SELECT * FROM notes WHERE id = ?").get(source.noteId);
      expect(sourceRevisions(source)).toBe(1);

      const response = await copyOf(source).expect(201);

      expect(response.body.transfer).toMatchObject({
        status: "kept_both",
        mode: "copy",
        sourceDeletedAt: null,
        revisionHistoryTransferred: false,
      });
      // The original: same row, same history, same image file.
      expect(source.db.prepare("SELECT * FROM notes WHERE id = ?").get(source.noteId)).toEqual(before);
      expect(sourceRevisions(source)).toBe(1);
      expect(source.db.prepare("SELECT 1 FROM images WHERE id = ?").get(source.imageId)).toBeTruthy();
      expect(fs.existsSync(path.join(resolveDatabaseUploadRoot(source.dbKey), `${source.imageId}.png`))).toBe(true);

      // The copy: its own Document, its own image, one revision, none of the
      // original's history.
      const destination = getDb(`space:${spaceId}`);
      const copied = destination.prepare("SELECT id, title, content FROM notes").all();
      expect(copied).toHaveLength(1);
      expect(copied[0].id).toBe(response.body.transfer.destinationNoteId);
      expect(copied[0].id).not.toBe(source.noteId);
      expect(copied[0].title).toBe("Transfer me");
      expect(copied[0].content).toContain(`?space=${spaceId}`);
      const copiedImage = destination.prepare("SELECT * FROM images").get();
      expect(copiedImage.id).not.toBe(source.imageId);
      expect(fs.readFileSync(resolveStoredImagePath(`space:${spaceId}`, copiedImage.path)))
        .toEqual(Buffer.from("verified-image-bytes"));
      expect(destination.prepare("SELECT note_id AS noteId, actor_kind AS kind FROM note_revisions").all())
        .toEqual([{ noteId: copied[0].id, kind: "system" }]);

      // Finished: nothing is left to recover.
      const listed = await request(app).get("/space-transfers").set(auth(owner)).expect(200);
      expect(listed.body.transfers).toEqual([]);
    });

    it("moves when the request says move, and reports it as a move", async () => {
      const source = seedPersonalDocument();
      const moved = await copyOf(source, "move").expect(201);
      expect(moved.body.transfer).toMatchObject({ status: "complete", mode: "move" });
      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeUndefined();
    });

    it("refuses a request that does not say which, or says something else, and starts nothing", async () => {
      const source = seedPersonalDocument();
      const body = {
        sourceDbKey: source.dbKey,
        destinationDbKey: `space:${spaceId}`,
        sourceNoteId: source.noteId,
        destinationFolderId: null,
      };
      const bodies = [body, ...["link", "", "MOVE", null, 1, true, ["copy"], { copy: true }]
        .map((mode) => ({ ...body, mode }))];
      for (const sent of bodies) {
        const refused = await request(app).post("/space-transfers").set(auth(owner)).send(sent).expect(400);
        expect(refused.body.code).toBe("TRANSFER_MODE_INVALID");
      }
      expect(getSpacesDb().prepare("SELECT COUNT(*) AS count FROM space_transfers WHERE actor_user_id = ?")
        .get(owner.userId).count).toBe(0);
      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();
      expect(getDb(`space:${spaceId}`).prepare("SELECT COUNT(*) AS count FROM notes").get().count).toBe(0);
    });

    it("never deletes the original from a recovery action", async () => {
      const source = seedPersonalDocument();
      const created = await copyOf(source).expect(201);
      const transferId = created.body.transfer.id;
      // As after a crash between the destination commit and the final status.
      const interrupt = () => getSpacesDb().prepare(
        "UPDATE space_transfers SET status = 'recoverable_duplicate' WHERE id = ?",
      ).run(transferId);

      interrupt();
      const refused = await request(app)
        .post(`/space-transfers/${transferId}/delete-source`)
        .set(auth(owner))
        .expect(409);
      expect(refused.body.code).toBe("TRANSFER_RECOVERY_INVALID");
      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();

      const retried = await request(app)
        .post(`/space-transfers/${transferId}/retry`)
        .set(auth(owner))
        .expect(200);
      expect(retried.body.transfer).toMatchObject({ status: "kept_both", mode: "copy" });

      interrupt();
      await request(app)
        .post(`/space-transfers/${transferId}/keep-both`)
        .set(auth(owner))
        .expect(200)
        .expect((response) => expect(response.body.transfer.status).toBe("kept_both"));

      expect(source.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(source.noteId)).toBeTruthy();
      expect(sourceRevisions(source)).toBe(1);
      // Retrying did not make a second copy.
      expect(getDb(`space:${spaceId}`).prepare("SELECT COUNT(*) AS count FROM notes").get().count).toBe(1);
    });

    it("copies out of a space as well, leaving the shared original for its members", async () => {
      const spaceDb = getDb(`space:${spaceId}`);
      const noteId = uuidv4();
      const at = new Date().toISOString();
      spaceDb.prepare(
        `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
         VALUES (?, ?, NULL, 'Shared plan', '# Shared plan\n', ?, ?)`,
      ).run(noteId, owner.userId, at, at);

      const response = await request(app)
        .post("/space-transfers")
        .set(auth(owner))
        .send({
          sourceDbKey: `space:${spaceId}`,
          destinationDbKey: `user:${owner.userId}`,
          sourceNoteId: noteId,
          destinationFolderId: null,
          mode: "copy",
        })
        .expect(201);

      expect(response.body.transfer).toMatchObject({ status: "kept_both", mode: "copy" });
      expect(spaceDb.prepare("SELECT 1 FROM notes WHERE id = ?").get(noteId)).toBeTruthy();
      expect(getDb(`user:${owner.userId}`).prepare("SELECT content FROM notes WHERE id = ?")
        .get(response.body.transfer.destinationNoteId).content).toBe("# Shared plan\n");
    });
  });

  it("does not disclose a source or destination space to a non-member", async () => {
    const source = seedPersonalDocument();
    for (const mode of ["move", "copy"]) {
      await request(app)
        .post("/space-transfers")
        .set(auth(outsider))
        .send({
          sourceDbKey: `user:${outsider.userId}`,
          destinationDbKey: `space:${spaceId}`,
          sourceNoteId: source.noteId,
          mode,
        })
        .expect(404, { error: "Not found", code: "TRANSFER_NOT_FOUND" });
    }
  });

  it("does not let a non-member copy a Document out of a space, or out of another account", async () => {
    // Copying reads without deleting, so it is the request someone who should
    // not read would send.
    const personal = seedPersonalDocument();
    const spaceDb = getDb(`space:${spaceId}`);
    const sharedNoteId = uuidv4();
    const at = new Date().toISOString();
    spaceDb.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
       VALUES (?, ?, NULL, 'Members only', 'members only', ?, ?)`,
    ).run(sharedNoteId, owner.userId, at, at);
    const outsiderSpaceId = createSpace({ actorUserId: outsider.userId, name: "Elsewhere" }).spaceId;

    try {
      for (const [sourceDbKey, sourceNoteId, destinationDbKey] of [
        [`space:${spaceId}`, sharedNoteId, `user:${outsider.userId}`],
        [`space:${spaceId}`, sharedNoteId, `space:${outsiderSpaceId}`],
        [`user:${owner.userId}`, personal.noteId, `space:${outsiderSpaceId}`],
      ]) {
        await request(app)
          .post("/space-transfers")
          .set(auth(outsider))
          .send({ sourceDbKey, destinationDbKey, sourceNoteId, destinationFolderId: null, mode: "copy" })
          .expect(404, { error: "Not found", code: "TRANSFER_NOT_FOUND" });
      }
      expect(getDb(`user:${outsider.userId}`).prepare("SELECT COUNT(*) AS n FROM notes").get().n).toBe(0);
      expect(getDb(`space:${outsiderSpaceId}`).prepare("SELECT COUNT(*) AS n FROM notes").get().n).toBe(0);
      expect(getSpacesDb().prepare("SELECT COUNT(*) AS n FROM space_transfers WHERE actor_user_id = ?")
        .get(outsider.userId).n).toBe(0);
    } finally {
      const spaces = getSpacesDb();
      spaces.prepare("DELETE FROM space_members WHERE space_id = ?").run(outsiderSpaceId);
      spaces.prepare("DELETE FROM spaces WHERE id = ?").run(outsiderSpaceId);
      deleteTestDb(`space:${outsiderSpaceId}`);
      deleteSpaceUploads(outsiderSpaceId);
    }
  });
});
