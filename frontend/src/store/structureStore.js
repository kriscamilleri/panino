// /frontend/src/store/structureStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { v4 as uuidv4 } from 'uuid'; // Use a proper UUID generator

export const useStructureStore = defineStore('structureStore', () => {
    const syncStore = useSyncStore();

    // Reactive state for the entire structure
    const folders = ref([]);
    const notes = ref([]);

    // UI State
    const selectedFileId = ref(null);
    const selectedFolderId = ref(null);
    const openFolders = ref(new Set());

    // Watch for PowerSync initialization
    watch(() => syncStore.isInitialized, (ready) => {
        if (ready) {
            // Setup live queries
            syncStore.powerSync.watch('SELECT * FROM folders', [], (result) => {
                folders.value = result.rows?._array || [];
            });
            syncStore.powerSync.watch('SELECT * FROM notes', [], (result) => {
                notes.value = result.rows?._array || [];
            });
        }
    }, { immediate: true });

    // Computed properties to derive the tree structure
    const allItems = computed(() => [...folders.value, ...notes.value].map(item => ({
        ...item,
        // Normalize type for UI
        type: item.title !== undefined ? 'file' : 'folder',
        name: item.title ?? item.name
    })));

    const rootItems = computed(() => {
        const sorted = allItems.value
            .filter(i => i.parent_id == null && i.folder_id == null)
            .sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'folder' ? -1 : 1;
            });
        return sorted;
    });

    const selectedFile = computed(() => {
        return notes.value.find(n => n.id === selectedFileId.value) || null;
    });

    const selectedFileContent = computed(() => selectedFile.value?.content || '');

    function getChildren(parentId) {
        const children = allItems.value
            .filter(i => i.parent_id === parentId || i.folder_id === parentId)
            .sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'folder' ? -1 : 1;
            });
        return children;
    }

    // Actions
    async function createFile(name, parentId = null) {
        const newNote = {
            id: uuidv4(),
            folder_id: parentId,
            title: name,
            content: `# ${name}\n\n`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await syncStore.execute('INSERT INTO notes (id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [newNote.id, newNote.folder_id, newNote.title, newNote.content, newNote.created_at, newNote.updated_at]
        );
        await selectFile(newNote.id);
    }

    async function createFolder(name, parentId = null) {
        const newFolder = {
            id: uuidv4(),
            parent_id: parentId,
            name: name,
            created_at: new Date().toISOString()
        };
        await syncStore.execute('INSERT INTO folders (id, parent_id, name, created_at) VALUES (?, ?, ?, ?)',
            [newFolder.id, newFolder.parent_id, newFolder.name, newFolder.created_at]
        );
    }

    async function deleteItem(id, type) {
        if (type === 'folder') {
            // Recursively delete children first (a more robust solution would use transactions or backend logic)
            const children = getChildren(id);
            for (const child of children) {
                await deleteItem(child.id, child.type);
            }
            await syncStore.execute('DELETE FROM folders WHERE id = ?', [id]);
        } else {
            await syncStore.execute('DELETE FROM notes WHERE id = ?', [id]);
        }
    }

    async function renameItem(id, newName, type) {
        if (type === 'folder') {
            await syncStore.execute('UPDATE folders SET name = ? WHERE id = ?', [newName, id]);
        } else {
            await syncStore.execute('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?', [newName, new Date().toISOString(), id]);
        }
    }

    async function moveItem(itemId, newParentId, type) {
        if (type === 'folder') {
            await syncStore.execute('UPDATE folders SET parent_id = ? WHERE id = ?', [newParentId, itemId]);
        } else {
            await syncStore.execute('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?', [newParentId, new Date().toISOString(), itemId]);
        }
    }

    async function updateFileContent(fileId, newContent) {
        await syncStore.execute('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [newContent, new Date().toISOString(), fileId]);
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
        if (openFolders.value.has(folderId)) {
            openFolders.value.delete(folderId);
        } else {
            openFolders.value.add(folderId);
        }
    }

    function resetStore() {
        folders.value = [];
        notes.value = [];
        selectedFileId.value = null;
        selectedFolderId.value = null;
        openFolders.value = new Set();
    }

    async function loadStructure() {
        // With watcher, this is now mostly a no-op, but we can ensure a default file is selected.
        if (notes.value.length > 0 && !selectedFileId.value) {
            selectFile(notes.value[0].id);
        }
    }

    return {
        folders, notes, allItems, rootItems,
        selectedFileId, selectedFolderId, openFolders, selectedFile, selectedFileContent,
        getChildren, createFile, createFolder, deleteItem, renameItem, moveItem,
        selectFile, selectFolder, toggleFolder, updateFileContent,
        resetStore, loadStructure
    };
});