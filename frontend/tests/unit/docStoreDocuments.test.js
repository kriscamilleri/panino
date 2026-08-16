import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { ref } from 'vue';

/**
 * The docStore facade pulls refs out of structureStore and only needs syncStore
 * for database access, so both are replaced with minimal real Pinia stores and
 * the remaining collaborators with inert ones.
 */
const execute = vi.fn(async () => []);
const dbExec = vi.fn(async () => { });
const markContentChanged = vi.fn();

vi.mock('@/store/syncStore', () => ({
    useSyncStore: defineStore('syncStore', () => ({
        execute,
        // The real store exposes `db` as a plain object with a `value` getter
        // so Pinia's reactive unwrapping does not swallow it; mirror that.
        db: { value: { exec: dbExec } },
        isInitialized: ref(true),
        resetDatabase: vi.fn(),
    })),
}));

vi.mock('@/store/structureStore', () => ({
    useStructureStore: defineStore('structureStore', () => ({
        rootItems: ref([]),
        selectedFileId: ref(null),
        selectedFolderId: ref(null),
        openFolders: ref(new Set()),
        selectedFile: ref(null),
        selectedFileContent: ref(''),
        contentVersion: ref(0),
        markContentChanged,
        loadRootItems: vi.fn(),
        getChildren: vi.fn(),
        createFile: vi.fn(),
        createFolder: vi.fn(),
        deleteItem: vi.fn(),
        renameItem: vi.fn(),
        moveItem: vi.fn(),
        selectFile: vi.fn(),
        selectFolder: vi.fn(),
        toggleFolder: vi.fn(),
        duplicateFile: vi.fn(),
        updateFileContent: vi.fn(),
        reFetchSelectedFile: vi.fn(),
        resetStore: vi.fn(),
    })),
}));

vi.mock('@/store/markdownStore', () => ({
    useMarkdownStore: defineStore('markdownStore', () => ({
        styles: ref({}),
        printStyles: ref({}),
        updateStyle: vi.fn(),
        getMarkdownIt: vi.fn(),
        updatePrintStyle: vi.fn(),
        getPrintMarkdownIt: vi.fn(),
        resetStyles: vi.fn(),
        resetPrintStyles: vi.fn(),
    })),
}));

vi.mock('@/store/importExportStore', () => ({
    useImportExportStore: defineStore('importExportStore', () => ({
        exportDataAsJsonString: vi.fn(),
        exportDataAsZip: vi.fn(),
        importData: vi.fn(),
        exportDataAsStackEditJsonString: vi.fn(),
        importStackEditData: vi.fn(),
        importMarkdownFiles: vi.fn(),
        importMarkdownDirectory: vi.fn(),
        importZipArchive: vi.fn(),
    })),
}));

const { useDocStore } = await import('@/store/docStore.js');

function noteRow(overrides = {}) {
    return {
        id: 'note-1',
        title: 'Note',
        content: 'Some content here',
        updated_at: '2026-08-16T10:00:00.000Z',
        created_at: '2026-08-15T10:00:00.000Z',
        folder_id: null,
        folderPath: 'Root',
        pinned: 0,
        ...overrides,
    };
}

let store;

beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    execute.mockImplementation(async () => []);
    dbExec.mockImplementation(async () => { });
    store = useDocStore();
});

describe('docStore.getRecentDocuments', () => {
    it('requests a bounded global result set with the limit as a bound parameter', async () => {
        await store.getRecentDocuments(50);

        const [sql, params] = execute.mock.calls[0];
        expect(params).toEqual([50]);
        expect(sql).toContain('LIMIT ?');
        expect(sql).not.toMatch(/LIMIT\s+50/);
        expect(sql).not.toContain('WHERE notes.folder_id');
    });

    it('defaults to fifty documents rather than the old ten', async () => {
        await store.getRecentDocuments();
        expect(execute.mock.calls[0][1]).toEqual([50]);
    });

    it('normalizes rows, including pin state', async () => {
        execute.mockResolvedValue([
            noteRow({ id: 'a', pinned: 1, folderPath: 'Work / Planning' }),
            noteRow({ id: 'b', pinned: 0 }),
            noteRow({ id: 'c', pinned: null }),
        ]);

        const result = await store.getRecentDocuments(50);

        expect(result.map((d) => d.id)).toEqual(['a', 'b', 'c']);
        expect(result.map((d) => d.isPinned)).toEqual([true, false, false]);
        expect(result[0].folderName).toBe('Work / Planning');
        expect(result[0].wordCount).toBe(3);
    });

    it('returns an empty list instead of throwing when the query fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
        execute.mockRejectedValue(new Error('db down'));

        await expect(store.getRecentDocuments(50)).resolves.toEqual([]);
        consoleError.mockRestore();
    });
});

describe('docStore.getFolderDocuments', () => {
    it('scopes to notes directly in the folder, with the id bound as a parameter', async () => {
        await store.getFolderDocuments('folder-1', 50);

        const [sql, params] = execute.mock.calls[0];
        expect(sql).toContain('WHERE notes.folder_id IS ?');
        expect(sql).not.toContain('folder-1');
        expect(params).toEqual(['folder-1', 50]);
    });

    it('does not walk descendant folders', async () => {
        await store.getFolderDocuments('folder-1', 50);

        const [sql] = execute.mock.calls[0];
        // The only recursive CTE is the folder-path builder, which never widens
        // the note selection itself.
        expect(sql).not.toMatch(/notes\.folder_id\s+IN/);
        expect(sql).toMatch(/WHERE notes\.folder_id IS \?/);
    });

    it('treats a null folder id as the root scope', async () => {
        await store.getFolderDocuments(null, 25);
        expect(execute.mock.calls[0][1]).toEqual([null, 25]);
    });

    it('normalizes folder rows the same way as global rows', async () => {
        execute.mockResolvedValue([noteRow({ id: 'f1', pinned: 1, folder_id: 'folder-1' })]);

        const [doc] = await store.getFolderDocuments('folder-1', 50);
        expect(doc.isPinned).toBe(true);
        expect(doc.folderId).toBe('folder-1');
    });

    it('returns an empty list instead of throwing when the query fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
        execute.mockRejectedValue(new Error('db down'));

        await expect(store.getFolderDocuments('folder-1', 50)).resolves.toEqual([]);
        consoleError.mockRestore();
    });
});

describe('docStore.setDocumentPinned', () => {
    it('writes 1 and moves updated_at when pinning', async () => {
        await store.setDocumentPinned('note-1', true);

        const [sql, params] = dbExec.mock.calls[0];
        expect(sql).toBe('UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?');
        expect(params[0]).toBe(1);
        expect(params[2]).toBe('note-1');
        expect(() => new Date(params[1]).toISOString()).not.toThrow();
        expect(sql).not.toContain('note-1');
    });

    it('writes 0 when unpinning', async () => {
        await store.setDocumentPinned('note-1', false);
        expect(dbExec.mock.calls[0][1][0]).toBe(0);
    });

    it('signals the change so mounted dashboards refresh', async () => {
        await store.setDocumentPinned('note-1', true);
        expect(markContentChanged).toHaveBeenCalledTimes(1);
    });

    it('rejects without signalling a change when the write fails', async () => {
        dbExec.mockRejectedValue(new Error('write failed'));

        await expect(store.setDocumentPinned('note-1', true)).rejects.toThrow('write failed');
        expect(markContentChanged).not.toHaveBeenCalled();
    });

    it('rejects when no document id is supplied', async () => {
        await expect(store.setDocumentPinned('', true)).rejects.toThrow(/document id/i);
        expect(dbExec).not.toHaveBeenCalled();
    });
});
