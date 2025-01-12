// src/store/docStore.js
import { defineStore } from 'pinia'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { ref, computed, watch } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from '@/store/authStore'

// Initialize with a default welcome document that users see when first accessing the app
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
    },
    ui: {
        openFolders: new Set()
    }
}

const WELCOME_CONTENT = {
    _id: 'file:welcome',
    type: 'content',
    text: '# Welcome to Markdown Editor\n\nStart by importing your data or creating new files.',
    properties: '\n',
    discussions: {},
    comments: {},
    hash: Date.now(),
    tx: Date.now()
}

export const useDocStore = defineStore('docStore', () => {
    // Core state management
    const data = ref({ ...EMPTY_DATA })
    const selectedFileId = ref('welcome')
    const openFolders = ref(new Set())
    const contentCache = ref(new Map()) // Cache for file contents

    // Default styles for markdown rendering
    const styles = ref({
        h1: 'text-3xl font-bold mt-4 mb-2 block',
        h2: 'text-2xl font-semibold mt-3 mb-2 block',
        h3: 'text-xl font-semibold mt-2 mb-1 block',
        p: 'mb-2 leading-relaxed',
        ul: 'list-disc list-inside mb-2',
        ol: 'list-decimal list-inside mb-2',
        li: 'ml-5 mb-1',
        code: 'bg-gray-100 text-sm px-1 py-0.5 rounded',
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'text-blue-600 underline',
        img: 'max-w-full h-auto',
        table: 'border-collapse border border-gray-300 my-2',
        tr: '',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1',
        td: 'border border-gray-300 px-2 py-1',
    })

    // Database connection management
    let localDB = null
    let syncHandler = null  // Track sync handler for cleanup

    // ---------- Basic getters ----------
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

    const selectedFileContent = computed(() => {
        if (!selectedFile.value) return ''
        return contentCache.value.get(selectedFile.value.id)?.text || ''
    })

    // ---------- Helper functions ----------
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

    // ---------- Content Management ----------
    async function loadFileContent(fileId) {
        try {
            const doc = await localDB.get(`file:${fileId}`)
            contentCache.value.set(fileId, doc)
            return doc.text
        } catch (err) {
            console.error(`Error loading content for file ${fileId}:`, err)
            return ''
        }
    }

    async function saveFileContent(fileId, content) {
        try {
            let doc
            try {
                doc = await localDB.get(`file:${fileId}`)
            } catch (err) {
                if (err.status === 404) {
                    doc = {
                        _id: `file:${fileId}`,
                        type: 'content',
                        text: '',
                        properties: '\n',
                        discussions: {},
                        comments: {},
                    }
                } else {
                    throw err
                }
            }

            doc.text = content
            doc.lastModified = new Date().toISOString()
            const response = await localDB.put(doc)

            if (response.ok) {
                doc._rev = response.rev
                contentCache.value.set(fileId, doc)
            }
        } catch (err) {
            console.error(`Error saving content for file ${fileId}:`, err)
            throw err
        }
    }

    // ---------- CRUD Operations ----------
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

        // Update structure
        data.value = {
            ...data.value,
            structure: {
                ...data.value.structure,
                [id]: newFile
            }
        }

        // Create content document
        await saveFileContent(id, '')

        selectFile(id)
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
            // Delete content document
            try {
                const doc = await localDB.get(`file:${id}`)
                await localDB.remove(doc)
                contentCache.value.delete(id)
            } catch (err) {
                console.error(`Error deleting content for file ${id}:`, err)
            }

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
        if (fileId && !contentCache.value.has(fileId)) {
            await loadFileContent(fileId)
        }
        selectedFileId.value = fileId
    }

    async function updateFileContent(fileId, newText) {
        await saveFileContent(fileId, newText)
    }

    // ---------- Structure Management ----------
    async function saveStructure() {
        try {
            let doc
            try {
                doc = await localDB.get('docStoreData')
            } catch (err) {
                if (err.status === 404) {
                    doc = { _id: 'docStoreData' }
                } else {
                    throw err
                }
            }

            doc.structure = data.value.structure
            doc.lastModified = new Date().toISOString()
            await localDB.put(doc)
        } catch (err) {
            console.error('Error saving structure:', err)
            throw err
        }
    }

    async function loadStructure() {
        try {
            const doc = await localDB.get('docStoreData')
            if (doc && doc.structure) {
                data.value = {
                    ...data.value,
                    structure: JSON.parse(JSON.stringify(doc.structure))
                }
            }
        } catch (err) {
            if (err.status !== 404) {
                console.error('Error loading structure:', err)
            }
        }
    }

    // ---------- PouchDB Management ----------
    async function destroyLocalDB(username) {
        try {
            if (syncHandler) {
                syncHandler.cancel()
                syncHandler = null
            }

            if (localDB) {
                await localDB.close()
            }

            const dbName = `pn-markdown-notes-${username}`
            const db = new PouchDB(dbName)
            await db.destroy()
            console.log(`Successfully destroyed database: ${dbName}`)
        } catch (err) {
            console.error('Error destroying local DB:', err)
            throw err
        }
    }

    function initSync() {
        const authStore = useAuthStore()
        if (!authStore.isAuthenticated) {
            console.log('User not authenticated; skipping remote sync.')
            return
        }

        if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
        }

        const remoteCouch = `http://localhost:5984/${authStore.user.dbName}`

        syncHandler = localDB.sync(remoteCouch, {
            live: true,
            retry: true,
            batch_size: 10,
            back_off_function: function (delay) {
                if (delay === 0) {
                    return 1000
                }
                return delay * 1.5
            },
            fetch: (url, opts) => {
                return fetch(url, {
                    ...opts,
                    credentials: 'include'
                })
            }
        })
            .on('change', async info => {
                console.log('Sync change:', info)
                if (info.direction === 'pull' && info.change.docs.length > 0) {
                    // Handle structure updates
                    const structureDoc = info.change.docs.find(doc => doc._id === 'docStoreData')
                    if (structureDoc) {
                        await loadStructure()
                    }

                    // Handle content updates
                    const contentDocs = info.change.docs.filter(doc => doc._id.startsWith('file:'))
                    for (const doc of contentDocs) {
                        const fileId = doc._id.replace('file:', '')
                        contentCache.value.set(fileId, doc)
                    }
                }
            })
            .on('paused', err => {
                if (err) {
                    console.error('Sync paused with error:', err)
                }
            })
            .on('active', () => {
                console.log('Sync active')
            })
            .on('denied', err => {
                console.error('Sync denied:', err)
            })
            .on('error', err => {
                console.error('Sync error:', err)
                setTimeout(() => {
                    if (syncHandler) {
                        console.log('Attempting to restart sync after error...')
                        initSync()
                    }
                }, 5000)
            })
    }

    async function initCouchDB() {
        const authStore = useAuthStore()

        if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
        }

        if (localDB) {
            await localDB.close()
            localDB = null
        }

        const dbName = authStore.isAuthenticated
            ? `pn-markdown-notes-${authStore.user.name}`
            : 'pn-markdown-notes-guest'

        localDB = new PouchDB(dbName, {
            auto_compaction: true,
        })

        authStore.registerDatabase(dbName)

        // Initialize with welcome document if empty
        try {
            await localDB.get('docStoreData')
        } catch (err) {
            if (err.status === 404) {
                await localDB.put({
                    _id: 'docStoreData',
                    structure: EMPTY_DATA.structure,
                    lastModified: new Date().toISOString()
                })
                await localDB.put(WELCOME_CONTENT)
            }
        }

        // Load structure and selected file content
        await loadStructure()
        if (selectedFileId.value) {
            await loadFileContent(selectedFileId.value)
        }

        if (authStore.isAuthenticated) {
            initSync()
        }
    }

    // ---------- Import/Export ----------
    async function exportJson() {
        // Export in the old format for backward compatibility
        const exportData = {}

        // Export structure items
        for (const [id, item] of Object.entries(data.value.structure)) {
            exportData[id] = item

            // For files, also export their content in the old format
            if (item.type === 'file') {
                try {
                    const content = await localDB.get(`file:${id}`)
                    exportData[`${id}/content`] = {
                        id: `${id}/content`,
                        type: 'content',
                        text: content.text,
                        properties: content.properties || '\n',
                        discussions: content.discussions || {},
                        comments: content.comments || {},
                        hash: content.hash || Date.now(),
                        tx: content.tx || Date.now()
                    }
                } catch (err) {
                    console.error(`Error exporting content for file ${id}:`, err)
                }
            }
        }

        return JSON.stringify(exportData, null, 2)
    }

    async function importData(newData) {
        try {
            if (typeof newData !== 'object' || newData === null) {
                throw new Error('Invalid data structure')
            }

            const validatedStructure = {}
            const contentPromises = []

            // First pass: validate and collect structure items
            for (const [key, item] of Object.entries(newData)) {
                if (!item || typeof item !== 'object') {
                    throw new Error(`Invalid item for key ${key}`)
                }
                if (!item.id || !item.type) {
                    throw new Error(`Missing id or type for ${key}`)
                }

                // Handle structure items (files and folders)
                if (item.type === 'file' || item.type === 'folder') {
                    if (!item.name) {
                        throw new Error(`${item.type} ${item.id} missing name`)
                    }
                    validatedStructure[item.id] = {
                        ...item,
                        hash: item.hash || Date.now(),
                        tx: item.tx || Date.now()
                    }

                    // Look for corresponding content
                    if (item.type === 'file') {
                        const contentKey = `${item.id}/content`
                        const contentItem = newData[contentKey]

                        if (contentItem && contentItem.type === 'content') {
                            contentPromises.push(
                                saveFileContent(item.id, contentItem.text || '')
                            )
                        } else {
                            // If no content found, create empty content
                            contentPromises.push(
                                saveFileContent(item.id, '')
                            )
                        }
                    }
                }
            }

            // Update structure first
            data.value = {
                ...data.value,
                structure: validatedStructure
            }
            await saveStructure()

            // Wait for all content to be saved
            await Promise.all(contentPromises)

            // Reset UI state
            selectedFileId.value = null
            openFolders.value = new Set()

            // Select the first file if available
            const firstFile = Object.values(validatedStructure).find(item => item.type === 'file')
            if (firstFile) {
                await selectFile(firstFile.id)
            }

            console.log('Import completed successfully')
        } catch (error) {
            console.error('Import failed:', error)
            throw error
        }
    }
    // ---------- UI State Management ----------
    function toggleFolder(folderId) {
        if (openFolders.value.has(folderId)) {
            openFolders.value.delete(folderId)
        } else {
            openFolders.value.add(folderId)
        }
    }

    function updateStyle(key, newClass) {
        if (styles.value[key] !== undefined) {
            styles.value[key] = newClass
        }
    }

    // ---------- Markdown Rendering ----------
    function getMarkdownIt() {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true
        }).use(markdownItTaskLists)

        // Use a div for paragraphs, but only when not in a list
        md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
            const inList = tokens.some((token, i) => {
                if (i < idx) {
                    return token.type === 'list_item_open' && !token.hidden
                }
                return false
            })

            return inList
                ? `<span class="${styles.value.p}">`
                : `<div class="${styles.value.p}">`
        }

        md.renderer.rules.paragraph_close = (tokens, idx, options, env, self) => {
            const inList = tokens.some((token, i) => {
                if (i < idx) {
                    return token.type === 'list_item_open' && !token.hidden
                }
                return false
            })

            return inList ? '</span>' : '</div>'
        }

        md.renderer.rules.heading_open = (tokens, idx) => {
            const tag = tokens[idx].tag
            return `<${tag} class="${styles.value[tag]}">`
        }

        md.renderer.rules.bullet_list_open = () => `<ul class="${styles.value.ul}">`
        md.renderer.rules.ordered_list_open = () => `<ol class="${styles.value.ol}">`

        md.renderer.rules.list_item_open = (tokens, idx) => {
            // Special handling for task lists
            if (tokens[idx].map && tokens[idx].map.length > 0) {
                if (tokens[idx + 2]?.type === 'task_list_item_open') {
                    const checked = tokens[idx + 2].checked
                    return `<li class="${styles.value.li}"><input type="checkbox" ${checked ? 'checked' : ''} disabled> `
                }
            }
            return `<li class="${styles.value.li}">`
        }

        md.renderer.rules.code_inline = (tokens, idx) =>
            `<code class="${styles.value.code}">${tokens[idx].content}</code>`

        md.renderer.rules.blockquote_open = () =>
            `<blockquote class="${styles.value.blockquote}">`

        md.renderer.rules.hr = () => `<hr class="${styles.value.hr}">`

        md.renderer.rules.em_open = () => `<em class="${styles.value.em}">`
        md.renderer.rules.strong_open = () => `<strong class="${styles.value.strong}">`

        md.renderer.rules.link_open = (tokens, idx) => {
            const href = tokens[idx].attrGet('href')
            return `<a href="${href}" class="${styles.value.a}" target="_blank" rel="noopener">`
        }

        md.renderer.rules.image = (tokens, idx) => {
            const token = tokens[idx]
            const src = token.attrGet('src')
            const alt = token.content
            const title = token.attrGet('title')
            return `<img src="${src}" alt="${alt}" title="${title || ''}" class="${styles.value.img}">`
        }

        md.renderer.rules.table_open = () => `<table class="${styles.value.table}">`
        md.renderer.rules.th_open = () => `<th class="${styles.value.th}">`
        md.renderer.rules.td_open = () => `<td class="${styles.value.td}">`

        return md
    }

    function resetStore() {
        data.value = { ...EMPTY_DATA }
        selectedFileId.value = 'welcome'
        openFolders.value = new Set()
        contentCache.value.clear()
    }

    // Return all the functions and reactive data that should be accessible from outside the store
    return {
        // State
        data,
        selectedFileId,
        openFolders,
        styles,

        // Getters
        itemsArray,
        rootItems,
        selectedFile,
        selectedFileContent,

        // File/Folder Operations
        getChildren,
        selectFile,
        createFile,
        createFolder,
        deleteItem,
        updateFileContent,

        // Import/Export
        exportJson,
        importData,

        // UI State Management
        toggleFolder,
        updateStyle,

        // Markdown Rendering
        getMarkdownIt,

        // Database Management
        initCouchDB,
        destroyLocalDB,
        resetStore
    }
})