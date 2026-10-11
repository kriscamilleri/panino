import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import { addEditorMember, createSpace, removeEditorMember } from "../../spaces.js";
import { deleteTestDb, getDb, getSpacesDb } from "../../db.js";
import { COLLAB_LIMITS } from "../../collab.js";
import { revokeSpaceSubscribers } from "../../websocket.js";
import { cleanupTestUser, createTestApp, generateSiteId, getTestToken, setupTestUser } from "../testHelpers.js";

const PORT = 8015;
const originalShared = process.env.SHARED_SPACES_ENABLED;
const originalLive = process.env.LIVE_SESSIONS_ENABLED;

function waitFor(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => cleanup(reject, new Error("Timed out waiting for WebSocket message")), timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) cleanup(resolve, message);
    };
    const cleanup = (done, value) => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      done(value);
    };
    ws.on("message", onMessage);
  });
}

async function openSocket(userId, siteId) {
  const ws = new WebSocket(`ws://localhost:${PORT}?token=${getTestToken(userId)}&siteId=${siteId}`);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return ws;
}

async function request(ws, type, payload) {
  const requestId = uuidv4();
  const response = waitFor(ws, (message) => message.requestId === requestId);
  ws.send(JSON.stringify({ v: 1, type, requestId, payload }));
  return response;
}

async function close(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => { ws.once("close", resolve); ws.close(); });
}

function updateBase64(doc, mutate) {
  let update;
  const listener = (bytes, origin) => { if (origin === "local") update = bytes; };
  doc.on("update", listener);
  doc.transact(mutate, "local");
  doc.off("update", listener);
  return Buffer.from(update).toString("base64");
}

