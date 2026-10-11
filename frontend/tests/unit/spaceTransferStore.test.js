import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { ref } from "vue";

const sync = vi.fn(async () => {});
const sharedSpacesAvailable = ref(true);
const refreshToken = vi.fn(async () => false);
const ensureUploaded = vi.fn(async () => ({ ok: true }));
const editor = { holding: false, flushPendingSave: vi.fn(async () => {}) };
const conflicts = new Set();

vi.mock("@/store/authStore", () => ({
  useAuthStore: defineStore("authStore", () => ({
    token: ref("token"),
    refreshToken,
  })),
}));

vi.mock("@/store/syncStore", () => ({
  useSyncStore: defineStore("syncStore", () => ({ sync, sharedSpacesAvailable, ensureUploaded })),
}));
vi.mock("@/store/editorStore", () => ({
  useEditorStore: () => ({
    isHoldingChanges: () => editor.holding,
    flushPendingSave: editor.flushPendingSave,
  }),
}));
vi.mock("@/store/conflictStore", () => ({
  useConflictStore: () => ({ hasConflict: (noteId, dbKey) => conflicts.has(`${dbKey}:${noteId}`) }),
}));

const SOURCE_DB = "user:11111111-1111-4111-8111-111111111111";
const NOTE = "33333333-3333-4333-8333-333333333333";
const move = {
  sourceDbKey: SOURCE_DB,
  destinationDbKey: "space:22222222-2222-4222-8222-222222222222",
  sourceNoteId: NOTE,
  destinationFolderId: null,
  documentName: "Plan",
};

const { useSpaceTransferStore } = await import("@/store/spaceTransferStore.js");

