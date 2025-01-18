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
        await contentStore.loadContent(fileId)
        selectedFileId.value = fileId
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
        openFolders.value = new Set()
    }

    return {
        // State
        data,
        selectedFileId,
        openFolders,

        // Getters
        itemsArray,
        rootItems,
        selectedFile,

        // Operations
        getChildren,
        selectFile,
        createFile,
        createFolder,
        deleteItem,
        toggleFolder,

        // Structure management
        saveStructure,
        loadStructure,
        resetStore
    }
})