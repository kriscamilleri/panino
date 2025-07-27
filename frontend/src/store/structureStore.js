// /frontend/src/store/structureStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { v4 as uuidv4 } from 'uuid';
import { useAuthStore } from './authStore';

export const useStructureStore = defineStore('structureStore', () => {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();

    // State is much simpler now
    const rootItems = ref([]);
    const selectedFileId = ref(null);
    const selectedFolderId = ref(null);
    const openFolders = ref(new Set());

    const selectedFile = ref(null);

    // Watch for PowerSync initialization and load root items
    watch(() => syncStore.isInitialized, async (ready) => {
        if (ready) {
            await loadRootItems();
        }
    }, { immediate: true });

    // Watch for selection changes to fetch the full file data
    watch(selectedFileId, async (newId) => {
        if (newId) {
            // Read operations are fine with .execute()
            const result = await syncStore.execute('SELECT * FROM notes WHERE id = ?', [newId]);
            selectedFile.value = result.rows?._array[0] || null;
        } else {
            selectedFile.value = null;
        }
    }, { immediate: true });

    const selectedFileContent = computed(() => selectedFile.value?.content || '');

    async function loadRootItems() {
        const query = `
            SELECT id, name, 'folder' as type, parent_id FROM folders WHERE parent_id IS NULL
            UNION ALL
            SELECT id, title as name, 'file' as type, folder_id as parent_id FROM notes WHERE folder_id IS NULL
            ORDER BY type, name;
        `;
        if (!syncStore.isInitialized) return;
        const result = await syncStore.execute(query);
        rootItems.value = result.rows?._array || [];
    }

    async function getChildren(parentId) {
        if (!syncStore.isInitialized || !parentId) return [];
        const query = `
            SELECT id, name, 'folder' as type, parent_id FROM folders WHERE parent_id = ?
            UNION ALL
            SELECT id, title as name, 'file' as type, folder_id as parent_id FROM notes WHERE folder_id = ?
            ORDER BY type, name;
        `;
        const result = await syncStore.execute(query, [parentId, parentId]);
        return result.rows?._array || [];
    }

    // --- Actions ---

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

        await syncStore.powerSync.writeTransaction(async (tx) => {
            // FIXED: Renamed tx.executeAsync to tx.execute
            await tx.execute('INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [newNote.id, newNote.user_id, newNote.folder_id, newNote.title, newNote.content, newNote.created_at, newNote.updated_at]
            );
        });

        if (parentId === null) {
            await loadRootItems();
        }
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

        await syncStore.powerSync.writeTransaction(async (tx) => {
            // FIXED: Renamed tx.executeAsync to tx.execute
            await tx.execute('INSERT INTO folders (id, user_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
                [newFolder.id, newFolder.user_id, newFolder.parent_id, newFolder.name, newFolder.created_at]
            );
        });

        if (parentId === null) {
            await loadRootItems();
        }
        return { id: newFolder.id, type: 'folder', name };
    }

    async function deleteItem(id, type) {
        const wasSelected = selectedFileId.value === id || selectedFolderId.value === id;

        const getParentId = async () => {
            if (type === 'folder') {
                const res = await syncStore.execute('SELECT parent_id FROM folders WHERE id = ?', [id]);
                return res.rows?._array[0]?.parent_id ?? null;
            }
            const res = await syncStore.execute('SELECT folder_id FROM notes WHERE id = ?', [id]);
            return res.rows?._array[0]?.folder_id ?? null;
        };
        const parentId = await getParentId();

        if (type === 'folder') {
            const children = await getChildren(id);
            for (const child of children) {
                await deleteItem(child.id, child.type);
            }
            await syncStore.powerSync.writeTransaction(async (tx) => {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('DELETE FROM folders WHERE id = ?', [id]);
            });
        } else {
            await syncStore.powerSync.writeTransaction(async (tx) => {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('DELETE FROM notes WHERE id = ?', [id]);
            });
        }

        if (wasSelected) {
            selectedFileId.value = null;
            selectedFolderId.value = null;
        }

        if (parentId === null) {
            await loadRootItems();
        }
        return parentId;
    }

    async function renameItem(id, newName, type) {
        await syncStore.powerSync.writeTransaction(async (tx) => {
            if (type === 'folder') {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('UPDATE folders SET name = ? WHERE id = ?', [newName, id]);
            } else {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?', [newName, new Date().toISOString(), id]);
            }
        });
    }

    async function moveItem(itemId, newParentId, type) {
        let oldParentId = null;
        if (type === 'folder') {
            const res = await syncStore.execute('SELECT parent_id FROM folders WHERE id = ?', [itemId]);
            oldParentId = res.rows?._array[0]?.parent_id;
        } else {
            const res = await syncStore.execute('SELECT folder_id FROM notes WHERE id = ?', [itemId]);
            oldParentId = res.rows?._array[0]?.folder_id;
        }

        await syncStore.powerSync.writeTransaction(async (tx) => {
            if (type === 'folder') {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('UPDATE folders SET parent_id = ? WHERE id = ?', [newParentId, itemId]);
            } else {
                // FIXED: Renamed tx.executeAsync to tx.execute
                await tx.execute('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?', [newParentId, new Date().toISOString(), itemId]);
            }
        });

        if (oldParentId === null || newParentId === null) {
            await loadRootItems();
        }
        return { oldParentId, newParentId };
    }

    async function updateFileContent(fileId, newContent) {
        await syncStore.powerSync.writeTransaction(async (tx) => {
            // FIXED: Renamed tx.executeAsync to tx.execute
            await tx.execute('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [newContent, new Date().toISOString(), fileId]);
        });

        if (selectedFile.value && selectedFile.value.id === fileId) {
            selectedFile.value.content = newContent;
            selectedFile.value.updated_at = new Date().toISOString();
        }
    }

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
        selectedFileId, selectedFolderId, openFolders, selectedFile, selectedFileContent,
        loadRootItems,
        getChildren,
        createFile, createFolder, deleteItem, renameItem, moveItem,
        selectFile, selectFolder, toggleFolder, updateFileContent,
        resetStore
    };
});