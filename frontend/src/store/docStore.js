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
    await structureStore.loadStructure();
  }

  async function resetStore() {
    await syncStore.resetDatabase();
    structureStore.resetStore();
    markdownStore.resetStyles();
    markdownStore.resetPrintStyles();
    console.log('All stores have been reset.');
  }

  function getChildren(parentId) {
    return structureStore.getChildren(parentId);
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

    // Actions
    loadInitialData,
    resetStore,
    getChildren,
    createFile: structureStore.createFile,
    createFolder: structureStore.createFolder,
    deleteItem: structureStore.deleteItem,
    renameItem: structureStore.renameItem,
    selectFile: structureStore.selectFile,
    selectFolder: structureStore.selectFolder,
    toggleFolder: structureStore.toggleFolder,
    updateFileContent: structureStore.updateFileContent,

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