describe("COLLAB-05 live session protocol", () => {
  let server;
  let manager;
  let clients;
  let owner;
  let editor;
  let outsider;
  let spaceId;
  let noteId;
  let sockets = [];

  beforeAll(async () => {
    process.env.SHARED_SPACES_ENABLED = "true";
    process.env.LIVE_SESSIONS_ENABLED = "true";
    const app = createTestApp();
    server = app.server;
    manager = app.collabManager;
    clients = app.clients;
    await new Promise((resolve) => server.listen(PORT, resolve));
  });

  beforeEach(async () => {
    process.env.SHARED_SPACES_ENABLED = "true";
    process.env.LIVE_SESSIONS_ENABLED = "true";
    const stamp = `${Date.now()}-${Math.random()}`;
    owner = await setupTestUser(`collab-owner-${stamp}@example.test`, "password123");
    editor = await setupTestUser(`collab-editor-${stamp}@example.test`, "password123");
    outsider = await setupTestUser(`collab-outsider-${stamp}@example.test`, "password123");
    spaceId = createSpace({ actorUserId: owner.userId, name: "Live Writers" }).spaceId;
    addEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
    noteId = uuidv4();
    getDb(`space:${spaceId}`).prepare(`
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(noteId, owner.userId, "Draft", "base", new Date().toISOString(), new Date().toISOString());
  });

  afterEach(async () => {
    await Promise.all(sockets.map(close));
    sockets = [];
    await manager.shutdown({ deadlineMs: 2000 });
    for (const session of [...manager.sessions.values()]) {
      manager.closeSession(session, "shutdown", { deleteRecovery: true });
    }
    manager.accepting = true;
    if (spaceId) {
      getSpacesDb().prepare("DELETE FROM space_members WHERE space_id = ?").run(spaceId);
      getSpacesDb().prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
      deleteTestDb(`space:${spaceId}`);
    }
    for (const user of [owner, editor, outsider]) if (user) cleanupTestUser(user.userId);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (originalShared === undefined) delete process.env.SHARED_SPACES_ENABLED;
    else process.env.SHARED_SPACES_ENABLED = originalShared;
    if (originalLive === undefined) delete process.env.LIVE_SESSIONS_ENABLED;
    else process.env.LIVE_SESSIONS_ENABLED = originalLive;
  });

  async function subscribedSocket(user, char) {
    const siteId = generateSiteId(char);
    const ws = await openSocket(user.userId, siteId);
    sockets.push(ws);
    const subscribed = await request(ws, "subscribe", { databases: [{ dbKey: `space:${spaceId}`, siteId }] });
    expect(subscribed.ok).toBe(true);
    return ws;
  }

  it("converges after durable acknowledgement and saves one attributable revision", async () => {
    const a = await subscribedSocket(owner, "a");
    const b = await subscribedSocket(editor, "b");
    const stateA = await request(a, "collab:open", { space: spaceId, noteId });
    const stateB = await request(b, "collab:open", { space: spaceId, noteId });
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    Y.applyUpdate(docA, Buffer.from(stateA.payload.update, "base64"));
    Y.applyUpdate(docB, Buffer.from(stateB.payload.update, "base64"));

    const update = updateBase64(docA, () => docA.getText("content").insert(4, " together"));
    const broadcast = waitFor(b, (message) => message.type === "collab:update");
    const ack = await request(a, "collab:update", { sessionId: stateA.payload.sessionId, seq: 1, update });
    expect(ack.type).toBe("collab:ack");
    const durable = getDb(`space:${spaceId}`).prepare("SELECT durable_sequence, ydoc_state FROM collab_sessions WHERE note_id = ?").get(noteId);
    expect(durable.durable_sequence).toBe(1);
    const forwarded = await broadcast;
    Y.applyUpdate(docB, Buffer.from(forwarded.payload.update, "base64"));
    expect(docB.getText("content").toString()).toBe("base together");

    const committed = await request(a, "collab:commit", { sessionId: stateA.payload.sessionId });
    expect(committed.payload.result).toBe("applied");
    expect(getDb(`space:${spaceId}`).prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content).toBe("base together");
    const revisions = getDb(`space:${spaceId}`).prepare(
      "SELECT actor_user_id, actor_kind FROM note_revisions WHERE note_id = ?",
    ).all(noteId);
    expect(revisions).toEqual([{ actor_user_id: owner.userId, actor_kind: "collab" }]);
  });

  it("uses the same non-disclosing response for an outsider and an unknown document", async () => {
    const outsiderWs = await openSocket(outsider.userId, generateSiteId("c"));
    sockets.push(outsiderWs);
    const denied = await request(outsiderWs, "collab:open", { space: spaceId, noteId });
    const memberWs = await subscribedSocket(owner, "d");
    const missing = await request(memberWs, "collab:open", { space: spaceId, noteId: uuidv4() });
    expect([denied.error.code, denied.error.message]).toEqual(["SPACE_NOT_FOUND", "Document not found"]);
    expect([missing.error.code, missing.error.message]).toEqual(["SPACE_NOT_FOUND", "Document not found"]);
  });

  it("restores durable state, acknowledges a duplicate once, and rejects malformed updates without mutation", async () => {
    const ws = await subscribedSocket(owner, "f");
    const opened = await request(ws, "collab:open", { space: spaceId, noteId });
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, Buffer.from(opened.payload.update, "base64"));
    const update = updateBase64(clientDoc, () => clientDoc.getText("content").insert(4, " durable"));
    await request(ws, "collab:update", { sessionId: opened.payload.sessionId, seq: 1, update });
    const session = manager.sessionsById.get(opened.payload.sessionId);
    manager.closeSession(session, "shutdown");

    const restored = await request(ws, "collab:open", { space: spaceId, noteId });
    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, Buffer.from(restored.payload.update, "base64"));
    expect(restoredDoc.getText("content").toString()).toBe("base durable");
    const duplicate = await request(ws, "collab:update", { sessionId: restored.payload.sessionId, seq: 1, update });
    expect(duplicate.type).toBe("collab:ack");
    expect(getDb(`space:${spaceId}`).prepare(
      "SELECT durable_sequence FROM collab_sessions WHERE note_id = ?",
    ).get(noteId).durable_sequence).toBe(1);
    const malformed = await request(ws, "collab:update", {
      sessionId: restored.payload.sessionId, seq: 2, update: "not-base64",
    });
    expect(malformed.error.code).toBe("INVALID_UPDATE");
    expect(manager.sessionsById.get(restored.payload.sessionId).ydoc.getText("content").toString()).toBe("base durable");
  });

  it("three-way merges a non-overlapping outside edit and preserves a conflicting outside body", async () => {
    const db = getDb(`space:${spaceId}`);
    db.prepare("UPDATE notes SET content = ? WHERE id = ?").run("one\ntwo\nthree", noteId);
    const ws = await subscribedSocket(owner, "1");
    const opened = await request(ws, "collab:open", { space: spaceId, noteId });
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, Buffer.from(opened.payload.update, "base64"));
    const update = updateBase64(clientDoc, () => {
      const text = clientDoc.getText("content");
      text.delete(0, 3);
      text.insert(0, "ONE");
    });
    await request(ws, "collab:update", { sessionId: opened.payload.sessionId, seq: 1, update });
    db.prepare("UPDATE notes SET content = ? WHERE id = ?").run("one\ntwo\nTHREE", noteId);
    const merged = await request(ws, "collab:commit", { sessionId: opened.payload.sessionId });
    expect(merged.payload.result).toBe("merged");
    expect(db.prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content).toBe("ONE\ntwo\nTHREE");

    // Start a fresh base, then change the same line both inside and outside.
    manager.closeSession(manager.sessionsById.get(opened.payload.sessionId), "committed", { deleteRecovery: true });
    db.prepare("UPDATE notes SET content = ? WHERE id = ?").run("base", noteId);
    const reopened = await request(ws, "collab:open", { space: spaceId, noteId });
    const conflictDoc = new Y.Doc();
    Y.applyUpdate(conflictDoc, Buffer.from(reopened.payload.update, "base64"));
    const conflictingUpdate = updateBase64(conflictDoc, () => {
      conflictDoc.getText("content").delete(0, 4);
      conflictDoc.getText("content").insert(0, "inside");
    });
    await request(ws, "collab:update", { sessionId: reopened.payload.sessionId, seq: 1, update: conflictingUpdate });
    db.prepare("UPDATE notes SET content = ? WHERE id = ?").run("outside", noteId);
    const conflict = await request(ws, "collab:commit", { sessionId: reopened.payload.sessionId });
    expect(conflict.payload.result).toBe("conflict");
    expect(conflict.payload.conflicts.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content).toBe("outside");
    expect(db.prepare("SELECT 1 FROM collab_sessions WHERE note_id = ?").get(noteId)).toBeDefined();

    // Once every participant has left, an unresolved checkpoint stays durable
    // without occupying one of the bounded in-memory session slots forever.
    const conflictedSession = manager.sessionsById.get(reopened.payload.sessionId);
    const serverSocket = [...conflictedSession.participants.keys()][0];
    manager.leave(serverSocket, clients.get(serverSocket), reopened.payload.sessionId, "left");
    expect(conflictedSession.participants.size).toBe(0);
    await manager.autoCommitAndClose(conflictedSession, "committed");
    expect(manager.sessionsById.has(reopened.payload.sessionId)).toBe(false);
    expect(db.prepare("SELECT 1 FROM collab_sessions WHERE note_id = ?").get(noteId)).toBeDefined();
  });

  it("rejects new admission when the live-session flag is disabled", async () => {
    const ws = await subscribedSocket(owner, "e");
    process.env.LIVE_SESSIONS_ENABLED = "false";
    const response = await request(ws, "collab:open", { space: spaceId, noteId });
    expect(response.error.code).toBe("FEATURE_DISABLED");
  });

  /** A participant as a client keeps it: its own document copy and sequence counter. */
  async function join(user, char, { clientId } = {}) {
    const ws = await subscribedSocket(user, char);
    const opened = await request(ws, "collab:open", { space: spaceId, noteId, ...(clientId ? { clientId } : {}) });
    expect(opened.ok, JSON.stringify(opened.error)).toBe(true);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(opened.payload.update, "base64"), "remote");
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      // Other participants' updates and the server's own; this client's
      // updates are answered with collab:ack, never echoed.
      if (message.type === "collab:update" && message.ok !== false && message.payload?.update) {
        Y.applyUpdate(doc, Buffer.from(message.payload.update, "base64"), "remote");
      }
    });
    const participant = {
      ws, doc, sessionId: opened.payload.sessionId, opened, seq: Number(opened.payload.ack) || 0,
      text: () => doc.getText("content").toString(),
      edit: async (mutate) => {
        const update = updateBase64(doc, () => mutate(doc.getText("content")));
        participant.seq += 1;
        return request(ws, "collab:update", { sessionId: participant.sessionId, seq: participant.seq, update });
      },
      request: (type, payload = {}) => request(ws, type, { sessionId: participant.sessionId, ...payload }),
    };
    return participant;
  }
  const serverText = (sessionId) => manager.sessionsById.get(sessionId).ydoc.getText("content").toString();
  const storedBody = () => getDb(`space:${spaceId}`).prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content;
  const setStoredBody = (content) => getDb(`space:${spaceId}`).prepare("UPDATE notes SET content = ? WHERE id = ?").run(content, noteId);

  it("keeps two tabs of one browser apart, although they share a site id", async () => {
    // Sequence numbers were tracked per site id, which every tab of a browser
    // profile shares. The second tab's update was acknowledged as a duplicate
    // of the first's and never applied.
    const siteId = generateSiteId("7");
    const open = async (clientId) => {
      const ws = await openSocket(owner.userId, siteId);
      sockets.push(ws);
      await request(ws, "subscribe", { databases: [{ dbKey: `space:${spaceId}`, siteId }] });
      const opened = await request(ws, "collab:open", { space: spaceId, noteId, clientId });
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Buffer.from(opened.payload.update, "base64"));
      return { ws, doc, sessionId: opened.payload.sessionId, ack: opened.payload.ack };
    };
    const first = await open(uuidv4());
    const second = await open(uuidv4());
    expect([first.ack, second.ack]).toEqual([0, 0]);

    await request(first.ws, "collab:update", {
      sessionId: first.sessionId, seq: 1, update: updateBase64(first.doc, () => first.doc.getText("content").insert(0, "[tab one] ")),
    });
    const fromSecond = await request(second.ws, "collab:update", {
      sessionId: second.sessionId, seq: 1, update: updateBase64(second.doc, () => second.doc.getText("content").insert(4, " [tab two]")),
    });

    expect(fromSecond.type).toBe("collab:ack");
    expect(serverText(first.sessionId)).toBe("[tab one] base [tab two]");
  });

  it("does not let a client use another user's sequence counter by naming their client id", async () => {
    const clientId = uuidv4();
    const a = await join(owner, "8", { clientId });
    await a.edit((text) => text.insert(0, "owner "));
    const b = await join(editor, "9", { clientId });

    expect(b.opened.payload.ack).toBe(0);
    expect((await b.edit((text) => text.insert(text.length, " editor"))).type).toBe("collab:ack");
    expect(serverText(a.sessionId)).toBe("owner base editor");
  });

  it("makes an update durable by appending it, and rewrites the document only at a checkpoint", async () => {
    const db = getDb(`space:${spaceId}`);
    const a = await join(owner, "a");
    const checkpoint = () => db.prepare("SELECT ydoc_state AS state FROM collab_sessions WHERE note_id = ?").get(noteId).state;
    const logged = () => db.prepare("SELECT COUNT(*) AS n FROM collab_session_updates WHERE session_id = ?").get(a.sessionId).n;
    const atOpen = Buffer.from(checkpoint());

    for (let i = 0; i < 10; i += 1) await a.edit((text) => text.insert(text.length, `${i}`));

    expect(logged()).toBe(10);
    expect(Buffer.from(checkpoint()).equals(atOpen)).toBe(true);
    expect(db.prepare("SELECT durable_sequence AS n FROM collab_sessions WHERE note_id = ?").get(noteId).n).toBe(10);

    // A crash here loses nothing: the session comes back from checkpoint plus log.
    manager.closeSession(manager.sessionsById.get(a.sessionId), "shutdown");
    const reopened = await join(owner, "b");
    expect(reopened.text()).toBe("base0123456789");

    // Enough further updates fold the log into a new checkpoint.
    for (let i = 0; i < 70; i += 1) {
      expect((await reopened.edit((text) => text.insert(text.length, "."))).type).toBe("collab:ack");
      await new Promise((resolve) => setTimeout(resolve, 30)); // stay under the per-second update limit
    }
    expect(logged()).toBeLessThan(64);
    expect(Buffer.from(checkpoint()).equals(atOpen)).toBe(false);
    manager.closeSession(manager.sessionsById.get(reopened.sessionId), "shutdown");
    expect((await join(owner, "c")).text()).toBe(`base0123456789${".".repeat(70)}`);
  });

  it("accepts the one large update a client sends after typing through a disconnection", async () => {
    const a = await join(owner, "d");
    const pasted = "x".repeat(300 * 1024);

    const ack = await a.edit((text) => text.insert(text.length, pasted));

    expect(ack.type).toBe("collab:ack");
    expect(serverText(a.sessionId).length).toBe(4 + pasted.length);
    expect(COLLAB_LIMITS.maxUpdateBytes * 4 / 3).toBeLessThan(COLLAB_LIMITS.maxMessageBytes - 1024);
  });

  it("seeds the shared text with LF line endings whatever the stored body uses", async () => {
    setStoredBody("one\r\ntwo\r\nthree");
    const a = await join(owner, "e");
    expect(a.text()).toBe("one\ntwo\nthree");
  });

  it("refuses a new session once the process holds its maximum", async () => {
    const real = manager.sessions.size;
    const filler = [];
    for (let i = real; i < COLLAB_LIMITS.sessionsPerProcess; i += 1) {
      const key = `filler:${i}`;
      manager.sessions.set(key, { key, spaceId: "other", dbKey: "space:other", participants: new Map(), reconnecting: new Map() });
      filler.push(key);
    }
    try {
      const ws = await subscribedSocket(owner, "f");
      const refused = await request(ws, "collab:open", { space: spaceId, noteId });
      expect(refused.error).toMatchObject({ code: "SESSION_LIMIT", retryable: true });
    } finally {
      for (const key of filler) manager.sessions.delete(key);
    }
  });

  it("keeps the session usable after a save that merged an edit made outside it", async () => {
    // The server replaced its document with a new one built from the merged
    // text. Clients kept the old one, so what they typed afterwards was
    // accepted, acknowledged, never applied, and missing from the next save.
    setStoredBody("one\ntwo\nthree");
    const a = await join(owner, "1");
    const b = await join(editor, "2");
    await a.edit((text) => { text.delete(0, 3); text.insert(0, "ONE"); });
    setStoredBody("one\ntwo\nTHREE");

    const merged = await a.request("collab:commit");
    expect(merged.payload.result).toBe("merged");
    expect(merged.payload).not.toHaveProperty("mergeUpdate");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The outside edit reaches every participant's copy.
    expect(a.text()).toBe("ONE\ntwo\nTHREE");
    expect(b.text()).toBe("ONE\ntwo\nTHREE");

    await b.edit((text) => text.insert(text.length, "\nfour, typed after the save"));
    expect(serverText(a.sessionId)).toBe("ONE\ntwo\nTHREE\nfour, typed after the save");
    expect((await a.request("collab:commit")).payload.result).toBe("applied");
    expect(storedBody()).toBe("ONE\ntwo\nTHREE\nfour, typed after the save");
  });

  describe("a save that conflicts with an edit made outside the session", () => {
    async function conflicted() {
      setStoredBody("title\n\nalpha\n\nbeta\n");
      const a = await join(owner, "1");
      const b = await join(editor, "2");
      await a.edit((text) => { text.delete(7, 5); text.insert(7, "alpha in session"); });
      setStoredBody("title\n\nalpha outside\n\nbeta\n");
      const shownToB = waitFor(b.ws, (message) => message.type === "collab:committed");
      const conflict = await a.request("collab:commit");
      expect(conflict.payload).toMatchObject({ result: "conflict", mineContent: "title\n\nalpha in session\n\nbeta\n" });
      expect((await shownToB).payload.conflictId).toBe(conflict.payload.conflictId);
      return { a, b, conflictId: conflict.payload.conflictId };
    }

    it("can be answered in the session's favour and then saved", async () => {
      // The base never moved, so a save that kept the session's side met the
      // identical conflict again, every time.
      const { a, b, conflictId } = await conflicted();
      const told = waitFor(b.ws, (message) => message.type === "collab:conflict-resolved");

      const resolved = await a.request("collab:resolve", { conflictId, content: "title\n\nalpha in session\n\nbeta\n" });

      expect(resolved.type).toBe("collab:conflict-resolved");
      expect((await told).payload.by.id).toBe(owner.userId);
      const saved = await a.request("collab:commit");
      expect(saved.payload.result).toBe("applied");
      expect(storedBody()).toBe("title\n\nalpha in session\n\nbeta\n");
    });

    it("is answered once: a second answer changes nothing", async () => {
      // Each client used to replace the whole text itself; two answers arriving
      // together left the Document doubled.
      const { a, b, conflictId } = await conflicted();
      await a.request("collab:resolve", { conflictId, content: "title\n\nalpha outside\n\nbeta\n" });
      const second = await b.request("collab:resolve", { conflictId, content: "title\n\nalpha in session\n\nbeta\n" });

      expect(second.error).toMatchObject({ code: "CONFLICT_RESOLVED", retryable: true });
      expect(serverText(a.sessionId)).toBe("title\n\nalpha outside\n\nbeta\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(b.text()).toBe("title\n\nalpha outside\n\nbeta\n");
      expect(a.text()).toBe("title\n\nalpha outside\n\nbeta\n");
    });

    it("keeps what another participant typed while the answer was being decided", async () => {
      // Replacing the whole text deleted it.
      const { a, b, conflictId } = await conflicted();
      await b.edit((text) => text.insert(text.length, "typed by the editor meanwhile\n"));

      await a.request("collab:resolve", { conflictId, content: "title\n\nalpha outside\n\nbeta\n" });

      const expected = "title\n\nalpha outside\n\nbeta\ntyped by the editor meanwhile\n";
      expect(serverText(a.sessionId)).toBe(expected);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(b.text()).toBe(expected);
      expect((await a.request("collab:commit")).payload.result).toBe("applied");
      expect(storedBody()).toBe(expected);
    });

    it("asks again when the text being decided was itself changed meanwhile", async () => {
      const { a, b, conflictId } = await conflicted();
      await b.edit((text) => { const at = text.toString().indexOf("alpha in session"); text.delete(at, 16); text.insert(at, "alpha changed again"); });
      const fresh = waitFor(a.ws, (message) => message.type === "collab:committed" && message.payload.conflictId !== conflictId);

      const stale = await a.request("collab:resolve", { conflictId, content: "title\n\nalpha outside\n\nbeta\n" });

      expect(stale.error).toMatchObject({ code: "CONFLICT_STALE", retryable: true });
      expect((await fresh).payload).toMatchObject({ result: "conflict", mineContent: "title\n\nalpha changed again\n\nbeta\n" });
      expect(serverText(a.sessionId)).toBe("title\n\nalpha changed again\n\nbeta\n");
    });

    it("is shown to a member who joins while it stands", async () => {
      const { conflictId } = await conflicted();
      const late = await join(owner, "3");
      expect(late.opened.payload.conflict).toMatchObject({ conflictId, result: "conflict" });
    });
  });

  it("tells every participant when a save fails, so nobody is left waiting", async () => {
    const a = await join(owner, "4");
    const b = await join(editor, "5");
    await a.edit((text) => text.insert(0, "x"));
    const told = waitFor(b.ws, (message) => message.type === "collab:commit-failed");
    getDb(`space:${spaceId}`).prepare("DELETE FROM notes WHERE id = ?").run(noteId);

    const failed = await a.request("collab:commit");

    expect(failed.ok).toBe(false);
    expect((await told).payload.sessionId).toBe(b.sessionId);
    expect(manager.sessionsById.get(a.sessionId)?.commitState ?? "live").toBe("live");
  });

  it("removes a member from a session even after their socket unsubscribed from the space", async () => {
    // Revocation walked subscribed sockets only.
    const a = await join(owner, "6");
    const b = await join(editor, "7");
    await request(b.ws, "unsubscribe", { dbKeys: [`space:${spaceId}`] });
    const closed = waitFor(b.ws, (message) => message.type === "collab:closed");

    removeEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
    revokeSpaceSubscribers(clients, `space:${spaceId}`, [editor.userId]);

    expect((await closed).payload.reason).toBe("revoked");
    expect(manager.sessionsById.get(a.sessionId).participants.size).toBe(1);
  });

  it("removes a revoked participant immediately and retains other editors", async () => {
    const ownerWs = await subscribedSocket(owner, "2");
    const editorWs = await subscribedSocket(editor, "3");
    const ownerState = await request(ownerWs, "collab:open", { space: spaceId, noteId });
    await request(editorWs, "collab:open", { space: spaceId, noteId });
    const closed = waitFor(editorWs, (message) => message.type === "collab:closed");
    removeEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
    revokeSpaceSubscribers(clients, `space:${spaceId}`, [editor.userId]);
    expect((await closed).payload.reason).toBe("revoked");
    expect(manager.sessionsById.get(ownerState.payload.sessionId).participants.size).toBe(1);
  });

  it("auto-saves a wholly durable session during graceful shutdown", async () => {
    const ws = await subscribedSocket(owner, "4");
    const opened = await request(ws, "collab:open", { space: spaceId, noteId });
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, Buffer.from(opened.payload.update, "base64"));
    const update = updateBase64(clientDoc, () => clientDoc.getText("content").insert(4, " before shutdown"));
    await request(ws, "collab:update", { sessionId: opened.payload.sessionId, seq: 1, update });
    const result = await manager.shutdown({ deadlineMs: 2000 });
    expect(result).toEqual({ flushed: 1, unflushed: 0 });
    const db = getDb(`space:${spaceId}`);
    expect(db.prepare("SELECT content FROM notes WHERE id = ?").get(noteId).content).toBe("base before shutdown");
    expect(db.prepare("SELECT 1 FROM collab_sessions WHERE note_id = ?").get(noteId)).toBeUndefined();
  });
});
