// /frontend/src/store/docStore.js
import { ref } from 'vue'
import { defineStore } from 'pinia';
import { storeToRefs } from 'pinia';
import { useStructureStore } from './structureStore';
import { useMarkdownStore } from './markdownStore';
import { useSyncStore } from './syncStore';
import { useImportExportStore } from './importExportStore';

export const useDocStore = defineStore('docStore', () => {
    const structureStore = useStructureStore();
    const markdownStore = useMarkdownStore();
    const syncStore = useSyncStore();
    const importExportStore = useImportExportStore();
    const isSaving = ref(false)

    // Pull refs out of the other stores WITHOUT wrapping them in computed again
    const {
        selectedFileId,
        selectedFolderId,
        openFolders,
        rootItems,
        selectedFile,
        selectedFileContent
    } = storeToRefs(structureStore);

    const { styles, printStyles } = storeToRefs(markdownStore);

    async function loadInitialData() {
        // This is now mainly for selecting a default file after the initial sync
        await structureStore.loadRootItems(); // Ensure root items are loaded
        if (structureStore.rootItems.length > 0 && !structureStore.selectedFileId) {
            const firstFile = structureStore.rootItems.find(item => item.type === 'file');
            if (firstFile) {
                structureStore.selectFile(firstFile.id);
            }
        }
    }
    async function refreshData() {
        console.log('[DocStore] Refreshing data after sync.');
        await structureStore.loadRootItems();
        if (structureStore.selectedFileId) {
            // This is the key change: explicitly re-fetch the current file's data
            await structureStore.reFetchSelectedFile();
        }
    }

    async function resetStore() {
        await syncStore.resetDatabase();
        structureStore.resetStore();
        markdownStore.resetStyles();
        markdownStore.resetPrintStyles();
        console.log('All stores have been reset.');
    }

    async function getRecentDocuments(limit = 10) {
        const query = `SELECT id, title as name, updated_at as displayedDate FROM notes ORDER BY updated_at DESC LIMIT ?`;
        try {
            // CORRECTED: The result is the array itself
            const results = await syncStore.execute(query, [limit]);
            return results || [];
        } catch (error) {
            console.error('Failed to get recent documents:', error);
            return [];
        }
    }

    async function updateFileContent(fileId, newContent) {
        isSaving.value = true; // <--- Set to true
        try {
            await syncStore.db.value.exec('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [newContent, new Date().toISOString(), fileId]);
            if (selectedFile.value?.id === fileId) {
                selectedFile.value.content = newContent; // Optimistic update
            }
        } finally {
             // Add a small delay so the user can actually see the "Saving" state flicker
            setTimeout(() => { isSaving.value = false; }, 300);
        }
    }

    return {
        // State & Getters (forwarded refs)
        selectedFileId,
        selectedFolderId,
        openFolders,
        styles,
        printStyles,
        rootItems,
        selectedFile,
        selectedFileContent,

        // Expose stores if you still need direct access
        structureStore,
        syncStore,
        markdownStore,

        // Actions from structureStore
        loadInitialData,
        resetStore,
        loadRootItems: structureStore.loadRootItems,
        getChildren: structureStore.getChildren,
        createFile: structureStore.createFile,
        createFolder: structureStore.createFolder,
        deleteItem: structureStore.deleteItem,
        renameItem: structureStore.renameItem,
        moveItem: structureStore.moveItem,
        selectFile: structureStore.selectFile,
        selectFolder: structureStore.selectFolder,
        toggleFolder: structureStore.toggleFolder,
        updateFileContent: updateFileContent, // structureStore.updateFileContent,

        // Actions from other stores
        exportJson: importExportStore.exportDataAsJsonString,
        exportZip: importExportStore.exportDataAsZip,
        importData: importExportStore.importData,
        exportStackEditJson: importExportStore.exportDataAsStackEditJsonString,
        importStackEditData: importExportStore.importStackEditData,

        updateStyle: markdownStore.updateStyle,
        getMarkdownIt: markdownStore.getMarkdownIt,
        updatePrintStyle: markdownStore.updatePrintStyle,
        getPrintMarkdownIt: markdownStore.getPrintMarkdownIt,
        getRecentDocuments,
        refreshData, // Expose the new function
        isSaving,
    };
});
