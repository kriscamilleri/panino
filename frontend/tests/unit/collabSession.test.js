// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import * as Y from "yjs";

const harness = vi.hoisted(() => ({
  listeners: new Set(),
  sent: [],
  guard: null,
  online: true,
  connected: true,
  refreshData: vi.fn(async () => {}),
  sync: vi.fn(async () => {}),
  toast: vi.fn(),
}));

vi.mock("@/store/syncStore", () => ({
  useSyncStore: () => ({
    get isOnline() { return harness.online; },
    addWebSocketListener(listener) { harness.listeners.add(listener); return () => harness.listeners.delete(listener); },
    setCollabRemoteGuard(guard) { harness.guard = guard; },
    sendWebSocketMessage(type, payload) {
      if (!harness.connected) return null;
      const requestId = crypto.randomUUID();
      harness.sent.push({ type, payload, requestId });
      return requestId;
    },
    sync: harness.sync,
  }),
}));
vi.mock("@/store/docStore", () => ({ useDocStore: () => ({ refreshData: harness.refreshData }) }));
vi.mock("@/store/uiStore", () => ({ useUiStore: () => ({ addToast: harness.toast }) }));

const { useCollabSessionStore } = await import("@/store/collabSessionStore");
const SPACE = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";

function encodedState(value) {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, value);
  let binary = "";
  for (const byte of Y.encodeStateAsUpdate(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

beforeEach(() => {
  setActivePinia(createPinia());
  harness.listeners.clear();
  harness.sent = [];
  harness.guard = null;
  harness.online = true;
  harness.connected = true;
  vi.clearAllMocks();
});

const lastOpen = () => harness.sent.filter((message) => message.type === "collab:open").at(-1);
/** The server's answer to the most recent request to join. */
function serverState(store, payload) {
  store.handleMessage({ type: "collab:state", ok: true, requestId: lastOpen().requestId, payload });
}
function joined(text = "base", extra = {}) {
  const store = useCollabSessionStore();
  store.open(SPACE, NOTE);
  serverState(store, { sessionId: "session-a", update: encodedState(text), participants: [], ack: 0, ...extra });
  return store;
}
const sentUpdates = () => harness.sent.filter((message) => message.type === "collab:update");
const type = (store, text) => store.ydoc.transact(() => {
  const shared = store.ydoc.getText("content");
  shared.insert(shared.length, text);
}, store.localOrigin);
const toBytes = (encoded) => Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
/** A second replica of the store's document that receives what the store sends, as the server would. */
function serverCopy(store) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(store.ydoc));
  return {
    doc,
    apply: (message) => Y.applyUpdate(doc, toBytes(message.payload.update)),
    text: () => doc.getText("content").toString(),
    state: () => toBase64(Y.encodeStateAsUpdate(doc)),
  };
}

