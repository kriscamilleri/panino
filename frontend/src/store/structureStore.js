// src/store/structureStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useContentStore } from './contentStore'
import { useSyncStore } from './syncStore'

const EMPTY_DATA = {
    structure: {
        'welcome': {
            id: 'welcome',
            type: 'file',
            name: 'Welcome.md',
            parentId: null,
            hash: Date.now(),
            tx: Date.now()
        }
    }
}

export const useStructureStore = defineStore('structureStore', () => {
    // Core state
    const data = ref({ ...EMPTY_DATA })
    const selectedFileId = ref('welcome')
    // NEW: track a selected folder separately
    const selectedFolderId = ref(null)
    const openFolders = ref(new Set())

    // Stores
    const contentStore = useContentStore()
    const syncStore = useSyncStore()

    // Getters
    const itemsArray = computed(() => Object.values(data.value.structure))

    const rootItems = computed(() => {
        const folders = itemsArray.value.filter(i => !i.parentId && i.type === 'folder')
        const files = itemsArray.value.filter(i => !i.parentId && i.type === 'file')
        return [...sortByName(folders), ...sortByName(files)]
    })

    // If a file is selected, fetch its record
    const selectedFile = computed(() => {
        if (!selectedFileId.value) return null
        return data.value.structure[selectedFileId.value] || null
    })

    // Helper functions
    function sortByName(items) {
        return items.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }

    function generateId() {
        return Math.random().toString(36).substring(2, 15)
    }

    function getChildren(parentId) {
        const folders = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'folder')
        const files = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'file')
        return [...sortByName(folders), ...sortByName(files)]
    }

    // Structure operations
    async function createFile(name, parentId = null) {
        const id = generateId()
        const newFile = {
            id,
            type: 'file',
            name,
            parentId,
            hash: Date.now(),
            tx: Date.now()
        }

        data.value = {
            ...data.value,
            structure: {
                ...data.value.structure,
                [id]: newFile
            }
        }

        await contentStore.initializeContent(id)
        await selectFile(id)

        if (parentId) {
            openFolders.value.add(parentId)
        }

        await saveStructure()
        return id
    }

    function createFolder(name, parentId = null) {
        const id = generateId()
        const newFolder = {
            id,
            type: 'folder',
            name,
            parentId,
            hash: Date.now(),
            tx: Date.now()
        }

        data.value = {
            ...data.value,
            structure: {
                ...data.value.structure,
                [id]: newFolder
            }
        }

        if (parentId) {
            openFolders.value.add(parentId)
        }
        saveStructure()
        return id
    }

    async function deleteItem(id) {
        if (!data.value.structure[id]) return

        if (data.value.structure[id].type === 'folder') {
            const children = getChildren(id)
            for (const child of children) {
                await deleteItem(child.id)
            }
            openFolders.value.delete(id)
            if (selectedFolderId.value === id) {
                selectedFolderId.value = null
            }
        }

        if (data.value.structure[id].type === 'file') {
            await contentStore.deleteContent(id)
            if (selectedFileId.value === id) {
                selectedFileId.value = null
            }
        }

        const newStructure = { ...data.value.structure }
        delete newStructure[id]
        data.value = {
            ...data.value,
            structure: newStructure
        }
        await saveStructure()
    }

    async function selectFile(fileId) {
        // When selecting a file, unselect any folder
        selectedFolderId.value = null

        await contentStore.loadContent(fileId)
        selectedFileId.value = fileId
    }

    // NEW: selectFolder
    function selectFolder(folderId) {
        // Unselect any file
        selectedFileId.value = null
        selectedFolderId.value = folderId
    }

    // NEW: rename operation
    async function renameItem(itemId, newName) {
        if (!data.value.structure[itemId]) return
        const item = data.value.structure[itemId]

        item.name = newName
        item.tx = Date.now()
        item.hash = Date.now()

        data.value = {
            ...data.value,
            structure: {
                ...data.value.structure,
                [itemId]: item
            }
        }
        await saveStructure()
    }

    // Folder state management
    function toggleFolder(folderId) {
        if (openFolders.value.has(folderId)) {
            openFolders.value.delete(folderId)
        } else {
            openFolders.value.add(folderId)
        }
    }

    // Structure persistence
    async function saveStructure() {
        await syncStore.saveStructure(data.value.structure)
    }

    async function loadStructure() {
        const structure = await syncStore.loadStructure()
        if (structure) {
            data.value = {
                ...data.value,
                structure: JSON.parse(JSON.stringify(structure))
            }
        }
    }

    function resetStore() {
        data.value = { ...EMPTY_DATA }
        selectedFileId.value = 'welcome'
        selectedFolderId.value = null
        openFolders.value = new Set()
    }

    return {
        // State
        data,
        selectedFileId,
        selectedFolderId, // new
        openFolders,

        // Getters
        itemsArray,
        rootItems,
        selectedFile,

        // Operations
        getChildren,
        selectFile,
        selectFolder,
        createFile,
        createFolder,
        deleteItem,
        toggleFolder,
        renameItem,

        // Persistence
        saveStructure,
        loadStructure,
        resetStore
    }
})
