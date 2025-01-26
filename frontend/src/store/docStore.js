// src/store/docStore.js
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStructureStore } from './structureStore'
import { useContentStore } from './contentStore'
import { useMarkdownStore } from './markdownStore'
import { useSyncStore } from './syncStore'
import { useImportExportStore } from './importExportStore'

export const useDocStore = defineStore('docStore', () => {
    // Initialize all stores
    const structureStore = useStructureStore()
    const contentStore = useContentStore()
    const markdownStore = useMarkdownStore()
    const syncStore = useSyncStore()
    const importExportStore = useImportExportStore()

    // Expose necessary getters
    const data = computed(() => structureStore.data)
    const selectedFileId = computed(() => structureStore.selectedFileId)
    const selectedFolderId = computed(() => structureStore.selectedFolderId)
    const openFolders = computed(() => structureStore.openFolders)
    const styles = computed(() => markdownStore.styles) // preview styles
    const printStyles = computed(() => markdownStore.printStyles) // print styles
    const itemsArray = computed(() => structureStore.itemsArray)
    const rootItems = computed(() => structureStore.rootItems)
    const selectedFile = computed(() => structureStore.selectedFile)
    const selectedFileContent = computed(() => contentStore.selectedFileContent)

    // Initialize CouchDB and sync
    async function initCouchDB() {
        await syncStore.initializeDB()
        await structureStore.loadStructure()
        if (selectedFileId.value) {
            await contentStore.loadContent(selectedFileId.value)
        }
    }

    async function destroyLocalDB(username) {
        await syncStore.destroyDB(username)
    }

    function resetStore() {
        structureStore.resetStore()
        contentStore.clearCache()
    }

    // Re-export structure operations
    function renameItem(itemId, newName) {
        return structureStore.renameItem(itemId, newName)
    }

    function selectFolder(folderId) {
        structureStore.selectFolder(folderId)
    }
    function selectFile(fileId) {
        structureStore.selectFile(fileId)
    }

    //
    // For preview styling
    //
    function updateStyle(key, newVal) {
        markdownStore.updateStyle(key, newVal)
    }
    function getMarkdownIt() {
        return markdownStore.getMarkdownIt()
    }

    //
    // For print styling
    //
    function updatePrintStyle(key, newVal) {
        markdownStore.updatePrintStyle(key, newVal)
    }
    function getPrintMarkdownIt() {
        return markdownStore.getPrintMarkdownIt()
    }

    return {
        // State & getters
        data,
        selectedFileId,
        selectedFolderId,
        openFolders,
        styles,
        printStyles, // separate print styles
        itemsArray,
        rootItems,
        selectedFile,
        selectedFileContent,

        // Structure methods
        getChildren: structureStore.getChildren,
        createFile: structureStore.createFile,
        createFolder: structureStore.createFolder,
        deleteItem: structureStore.deleteItem,
        renameItem,
        selectFolder,
        selectFile,
        toggleFolder: structureStore.toggleFolder,

        // Content updates
        updateFileContent: contentStore.updateContent,

        // Import/Export
        exportJson: importExportStore.exportData,
        importData: importExportStore.importData,

        // Style updates (preview)
        updateStyle,
        getMarkdownIt,

        // Print style updates
        updatePrintStyle,
        getPrintMarkdownIt,

        // DB operations
        initCouchDB,
        destroyLocalDB,
        resetStore,
    }
})
