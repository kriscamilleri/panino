// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

let syncStore;

vi.mock("../../src/store/syncStore.js", () => ({
    useSyncStore: () => syncStore,
}));

import { useConflictStore } from "../../src/store/conflictStore.js";

describe("conflictStore (COLLAB-02 §6.2)", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.restoreAllMocks();
        syncStore = {
            isInitialized: true,
            execute: vi.fn(async (sql) => {
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

    it("clears all conflicts", async () => {
        const store = useConflictStore();
        await store.loadConflicts();
        expect(store.count).toBe(2);
        store.clearAll();
        expect(store.count).toBe(0);
    });
});
