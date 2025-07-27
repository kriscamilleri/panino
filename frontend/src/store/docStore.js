// /frontend/src/store/docStore.js
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
        // This is now handled by structureStore's watcher, but we can ensure a default file is selected.
        if (rootItems.value.length > 0 && !selectedFileId.value) {
           const firstFile = rootItems.value.find(item => item.type === 'file');
           if (firstFile) {
               structureStore.selectFile(firstFile.id);
           }
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
        const query = `
            SELECT id, title as name, updated_at as displayedDate
            FROM notes
            ORDER BY updated_at DESC
            LIMIT ?
        `;
        try {
            const results = await syncStore.execute(query, [limit]);
            return results.rows?._array || [];
        } catch (error) {
            console.error('Failed to get recent documents:', error);
            return [];
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
        updateFileContent: structureStore.updateFileContent,

        // Actions from other stores
        exportJson: importExportStore.exportDataAsJsonString,
        exportZip: importExportStore.exportDataAsZip,
        importData: importExportStore.importData,

        updateStyle: markdownStore.updateStyle,
        getMarkdownIt: markdownStore.getMarkdownIt,
        updatePrintStyle: markdownStore.updatePrintStyle,
        getPrintMarkdownIt: markdownStore.getPrintMarkdownIt,
        getRecentDocuments
    };
});