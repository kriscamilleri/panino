// src/store/structureStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useContentStore } from './contentStore'
import { useSyncStore } from './syncStore'
import { useAuthStore } from './authStore'

export const useStructureStore = defineStore('structureStore', () => {
    /* ──────────────────────────────
       ▸ state
    ────────────────────────────── */
    const data             = ref({ structure: {} })
    const selectedFileId   = ref(null)
    const selectedFolderId = ref(null)
    const openFolders      = ref(new Set())

    /* ──────────────────────────────
       ▸ other stores
    ────────────────────────────── */
    const contentStore = useContentStore()
    const syncStore    = useSyncStore()
    const authStore    = useAuthStore()

    /* ──────────────────────────────
       ▸ computed helpers
    ────────────────────────────── */
    const itemsArray = computed(() => Object.values(data.value.structure))

    const rootItems = computed(() => {
        const folders = itemsArray.value.filter(i => !i.parentId && i.type === 'folder')
        const files   = itemsArray.value.filter(i => !i.parentId && i.type === 'file')
        return [...folders.sort(sortByName), ...files.sort(sortByName)]
    })

    const selectedFile = computed(() => {
        if (!selectedFileId.value) return null
        return data.value.structure[selectedFileId.value] || null
    })

    /* ──────────────────────────────
       ▸ utility helpers
    ────────────────────────────── */
    function sortByName(a, b) {
        return (a.name || '').localeCompare(b.name || '')
    }

    function generateId() {
        return Math.random().toString(36).substring(2, 15)
    }

    /** Return direct children (folders first, then files) */
    function getChildren(parentId) {
        const folders = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'folder')
        const files   = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'file')
        return [...folders.sort(sortByName), ...files.sort(sortByName)]
    }

    /** True if an item with the same name already exists in the destination folder */
    function hasDuplicateName(name, parentId, excludeId = null) {
        const norm = (name || '').trim().toLowerCase()
        return itemsArray.value.some(i =>
            i.id !== excludeId &&
            (i.parentId || null) === (parentId || null) &&
            (i.name || '').trim().toLowerCase() === norm
        )
    }

    /** Protect against moving a folder into its own descendant */
    function isDescendant(ancestorId, potentialChildId) {
        let cur = potentialChildId
        while (cur) {
            if (cur === ancestorId) return true
            const n = data.value.structure[cur]
            cur = n ? n.parentId : null
        }
        return false
    }

    /* ──────────────────────────────
       ▸ create
    ────────────────────────────── */
    async function createFile(name, parentId = null) {
        if (hasDuplicateName(name, parentId)) {
            alert(`A document named “${name}” already exists in this folder.`)
            return null
        }

        const id = generateId()
        data.value.structure[id] = {
            id, type: 'file', name, parentId,
            hash: Date.now(), tx: Date.now()
        }

        await contentStore.initializeContent(id)
        await selectFile(id)
        if (parentId) openFolders.value.add(parentId)
        await saveStructure()
        return id
    }

    function createFolder(name, parentId = null) {
        if (hasDuplicateName(name, parentId)) {
            alert(`A folder named “${name}” already exists in this folder.`)
            return null
        }

        const id = generateId()
        data.value.structure[id] = {
            id, type: 'folder', name, parentId,
            hash: Date.now(), tx: Date.now()
        }

        if (parentId) openFolders.value.add(parentId)
        saveStructure()
        return id
    }

    /* ──────────────────────────────
       ▸ delete
    ────────────────────────────── */
    async function deleteItem(id) {
        const node = data.value.structure[id]
        if (!node) return

        if (node.type === 'folder') {
            for (const child of getChildren(id)) await deleteItem(child.id)
            openFolders.value.delete(id)
            if (selectedFolderId.value === id) selectedFolderId.value = null
        }

        if (node.type === 'file') {
            await contentStore.deleteContent(id)
            if (selectedFileId.value === id) selectedFileId.value = null
        }

        delete data.value.structure[id]
        await saveStructure()
    }

    /* ──────────────────────────────
       ▸ select
    ────────────────────────────── */
    async function selectFile(fileId) {
        selectedFolderId.value = null
        await contentStore.loadContent(fileId)
        selectedFileId.value = fileId
    }

    function selectFolder(folderId) {
        selectedFileId.value   = null
        selectedFolderId.value = folderId
    }

    /* ──────────────────────────────
       ▸ rename
    ────────────────────────────── */
    async function renameItem(itemId, newName) {
        const item = data.value.structure[itemId]
        if (!item) return

        if (hasDuplicateName(newName, item.parentId, itemId)) {
            alert(`An item named “${newName}” already exists in this folder.`)
            return
        }

        item.name = newName
        item.tx   = Date.now()
        item.hash = Date.now()
        await saveStructure()
    }

    /* ──────────────────────────────
       ▸ move (used by drag-and-drop)
    ────────────────────────────── */
    async function moveItem(itemId, newParentId = null) {
        const item = data.value.structure[itemId]
        if (!item) return false

        // destination must be null (root) or an existing folder
        if (newParentId &&
            (!data.value.structure[newParentId] || data.value.structure[newParentId].type !== 'folder')) {
            return false
        }

        // no change
        if ((item.parentId || null) === (newParentId || null)) return false

        // prevent folder→descendant
        if (item.type === 'folder' && newParentId && isDescendant(itemId, newParentId)) {
            alert('Cannot move a folder into one of its own sub-folders.')
            return false
        }

        // duplicate-name guard
        if (hasDuplicateName(item.name, newParentId, itemId)) {
            alert(`An item named “${item.name}” already exists in the destination.`)
            return false
        }

        item.parentId = newParentId
        item.tx       = Date.now()
        item.hash     = Date.now()

        if (newParentId) openFolders.value.add(newParentId)
        await saveStructure()
        return true
    }

    /* ──────────────────────────────
       ▸ folder UI helpers
    ────────────────────────────── */
    function toggleFolder(folderId) {
        openFolders.value.has(folderId)
            ? openFolders.value.delete(folderId)
            : openFolders.value.add(folderId)
    }

    /* ──────────────────────────────
       ▸ persistence
    ────────────────────────────── */
    async function saveStructure() {
        await syncStore.saveStructure(data.value.structure)
    }

    async function loadStructure() {
        const structure = await syncStore.loadStructure()
        if (!structure) return

        data.value.structure = JSON.parse(JSON.stringify(structure))

        // choose initial file
        const username  = authStore.user?.name
        const welcomeId = username && username !== 'guest' ? `welcome-${username}` : 'welcome'
        if (structure[welcomeId]) {
            selectedFileId.value = welcomeId
        } else if (structure['welcome']) {
            selectedFileId.value = 'welcome'
        } else {
            const firstFile = Object.values(structure).find(i => i.type === 'file')
            if (firstFile) selectedFileId.value = firstFile.id
        }
    }

    function resetStore() {
        data.value             = { structure: {} }
        selectedFileId.value   = null
        selectedFolderId.value = null
        openFolders.value      = new Set()
    }

    /* ──────────────────────────────
       ▸ exposed API
    ────────────────────────────── */
    return {
        // state
        data,
        selectedFileId,
        selectedFolderId,
        openFolders,

        // getters
        itemsArray,
        rootItems,
        selectedFile,

        // operations
        getChildren,
        createFile,
        createFolder,
        deleteItem,
        selectFile,
        selectFolder,
        renameItem,
        moveItem,
        toggleFolder,

        // persistence
        saveStructure,
        loadStructure,
        resetStore
    }
})
