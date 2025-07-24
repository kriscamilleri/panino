// /frontend/src/store/docStore.js
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useStructureStore } from './structureStore';
import { useMarkdownStore } from './markdownStore';
import { useSyncStore } from './syncStore';
import { useImportExportStore } from './importExportStore';
import { useAuthStore } from './authStore';

export const useDocStore = defineStore('docStore', () => {
  const structureStore = useStructureStore();
  const markdownStore = useMarkdownStore();
  const syncStore = useSyncStore();
  const importExportStore = useImportExportStore();

  const selectedFileId = computed(() => structureStore.selectedFileId);
  const selectedFolderId = computed(() => structureStore.selectedFolderId);
  const openFolders = computed(() => structureStore.openFolders);
  const styles = computed(() => markdownStore.styles);
  const printStyles = computed(() => markdownStore.printStyles);
  const rootItems = computed(() => structureStore.rootItems);
  const selectedFile = computed(() => structureStore.selectedFile);

  // Directly get content from the structure store, which now handles it.
  const selectedFileContent = computed(() => structureStore.selectedFileContent);

  async function loadInitialData() {
    // await markdownStore.loadStylesFromDB();
    await structureStore.loadStructure();
  }

  async function resetStore() {
    // This needs to be a coordinated reset.
    // 1. Disconnect and clear the database via syncStore
    await syncStore.resetDatabase();
    // 2. Reset the state of all data-holding stores
    structureStore.resetStore();
    markdownStore.resetStyles();
    markdownStore.resetPrintStyles();
    console.log('All stores have been reset.');
  }

  function getChildren(parentId) {
    return structureStore.getChildren(parentId);
  }

  async function getRecentDocuments(limit = 10) {
    // This query now hits the local SQLite DB via PowerSync
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
    // State & Getters
    selectedFileId,
    selectedFolderId,
    openFolders,
    styles,
    printStyles,
    rootItems,
    selectedFile,
    selectedFileContent,

    // Expose stores for direct access where needed
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