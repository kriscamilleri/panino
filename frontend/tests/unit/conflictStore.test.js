// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

let syncStore;
let database;

vi.mock("../../src/store/syncStore.js", () => ({
    useSyncStore: () => syncStore,
}));

import { useConflictStore } from "../../src/store/conflictStore.js";

describe("conflictStore (COLLAB-02 §6.2)", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.restoreAllMocks();
        database = {
            exec: vi.fn(async () => undefined),
            execO: vi.fn(async () => [{ updated_at: "2026-08-16T20:00:00.000Z", merge_attempts: 2 }]),
        };
        syncStore = {
            isInitialized: true,
            db: { value: database },
            execute: vi.fn(async (sql) => {
                if (sql.includes("base_content")) {
                    return [{
                        note_id: "note-a",
                        base_content: "base",
                        mine_content: "mine",
                        theirs_content: "theirs",
                        conflict_hunks: JSON.stringify([{ baseLines: ["base"], mineLines: ["mine"], theirsLines: ["theirs"] }]),
                        created_at: "2026-08-16T19:00:00.000Z",
                        updated_at: "2026-08-16T20:00:00.000Z",
                        merge_attempts: 2,
                    }];
                }
                if (sql.includes("note_conflicts")) {
                    return [
                        { note_id: "note-a" },
                        { note_id: "note-b" },
                    ];
                }
                return [];
            }),
        };
    });

    it("loads the set of conflicted note ids", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        expect(store.count).toBe(2);
        expect(store.hasConflict("note-a")).toBe(true);
        expect(store.hasConflict("note-b")).toBe(true);
        expect(store.hasConflict("note-c")).toBe(false);
    });

    it("treats an empty result as no conflicts", async () => {
        syncStore.execute = vi.fn(async () => []);
        const store = useConflictStore();
        await store.loadConflicts();
        expect(store.count).toBe(0);
        expect(store.hasConflict("note-a")).toBe(false);
    });

    it("loads and normalizes one complete conflict lazily", async () => {
        const store = useConflictStore();
        const conflict = await store.loadConflict("note-a");

        expect(syncStore.execute).toHaveBeenCalledWith(expect.stringContaining("WHERE note_id = ?"), ["note-a"]);
        expect(conflict).toMatchObject({
            noteId: "note-a",
            baseContent: "base",
            mineContent: "mine",
            theirsContent: "theirs",
            mergeAttempts: 2,
        });
        expect(conflict.conflictHunks).toHaveLength(1);
    });

    it("treats malformed serialized hunks as recoverable detail state", async () => {
        syncStore.execute = vi.fn(async (sql) => sql.includes("base_content") ? [{
            note_id: "note-a",
            base_content: "base",
            mine_content: "mine",
            theirs_content: "theirs",
            conflict_hunks: "not json",
            updated_at: "stamp",
            merge_attempts: 1,
        }] : []);
        const store = useConflictStore();
        const conflict = await store.loadConflict("note-a");
        expect(conflict.conflictHunks).toEqual([]);
    });

    it("atomically writes the resolution, resets the guard, and removes the marker", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        const conflict = await store.loadConflict("note-a");

        await store.resolveConflict(conflict, "resolved");

        const calls = database.exec.mock.calls.map(([sql]) => sql.trim());
        expect(calls[0]).toBe("BEGIN");
        expect(calls.some((sql) => sql.startsWith("UPDATE notes SET content"))).toBe(true);
        expect(calls.some((sql) => sql.includes("writeback_count = 0"))).toBe(true);
        expect(calls.some((sql) => sql.startsWith("DELETE FROM note_conflicts"))).toBe(true);
        expect(calls.at(-1)).toBe("COMMIT");
        expect(store.hasConflict("note-a")).toBe(false);
    });

    it("rolls back and keeps the marker when the reviewed record is stale", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        const conflict = await store.loadConflict("note-a");
        database.execO.mockResolvedValueOnce([{ updated_at: "newer", merge_attempts: 3 }]);

        await expect(store.resolveConflict(conflict, "resolved")).rejects.toMatchObject({ code: "CONFLICT_STALE" });
        expect(database.exec).toHaveBeenLastCalledWith("ROLLBACK");
        expect(store.hasConflict("note-a")).toBe(true);
        expect(database.exec.mock.calls.some(([sql]) => sql.includes("UPDATE notes"))).toBe(false);
    });

    it("rolls back if any resolution write fails", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        const conflict = await store.loadConflict("note-a");
        database.exec.mockImplementation(async (sql) => {
            if (sql.includes("note_sync_base")) throw new Error("base write failed");
        });

        await expect(store.resolveConflict(conflict, "resolved")).rejects.toThrow("base write failed");
        expect(database.exec).toHaveBeenLastCalledWith("ROLLBACK");
        expect(store.hasConflict("note-a")).toBe(true);
    });

    it("clears all conflicts", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        expect(store.count).toBe(2);
        store.clearAll();
        expect(store.count).toBe(0);
    });
});
