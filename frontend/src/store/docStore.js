// src/store/docStore.js
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStructureStore } from './structureStore'
import { useContentStore } from './contentStore'
import { useMarkdownStore } from './markdownStore'
import { useSyncStore } from './syncStore'
import { useImportExportStore } from './importExportStore'

export const useDocStore = defineStore('docStore', () => {
  const structureStore = useStructureStore()
  const contentStore = useContentStore()
  const markdownStore = useMarkdownStore()
  const syncStore = useSyncStore()
  const importExportStore = useImportExportStore()

  const data = computed(() => structureStore.data)
  const selectedFileId = computed(() => structureStore.selectedFileId)
  const selectedFolderId = computed(() => structureStore.selectedFolderId)
  const openFolders = computed(() => structureStore.openFolders)

  const styles = computed(() => markdownStore.styles)
  const printStyles = computed(() => markdownStore.printStyles)

  const itemsArray = computed(() => structureStore.itemsArray)
  const rootItems = computed(() => structureStore.rootItems)
  const selectedFile = computed(() => structureStore.selectedFile)
  const selectedFileContent = computed(() => contentStore.selectedFileContent)

  /**
   * Initialize CouchDB, do a one-time pull, and load structure.
   * (We no longer force live sync to be enabled here—user can enable it manually.)
   */
  async function initCouchDB() {
    await syncStore.initializeDB()
    await syncStore.oneTimePull()
    // Removed:
    // syncStore.setSyncEnabled(true)
    // syncStore.startLiveSync()
    await structureStore.loadStructure()
  }

  async function destroyLocalDB(username) {
    await syncStore.destroyDB(username)
  }

  function resetStore() {
    structureStore.resetStore()
    contentStore.clearCache()
  }

  function renameItem(itemId, newName) {
    return structureStore.renameItem(itemId, newName)
  }
  function selectFolder(folderId) {
    structureStore.selectFolder(folderId)
  }
  function selectFile(fileId) {
    structureStore.selectFile(fileId)
  }

  function updateStyle(key, newVal) {
    markdownStore.updateStyle(key, newVal)
  }
  function getMarkdownIt() {
    return markdownStore.getMarkdownIt()
  }

  function updatePrintStyle(key, newVal) {
    markdownStore.updatePrintStyle(key, newVal)
  }
  function getPrintMarkdownIt() {
    return markdownStore.getPrintMarkdownIt()
  }

  /**
   * Return up to `limit` most recently edited files,
   * based on each file's `lastModified`.
   */
  async function getRecentDocuments(limit = 10) {
    const fileDocs = await syncStore.allFileDocs()
    const items = []

    for (const row of fileDocs.rows) {
      const doc = row.doc
      if (doc && doc._id.startsWith('file:')) {
        const fileId = doc._id.substring(5)
        const structureItem = data.value.structure[fileId]
        if (structureItem) {
          const displayedDate = doc.lastModified || doc.createdTime || ''
          items.push({
            id: fileId,
            name: structureItem.name,
            displayedDate
          })
        }
      }
    }

    items.sort((a, b) => new Date(b.displayedDate) - new Date(a.displayedDate))
    return items.slice(0, limit)
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

    initCouchDB,
    destroyLocalDB,
    resetStore,

    getRecentDocuments
  }
})