describe("live session state machine", () => {
  it("joins explicitly, batches local updates, and discards only acknowledged operations", async () => {
    vi.useFakeTimers();
    const store = useCollabSessionStore();
    expect(store.open(SPACE, NOTE)).toBe(true);
    expect(store.status).toBe("opening");
    serverState(store, {
      sessionId: "session-a", update: encodedState("base"), participants: [{ id: "a", name: "Alice" }], ack: 0,
    });
    expect(store.status).toBe("live");
    store.ydoc.transact(() => store.ydoc.getText("content").insert(4, " edit"), store.localOrigin);
    expect(store.unackedCount).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    const update = harness.sent.find((message) => message.type === "collab:update");
    expect(update.payload.seq).toBe(1);
    store.handleMessage({ type: "collab:ack", ok: true, payload: { sessionId: "session-a", seq: 1 } });
    expect(store.unackedCount).toBe(0);
    vi.useRealTimers();
  });

  it("reopens after a socket drop and becomes visibly read-only after the hard timeout", async () => {
    vi.useFakeTimers();
    const store = useCollabSessionStore();
    store.open(SPACE, NOTE);
    serverState(store, {
      sessionId: "session-a", update: encodedState("base"), participants: [], ack: 0,
    });
    store.handleMessage({ type: "socket:close" });
    expect(store.status).toBe("reconnecting");
    store.handleMessage({ type: "socket:open" });
    expect(harness.sent.at(-1)).toMatchObject({ type: "collab:open", payload: { space: SPACE, noteId: NOTE } });
    store.handleMessage({ type: "socket:close" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.status).toBe("dropped");
    expect(store.isEditable).toBe(false);
    vi.useRealTimers();
  });

  it("owns in-session sync handoff without replacing Y.Text or opening a normal conflict", () => {
    const store = useCollabSessionStore();
    store.open(SPACE, NOTE);
    serverState(store, {
      sessionId: "session-a", update: encodedState("live text"), participants: [], ack: 0,
    });
    expect(harness.guard(`space:${SPACE}`, NOTE, "server text")).toBe(true);
    expect(store.ydoc.getText("content").toString()).toBe("live text");
    expect(harness.guard(`space:${SPACE}`, "different", "server text")).toBe(false);
  });

  it("continues participant sequences after a durable page-reload acknowledgement", async () => {
    vi.useFakeTimers();
    const store = useCollabSessionStore();
    store.open(SPACE, NOTE);
    serverState(store, {
      sessionId: "session-a", update: encodedState("base"), participants: [], ack: 7,
    });
    store.ydoc.transact(() => store.ydoc.getText("content").insert(4, " next"), store.localOrigin);
    await vi.advanceTimersByTimeAsync(50);
    expect(harness.sent.find((message) => message.type === "collab:update")?.payload.seq).toBe(8);
    vi.useRealTimers();
  });

  it("names this tab when joining, and keeps the same name when rejoining", () => {
    // The server counts updates per participant. A browser has one site id for
    // all its tabs, so two tabs in one session shared a counter.
    const store = joined();
    const first = lastOpen().payload.clientId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    store.handleMessage({ type: "socket:close" });
    store.handleMessage({ type: "socket:open" });
    expect(lastOpen().payload.clientId).toBe(first);

    setActivePinia(createPinia());
    const otherTab = useCollabSessionStore();
    otherTab.open(SPACE, NOTE);
    expect(lastOpen().payload.clientId).not.toBe(first);
  });

  it("sends undo and redo to the session like any other edit", async () => {
    // They run with the undo manager as origin. Filtered on the typing origin,
    // they were applied here only: the text came back for this user and stayed
    // deleted for everyone else and in the saved version.
    vi.useFakeTimers();
    const store = joined("keep this paragraph");
    const server = serverCopy(store);
    const shared = store.ydoc.getText("content");
    const undo = new Y.UndoManager(shared, { trackedOrigins: new Set([store.localOrigin]) });

    store.ydoc.transact(() => shared.delete(0, shared.length), store.localOrigin);
    await vi.advanceTimersByTimeAsync(50);
    undo.undo();
    await vi.advanceTimersByTimeAsync(50);

    expect(shared.toString()).toBe("keep this paragraph");
    expect(sentUpdates()).toHaveLength(2);
    sentUpdates().forEach(server.apply);
    expect(server.text()).toBe("keep this paragraph");

    undo.redo();
    await vi.advanceTimersByTimeAsync(50);
    server.apply(sentUpdates().at(-1));
    expect(server.text()).toBe("");
    vi.useRealTimers();
  });

  it("does not send back what arrived from the server", async () => {
    vi.useFakeTimers();
    const store = joined();
    const other = serverCopy(store);
    let remote;
    other.doc.on("update", (update) => { remote = update; });
    other.doc.getText("content").insert(0, "from someone else ");

    store.handleMessage({ type: "collab:update", ok: true, payload: { sessionId: "session-a", update: toBase64(remote) } });
    await vi.advanceTimersByTimeAsync(50);

    expect(store.ydoc.getText("content").toString()).toBe("from someone else base");
    expect(sentUpdates()).toHaveLength(0);
    vi.useRealTimers();
  });

  describe("joining", () => {
    it("ignores an answer that is not for the request it is waiting on", () => {
      const store = useCollabSessionStore();
      store.open(SPACE, NOTE);

      store.handleMessage({ type: "collab:state", ok: true, requestId: crypto.randomUUID(), payload: {
        sessionId: "someone-elses", update: encodedState("other"), participants: [], ack: 0,
      } });

      expect(store.status).toBe("opening");
      expect(store.ydoc).toBeNull();
    });

    it("leaves a session whose answer arrives after the user gave up waiting", () => {
      // "Collaborate" on one Document, then another Document selected before
      // the answer: the session used to bind itself to the second Document.
      const store = useCollabSessionStore();
      store.open(SPACE, NOTE);
      const abandoned = lastOpen().requestId;
      store.leave();
      expect(store.status).toBe("idle");

      store.handleMessage({ type: "collab:state", ok: true, requestId: abandoned, payload: {
        sessionId: "session-late", update: encodedState("late"), participants: [], ack: 0,
      } });

      expect(store.status).toBe("idle");
      expect(store.ydoc).toBeNull();
      expect(harness.sent.at(-1)).toMatchObject({ type: "collab:leave", payload: { sessionId: "session-late" } });
    });

    it("shows a conflict that was already standing when it joined", () => {
      const store = joined("base", { conflict: {
        conflictId: "conflict-1", baseContent: "b", mineContent: "m", theirsContent: "t", conflicts: [{}], at: "now",
      } });
      expect(store.conflict).toMatchObject({ id: "conflict-1", mineContent: "m", theirsContent: "t" });
    });
  });

  describe("after a disconnection", () => {
    it("sends everything typed meanwhile as one update, starting where the server stopped", async () => {
      // Replayed one message per update, a minute of typing exceeded the
      // server's rate limit on arrival and the session was dropped.
      vi.useFakeTimers();
      const store = joined();
      const server = serverCopy(store);
      type(store, " one"); await vi.advanceTimersByTimeAsync(50);
      server.apply(sentUpdates()[0]);                         // the server has seq 1 ...
      store.handleMessage({ type: "socket:close" });          // ... but its ack never arrives
      harness.connected = false;
      for (let i = 0; i < 60; i += 1) { type(store, ` w${i}`); await vi.advanceTimersByTimeAsync(50); }
      harness.connected = true;
      harness.sent.length = 0;

      store.handleMessage({ type: "socket:open" });
      serverState(store, { sessionId: "session-a", update: server.state(), participants: [], ack: 1 });

      expect(sentUpdates()).toHaveLength(1);
      expect(sentUpdates()[0].payload.seq).toBe(2);
      server.apply(sentUpdates()[0]);
      expect(server.text()).toBe(store.ydoc.getText("content").toString());
      expect(server.text()).toContain(" w59");
      expect(store.status).toBe("live");

      // The next edit continues from there.
      store.handleMessage({ type: "collab:ack", ok: true, payload: { sessionId: "session-a", seq: 2 } });
      type(store, " after"); await vi.advanceTimersByTimeAsync(50);
      expect(sentUpdates().at(-1).payload.seq).toBe(3);
      vi.useRealTimers();
    });

    it("joins the new session when the old one was saved and closed and nothing was left unsent", () => {
      const store = joined("old text");
      store.handleMessage({ type: "socket:close" });
      store.handleMessage({ type: "socket:open" });

      serverState(store, { sessionId: "session-b", update: encodedState("old text, as saved"), participants: [], ack: 0 });

      expect(store.status).toBe("live");
      expect(store.sessionId).toBe("session-b");
      expect(store.ydoc.getText("content").toString()).toBe("old text, as saved");
    });

    it("keeps unsent text on screen and stays out of a new session it does not belong to", async () => {
      vi.useFakeTimers();
      const store = joined("old text");
      store.handleMessage({ type: "socket:close" });
      harness.connected = false;
      type(store, " typed offline"); await vi.advanceTimersByTimeAsync(50);
      harness.connected = true;
      store.handleMessage({ type: "socket:open" });

      serverState(store, { sessionId: "session-b", update: encodedState("old text, as saved"), participants: [], ack: 0 });

      expect(store.status).toBe("dropped");
      expect(store.ydoc.getText("content").toString()).toBe("old text typed offline");
      expect(store.lastError).toMatch(/still here to copy/);
      expect(harness.sent.at(-1)).toMatchObject({ type: "collab:leave", payload: { sessionId: "session-b" } });
      vi.useRealTimers();
    });
  });

  describe("a refusal that means not now", () => {
    it.each(["RATE_LIMIT", "SESSION_BUSY"])("keeps the session and sends the update again after %s", async (code) => {
      vi.useFakeTimers();
      const store = joined();
      const server = serverCopy(store);
      type(store, " a"); await vi.advanceTimersByTimeAsync(50);
      store.handleMessage({ type: "collab:update", ok: false, error: { code, message: "later", retryable: true } });
      type(store, " b"); await vi.advanceTimersByTimeAsync(50);     // waits behind the refused one

      expect(store.status).toBe("live");
      expect(sentUpdates()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1100);

      const resent = sentUpdates().slice(1);
      expect(resent.map((message) => message.payload.seq)).toEqual([1, 2]);
      resent.forEach(server.apply);
      expect(server.text()).toBe("base a b");
      vi.useRealTimers();
    });

    it("still drops the session for an update the server can never accept", () => {
      const store = joined();
      store.handleMessage({ type: "collab:update", ok: false, error: { code: "INVALID_UPDATE", message: "Invalid collaborative update" } });
      expect(store.status).toBe("dropped");
    });
  });

  it("packs a very large edit into several updates the server will accept", async () => {
    vi.useFakeTimers();
    const store = joined();
    const server = serverCopy(store);
    // A large paste arrives from the editor binding as several insertions.
    for (let i = 0; i < 12; i += 1) type(store, "x".repeat(100 * 1024));
    await vi.advanceTimersByTimeAsync(50);

    const updates = sentUpdates();
    expect(updates.length).toBeGreaterThan(1);
    for (const message of updates) expect(atob(message.payload.update).length).toBeLessThanOrEqual(520 * 1024);
    expect(updates.map((message) => message.payload.seq)).toEqual(updates.map((_, index) => index + 1));
    updates.forEach(server.apply);
    expect(server.text().length).toBe(4 + 12 * 100 * 1024);
    vi.useRealTimers();
  });

  describe("saving", () => {
    it("returns to live when the save fails, for the one who asked and for everyone else", () => {
      const asker = joined();
      asker.saveVersion();
      expect(asker.status).toBe("committing");
      asker.handleMessage({ type: "collab:commit", ok: false, error: { code: "SPACE_NOT_FOUND", message: "Live session not found" } });
      expect(asker.status).toBe("live");
      expect(asker.lastError).toMatch(/could not be saved/);

      setActivePinia(createPinia());
      const other = joined();
      other.handleMessage({ type: "collab:committing", ok: true, payload: { sessionId: "session-a" } });
      expect(other.status).toBe("committing");
      other.handleMessage({ type: "collab:commit-failed", ok: true, payload: { sessionId: "session-a" } });
      expect(other.status).toBe("live");
    });

    it("asks the server to apply a conflict answer instead of rewriting the text itself", () => {
      const store = joined("mine");
      store.handleMessage({ type: "collab:committed", ok: true, payload: {
        sessionId: "session-a", result: "conflict", conflictId: "conflict-1",
        baseContent: "base", mineContent: "mine", theirsContent: "theirs", conflicts: [{}], at: "now",
      } });
      harness.sent.length = 0;

      expect(store.resolveConflict("theirs")).toBe(true);

      expect(harness.sent).toEqual([expect.objectContaining({
        type: "collab:resolve", payload: { sessionId: "session-a", conflictId: "conflict-1", content: "theirs" },
      })]);
      // Nothing changes locally until the server's update arrives.
      expect(store.ydoc.getText("content").toString()).toBe("mine");
      expect(store.conflict).not.toBeNull();

      store.handleMessage({ type: "collab:conflict-resolved", ok: true, payload: { sessionId: "session-a", by: { name: "Alice" } } });
      expect(store.conflict).toBeNull();
      expect(store.lastError).toBeNull();
    });

    it("closes the conflict quietly when someone else answered first", () => {
      const store = joined("mine");
      store.handleMessage({ type: "collab:committed", ok: true, payload: {
        sessionId: "session-a", result: "conflict", conflictId: "conflict-1", conflicts: [{}], at: "now",
      } });
      store.resolveConflict("mine");

      store.handleMessage({ type: "collab:resolve", ok: false, error: { code: "CONFLICT_RESOLVED", retryable: true } });

      expect(store.conflict).toBeNull();
      expect(store.status).toBe("live");
    });
  });
});
