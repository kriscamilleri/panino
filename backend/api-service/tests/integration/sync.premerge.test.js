import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  createTestApp,
  getTestToken,
  setupTestUser,
  cleanupTestUser,
} from "../testHelpers.js";
import { getTestDb, getUserDb } from "../../db.js";

const NOTE_ID = "44444444-4444-4444-8444-444444444444";
const CHANGE_COLUMNS = `"table", pk, cid, val, col_version, db_version, hex(site_id) AS site_id, cl, seq`;

/** A browser serializes the packed key (a Uint8Array) as an index-keyed object. */
const asBrowserBytes = (buffer) => ({ ...Array.from(buffer) });

/**
 * A second, real CR-SQLite replica standing in for a browser. Its rows in
 * `crsql_changes` are exactly what a client uploads.
 */
function clientReplica(name) {
  const db = getTestDb(name, { inMemory: true });
  const siteId = db.prepare("SELECT hex(crsql_site_id()) AS id").get().id.toLowerCase();
  return {
    db,
    siteId,
    createNote(body) {
      db.prepare(
        "INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, 'Title', ?, 'now', 'now')",
      ).run(NOTE_ID, body);
    },
    editBody(body) {
      db.prepare("UPDATE notes SET content = ? WHERE id = ?").run(body, NOTE_ID);
    },
    ownChanges() {
      return db
        .prepare(`SELECT ${CHANGE_COLUMNS} FROM crsql_changes WHERE site_id = crsql_site_id() ORDER BY db_version, seq`)
        .all()
        .map((change) => ({ ...change, pk: asBrowserBytes(change.pk) }));
    },
  };
}

const bodyChange = (changes) => changes.find((change) => change.table === "notes" && change.cid === "content");

describe("POST /sync replies with other replicas' changes as they stood before the upload", () => {
  let app;
  let server;
  let user;
  let token;

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(async () => {
    user = await setupTestUser(`premerge-${Date.now()}@example.com`, "password123");
    token = getTestToken(user.userId);
  });

  afterEach(() => {
    cleanupTestUser(user.userId);
    delete process.env.CONTENT_MERGE_WRITEBACK_ENABLED;
  });

  const sync = (payload) => request(app)
    .post("/sync")
    .set("Authorization", `Bearer ${token}`)
    .send(payload);

  /** Another replica's body, already merged on the server before the client under test syncs. */
  function serverHoldsBody(body) {
    const db = getUserDb(user.userId);
    db.prepare(
      "INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, 'Title', ?, 'now', 'now')",
    ).run(NOTE_ID, user.userId, body);
    return db;
  }

  it("returns the body an upload overwrites, so the uploader can keep it", async () => {
    const serverDb = serverHoldsBody("written on another device");
    const client = clientReplica("premerge-winner");
    client.createNote("draft");
    client.editBody("draft, edited");
    client.editBody("written on this device");
    expect(bodyChange(client.ownChanges()).col_version).toBeGreaterThan(1);

    const response = await sync({ since: 0, siteId: client.siteId, changes: client.ownChanges() });

    expect(response.status).toBe(200);
    // The upload wins on the server …
    expect(serverDb.prepare("SELECT content FROM notes WHERE id = ?").get(NOTE_ID).content)
      .toBe("written on this device");
    // … and the reply still carries the body it replaced.
    expect(bodyChange(response.body.changes)).toMatchObject({ val: "written on another device" });
    expect(bodyChange(response.body.changes).site_id.toLowerCase()).not.toBe(client.siteId);
  });

  it("does not repeat the displaced body on the next sync", async () => {
    serverHoldsBody("written on another device");
    const client = clientReplica("premerge-next");
    client.createNote("draft");
    client.editBody("written on this device");

    const first = await sync({ since: 0, siteId: client.siteId, changes: client.ownChanges() });
    const second = await sync({ since: first.body.clock, siteId: client.siteId, changes: [] });

    expect(second.status).toBe(200);
    expect(second.body.changes).toEqual([]);
    expect(second.body.clock).toBe(first.body.clock);
  });

  it("still returns the winning body when the upload loses", async () => {
    const serverDb = serverHoldsBody("first");
    serverDb.prepare("UPDATE notes SET content = ? WHERE id = ?").run("second", NOTE_ID);
    serverDb.prepare("UPDATE notes SET content = ? WHERE id = ?").run("written on another device", NOTE_ID);
    const client = clientReplica("premerge-loser");
    client.createNote("written on this device");

    const response = await sync({ since: 0, siteId: client.siteId, changes: client.ownChanges() });

    expect(response.status).toBe(200);
    expect(serverDb.prepare("SELECT content FROM notes WHERE id = ?").get(NOTE_ID).content)
      .toBe("written on another device");
    expect(bodyChange(response.body.changes)).toMatchObject({ val: "written on another device" });
  });

  it("never echoes the uploader's own changes", async () => {
    const client = clientReplica("premerge-echo");
    client.createNote("only this device");

    const response = await sync({ since: 0, siteId: client.siteId, changes: client.ownChanges() });

    expect(response.status).toBe(200);
    expect(response.body.changes).toEqual([]);
  });

  it("refuses a malformed primary key instead of handing it to the extension", async () => {
    const serverDb = serverHoldsBody("untouched");
    const client = clientReplica("premerge-malformed");
    client.createNote("must not be merged");
    const changes = client.ownChanges();
    // hex(pk) is not a form the server decodes; before validation these bytes
    // reached CR-SQLite's native unpacking and aborted the whole process.
    const malformed = changes.map((change, index) => (index === changes.length - 1
      ? { ...change, pk: Buffer.from(Object.values(change.pk)).toString("hex").toUpperCase() }
      : change));

    const response = await sync({ since: 0, siteId: client.siteId, changes: malformed });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INVALID_CHANGE" });
    // Nothing from the batch was merged, including the well-formed rows before it.
    expect(serverDb.prepare("SELECT content FROM notes WHERE id = ?").get(NOTE_ID).content).toBe("untouched");

    // The server is still serving.
    const next = await sync({ since: 0, siteId: client.siteId, changes: [] });
    expect(next.status).toBe(200);
  });

  it("advertises automatic merge write-back only when the server enables it", async () => {
    const siteId = "ab".repeat(16);

    const off = await sync({ since: 0, siteId, changes: [] });
    expect(off.body.contentMergeWriteback).toBe(false);

    process.env.CONTENT_MERGE_WRITEBACK_ENABLED = "true";
    const on = await sync({ since: 0, siteId, changes: [] });
    expect(on.body.contentMergeWriteback).toBe(true);

    process.env.CONTENT_MERGE_WRITEBACK_ENABLED = "TRUE";
    const strict = await sync({ since: 0, siteId, changes: [] });
    expect(strict.body.contentMergeWriteback).toBe(false);
  });
});