describe("spaceTransferStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    sharedSpacesAvailable.value = true;
    ensureUploaded.mockResolvedValue({ ok: true });
    editor.holding = false;
    conflicts.clear();
  });

  it("asks for nothing when the server offers no shared spaces", async () => {
    // With the feature off this used to cost every user one request per load.
    sharedSpacesAvailable.value = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = useSpaceTransferStore();

    expect(await store.loadRecoverable()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before creating and syncing a transfer", async () => {
    const transfer = {
      id: "transfer-a",
      status: "complete",
      warnings: [],
      revisionHistoryTransferred: false,
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ transfer }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transfers: [] }) }));
    const store = useSpaceTransferStore();
    store.begin(move);

    expect(fetch).not.toHaveBeenCalled();
    await expect(store.confirm("move")).resolves.toEqual(transfer);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining("/space-transfers"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"sourceNoteId":"33333333-3333-4333-8333-333333333333"'),
      }));
    expect(JSON.parse(fetch.mock.calls[0][1].body).mode).toBe("move");
    expect(sync).toHaveBeenCalledOnce();
    expect(store.pending).toBeNull();
  });

  it("does nothing until told whether to copy or move", async () => {
    // Moving deletes the original and its history. It is never the fallback.
    vi.stubGlobal("fetch", vi.fn());
    const store = useSpaceTransferStore();
    store.begin(move);

    for (const mode of [undefined, null, "", "MOVE", "link", true]) {
      await expect(store.confirm(mode)).rejects.toThrow(/copy or move/);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.flushPendingSave).not.toHaveBeenCalled();
    expect(store.pending).toMatchObject({ sourceNoteId: NOTE });
    expect(store.working).toBe(false);
  });

  it("asks the server for a copy when a copy was chosen, and says so while it works", async () => {
    const transfer = { id: "transfer-c", status: "kept_both", mode: "copy", warnings: [] };
    let release;
    const seen = [];
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 201, json: async () => ({ transfer }) });
      }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transfers: [] }) }));
    const store = useSpaceTransferStore();
    store.begin(move);

    const done = store.confirm("copy");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    seen.push(store.working, store.workingMode);
    release();

    await expect(done).resolves.toEqual(transfer);
    expect(seen).toEqual([true, "copy"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ mode: "copy", sourceNoteId: NOTE });
    expect(store.workingMode).toBeNull();
    expect(store.pending).toBeNull();
    // The copy arrives in the destination by an ordinary sync.
    expect(sync).toHaveBeenCalledOnce();
    expect(store.recoverable).toEqual([]);
  });

  describe("before the server is asked to copy or move a Document", () => {
    // The server works on its own version. Text that exists only on this
    // device would be left out of a copy, and deleted with the original by a
    // move.
    const requestMove = async (mode = "move") => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ transfers: [], transfer: { id: "t" } }) }));
      const store = useSpaceTransferStore();
      store.begin(move);
      return { store, outcome: await store.confirm(mode).then(() => null, (failure) => failure) };
    };
    const moveRequests = () => fetch.mock.calls.filter(([, options]) => options?.method === "POST");

    it("saves what the editor was still holding, then confirms the upload, then asks", async () => {
      const order = [];
      editor.flushPendingSave.mockImplementation(async () => { order.push("save"); });
      ensureUploaded.mockImplementation(async (dbKey) => { order.push(`upload ${dbKey}`); return { ok: true }; });

      const { outcome } = await requestMove();

      expect(outcome).toBeNull();
      expect(order).toEqual(["save", `upload ${SOURCE_DB}`]);
      expect(moveRequests()).toHaveLength(1);
    });

    it.each([
      ["sync-disabled", /Sync is turned off/],
      ["offline", /offline/],
      ["sync-failed", /Sync is failing/],
      ["still-uploading", /still uploading/],
    ])("does not ask while the upload is %s", async (reason, message) => {
      ensureUploaded.mockResolvedValue({ ok: false, reason });

      const { store, outcome } = await requestMove();

      expect(outcome.message).toMatch(message);
      expect(store.error).toMatch(message);
      expect(moveRequests()).toHaveLength(0);
      // The confirmation stays open so the user can retry.
      expect(store.pending).toMatchObject({ sourceNoteId: NOTE });
    });

    it.each([
      ["sync-disabled", /Sync is turned off/],
      ["offline", /cannot be copied now/],
      ["sync-failed", /A copy made now would be missing your recent changes/],
      ["still-uploading", /still uploading/],
    ])("does not ask for a copy either while the upload is %s", async (reason, message) => {
      // A copy deletes nothing, but one made from stale text is a wrong copy.
      ensureUploaded.mockResolvedValue({ ok: false, reason });

      const { store, outcome } = await requestMove("copy");

      expect(outcome.message).toMatch(message);
      expect(outcome.message).not.toMatch(/mov/i);
      expect(moveRequests()).toHaveLength(0);
      expect(store.pending).toMatchObject({ sourceNoteId: NOTE });
    });

    it("names the action in what it asks the user to settle first", async () => {
      editor.holding = true;
      expect((await requestMove("copy")).outcome.message).toMatch(/before copying it/);
      expect((await requestMove("move")).outcome.message).toMatch(/before moving it/);

      editor.holding = false;
      conflicts.add(`${SOURCE_DB}:${NOTE}`);
      expect((await requestMove("copy")).outcome.message).toMatch(/before copying it/);
    });

    it("does not ask while the editor is holding unsaved text against a remote change", async () => {
      editor.holding = true;

      const { outcome } = await requestMove();

      expect(outcome.message).toMatch(/being held/);
      expect(editor.flushPendingSave).not.toHaveBeenCalled();
      expect(moveRequests()).toHaveLength(0);
    });

    it("does not ask while the Document has an unresolved conflict", async () => {
      conflicts.add(`${SOURCE_DB}:${NOTE}`);

      const { outcome } = await requestMove();

      expect(outcome.message).toMatch(/Resolve this Document/);
      expect(ensureUploaded).not.toHaveBeenCalled();
      expect(moveRequests()).toHaveLength(0);
    });
  });

  it("cancels a move that has not copied the Document yet", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error("no body"); } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transfers: [] }) }));
    const store = useSpaceTransferStore();

    await store.abandon("transfer-a");

    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/space-transfers\/transfer-a$/),
      expect.objectContaining({ method: "DELETE" }));
    expect(store.recoverable).toEqual([]);
    expect(store.error).toBe("");
  });

  it("keeps interrupted transfers visible with all recovery actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        transfers: [{ id: "transfer-a", status: "recoverable_duplicate" }],
      }),
    }));
    const store = useSpaceTransferStore();

    await store.loadRecoverable();

    expect(store.recoverable).toEqual([
      expect.objectContaining({ id: "transfer-a", status: "recoverable_duplicate" }),
    ]);
    expect(typeof store.retry).toBe("function");
    expect(typeof store.keepBoth).toBe("function");
    expect(typeof store.deleteSource).toBe("function");
  });
});
