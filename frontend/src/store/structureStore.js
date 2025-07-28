// /frontend/src/store/structureStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { v4 as uuidv4 } from 'uuid';
import { useAuthStore } from './authStore';

export const useStructureStore = defineStore('structureStore', () => {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();

    // --- State ---
    const rootItems = ref([]);
    const selectedFileId = ref(null);
    const selectedFolderId = ref(null);
    const openFolders = ref(new Set());
    const selectedFile = ref(null);

    // --- Watchers ---

    // Load initial data once the database is ready
    watch(() => syncStore.isInitialized, async (ready) => {
        if (ready) await loadRootItems();
    }, { immediate: true });

    // Fetch full data for the selected file whenever the ID changes
    watch(selectedFileId, async (newId) => {
        if (newId) {
            const result = await syncStore.execute('SELECT * FROM notes WHERE id = ?', [newId]);
            selectedFile.value = result[0] || null;
        } else {
            selectedFile.value = null;
        }
    }, { immediate: true });

    // --- Getters / Computed ---
    const selectedFileContent = computed(() => selectedFile.value?.content || '');

    // --- New Action for Refreshing ---
    async function reFetchSelectedFile() {
        if (selectedFileId.value) {
            console.log(`[StructureStore] Re-fetching content for file ID: ${selectedFileId.value}`);
            const result = await syncStore.execute('SELECT * FROM notes WHERE id = ?', [selectedFileId.value]);
            selectedFile.value = result[0] || null;
        }
    }

    // --- Read Actions ---

    async function loadRootItems() {
        if (!syncStore.isInitialized) return;
        const query = `
            SELECT id, name, 'folder' as type FROM folders WHERE parent_id IS NULL
            UNION ALL
            SELECT id, title as name, 'file' as type FROM notes WHERE folder_id IS NULL
            ORDER BY type DESC, name
        `.trim();
        rootItems.value = await syncStore.execute(query);
    }

    async function getChildren(parentId) {
        if (!syncStore.isInitialized || !parentId) return [];
        const query = `
            SELECT id, name, 'folder' as type FROM folders WHERE parent_id = ?
            UNION ALL
            SELECT id, title as name, 'file' as type FROM notes WHERE folder_id = ?
            ORDER BY type DESC, name
        `.trim();
        return await syncStore.execute(query, [parentId, parentId]);
    }

    // --- Write Actions ---

    async function createFile(name, parentId = null) {
        if (!authStore.user?.id) throw new Error("User is not authenticated.");
        const newNote = {
            id: uuidv4(),
            user_id: authStore.user.id,
            folder_id: parentId,
            title: name,
            content: `# ${name}\n\n`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // CORRECTED: Use .db.value.exec
        await syncStore.db.value.exec(
            'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newNote.id, newNote.user_id, newNote.folder_id, newNote.title, newNote.content, newNote.created_at, newNote.updated_at]
        );

        if (parentId === null) await loadRootItems();
        return { id: newNote.id, type: 'file', name };
    }

    async function createFolder(name, parentId = null) {
        if (!authStore.user?.id) throw new Error("User is not authenticated.");
        const newFolder = {
            id: uuidv4(),
            user_id: authStore.user.id,
            parent_id: parentId,
            name: name,
            created_at: new Date().toISOString()
        };

        // CORRECTED: Use .db.value.exec
        await syncStore.db.value.exec(
            'INSERT INTO folders (id, user_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
            [newFolder.id, newFolder.user_id, newFolder.parent_id, newFolder.name, newFolder.created_at]
        );

        if (parentId === null) await loadRootItems();
        return { id: newFolder.id, type: 'folder', name };
    }
    async function deleteItem(id, type) {
        const wasSelected = selectedFileId.value === id || selectedFolderId.value === id;

        if (type === 'folder') {
            const children = await getChildren(id);
            for (const child of children) {
                await deleteItem(child.id, child.type); // Recurse
            }
            // CORRECTED: Use .db.value.exec
            await syncStore.db.value.exec('DELETE FROM folders WHERE id = ?', [id]);
        } else {
            // CORRECTED: Use .db.value.exec
            await syncStore.db.value.exec('DELETE FROM notes WHERE id = ?', [id]);
        }

        if (wasSelected) {
            selectedFileId.value = null;
            selectedFolderId.value = null;
        }
        await loadRootItems(); // Simple refresh for now
    }

    async function renameItem(id, newName, type) {
        if (type === 'folder') {
            await syncStore.db.value.exec('UPDATE folders SET name = ? WHERE id = ?', [newName, id]);
        } else {
            await syncStore.db.value.exec('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?', [newName, new Date().toISOString(), id]);
        }
        await loadRootItems(); // Simple refresh
    }

    async function moveItem(itemId, newParentId, type) {
        // NOTE: This function was missing in your provided file but is called from TreeItem.vue.
        // Assuming it looks like this, add .value.
        const oldParentResult = await syncStore.execute(`
            SELECT
                CASE
                    WHEN (SELECT parent_id FROM folders WHERE id = ?) IS NOT NULL THEN (SELECT parent_id FROM folders WHERE id = ?)
                    WHEN (SELECT folder_id FROM notes WHERE id = ?) IS NOT NULL THEN (SELECT folder_id FROM notes WHERE id = ?)
                    ELSE NULL
                END as old_parent_id
        `.trim(), [itemId, itemId, itemId, itemId]);
        const oldParentId = oldParentResult[0]?.old_parent_id;

        if (type === 'folder') {
            await syncStore.db.value.exec('UPDATE folders SET parent_id = ? WHERE id = ?', [newParentId, itemId]);
        } else {
            await syncStore.db.value.exec('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?', [newParentId, new Date().toISOString(), itemId]);
        }
        return { oldParentId };
    }

    async function updateFileContent(fileId, newContent) {
        await syncStore.db.value.exec('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [newContent, new Date().toISOString(), fileId]);
        if (selectedFile.value?.id === fileId) {
            selectedFile.value.content = newContent; // Optimistic update
        }
    }

    // --- UI State Actions ---

    function selectFile(fileId) {
        selectedFileId.value = fileId;
        selectedFolderId.value = null;
    }

    function selectFolder(folderId) {
        selectedFileId.value = null;
        selectedFolderId.value = folderId;
    }

    function toggleFolder(folderId) {
        const newSet = new Set(openFolders.value);
        if (newSet.has(folderId)) {
            newSet.delete(folderId);
        } else {
            newSet.add(folderId);
        }
        openFolders.value = newSet;
    }

    function resetStore() {
        rootItems.value = [];
        selectedFileId.value = null;
        selectedFolderId.value = null;
        openFolders.value = new Set();
        selectedFile.value = null;
    }

    return {
        rootItems,
        selectedFileId,
        selectedFolderId,
        openFolders,
        selectedFile,
        selectedFileContent,
        loadRootItems,
        getChildren,
        createFile,
        createFolder,
        deleteItem,
        renameItem,
        moveItem,
        selectFile,
        selectFolder,
        toggleFolder,
        updateFileContent,
        reFetchSelectedFile,
        resetStore
    };
});