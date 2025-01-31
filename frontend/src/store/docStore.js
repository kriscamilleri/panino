// src/store/docStore.js
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStructureStore } from './structureStore'
import { useContentStore } from './contentStore'
import { useMarkdownStore } from './markdownStore'
import { useSyncStore } from './syncStore'
import { useImportExportStore } from './importExportStore'

export const useDocStore = defineStore('docStore', () => {
  // sub-stores
  const structureStore = useStructureStore()
  const contentStore = useContentStore()
  const markdownStore = useMarkdownStore()
  const syncStore = useSyncStore()
  const importExportStore = useImportExportStore()

  // Computed from structure
  const data = computed(() => structureStore.data)
  const selectedFileId = computed(() => structureStore.selectedFileId)
  const selectedFolderId = computed(() => structureStore.selectedFolderId)
  const openFolders = computed(() => structureStore.openFolders)

  // For rendering
  const styles = computed(() => markdownStore.styles)
  const printStyles = computed(() => markdownStore.printStyles)

  const itemsArray = computed(() => structureStore.itemsArray)
  const rootItems = computed(() => structureStore.rootItems)
  const selectedFile = computed(() => structureStore.selectedFile)
  const selectedFileContent = computed(() => contentStore.selectedFileContent)

  /**
   * The "big" initialization that occurs after login or signup:
   *  1. Initialize local DB (if not done)
   *  2. Attempt one-time pull from remote (throws if unreachable)
   *  3. Start live sync in background
   *  4. Load structure from local
   */
  async function initCouchDB() {
    await syncStore.initializeDB()          // 1) local DB
    await syncStore.oneTimePull()           // 2) single pull => throws if remote down
    syncStore.startLiveSync()               // 3) background sync
    await structureStore.loadStructure()    // 4) read docStoreData into memory
  }

  // For deleting local DB, resetting store, etc.
  async function destroyLocalDB(username) {
    await syncStore.destroyDB(username)
  }

  function resetStore() {
    structureStore.resetStore()
    contentStore.clearCache()
  }

  // Re-export structure ops
  function renameItem(itemId, newName) {
    return structureStore.renameItem(itemId, newName)
  }
  function selectFolder(folderId) {
    structureStore.selectFolder(folderId)
  }
  function selectFile(fileId) {
    structureStore.selectFile(fileId)
  }

  // For preview styling
  function updateStyle(key, newVal) {
    markdownStore.updateStyle(key, newVal)
  }
  function getMarkdownIt() {
    return markdownStore.getMarkdownIt()
  }

  // For print styling
  function updatePrintStyle(key, newVal) {
    markdownStore.updatePrintStyle(key, newVal)
  }
  function getPrintMarkdownIt() {
    return markdownStore.getPrintMarkdownIt()
  }

  return {
    data,
    selectedFileId,
    selectedFolderId,
    openFolders,
    styles,
    printStyles,
    itemsArray,
    rootItems,
    selectedFile,
    selectedFileContent,

    getChildren: structureStore.getChildren,
    createFile: structureStore.createFile,
    createFolder: structureStore.createFolder,
    deleteItem: structureStore.deleteItem,
    renameItem,
    selectFolder,
    selectFile,
    toggleFolder: structureStore.toggleFolder,
    updateFileContent: contentStore.updateContent,

    exportJson: importExportStore.exportDataAsJsonString,
    exportZip: importExportStore.exportDataAsZip,
    importData: importExportStore.importData,

    updateStyle,
    getMarkdownIt,
    updatePrintStyle,
    getPrintMarkdownIt,

    // The key "fix": do a one-time pull, then start live sync
    initCouchDB,
    destroyLocalDB,
    resetStore
  }
})
