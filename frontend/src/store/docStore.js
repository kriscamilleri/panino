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
    const styles = computed(() => markdownStore.styles)
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

    return {
        // State & Getters
        data,
        selectedFileId,
        selectedFolderId,
        openFolders,
        styles,
        itemsArray,
        rootItems,
        selectedFile,
        selectedFileContent,

        // File/Folder Operations
        getChildren: structureStore.getChildren,
        createFile: structureStore.createFile,
        createFolder: structureStore.createFolder,
        deleteItem: structureStore.deleteItem,
        renameItem,
        selectFolder,
        selectFile,

        // Update content
        updateFileContent: contentStore.updateContent,

        // Import/Export
        exportJson: importExportStore.exportData,
        importData: importExportStore.importData,

        // UI State Management
        toggleFolder: structureStore.toggleFolder,
        updateStyle: markdownStore.updateStyle,

        // Markdown
        getMarkdownIt: markdownStore.getMarkdownIt,

        // DB
        initCouchDB,
        destroyLocalDB,
        resetStore
    }
})
