// src/store/docStore.js
import { defineStore } from 'pinia'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { ref, computed, watch } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from '@/store/authStore'

// Initialize with a default welcome document that users see when first accessing the app
const EMPTY_DATA = {
    'welcome': {
        id: 'welcome',
        type: 'file',
        name: 'Welcome.md',
        parentId: null,
        hash: Date.now(),
        tx: Date.now()
    },
    'welcome/content': {
        id: 'welcome/content',
        type: 'content',
        text: '# Welcome to Markdown Editor\n\nStart by importing your data or creating new files.',
        properties: '\n',
        discussions: {},
        comments: {},
        hash: Date.now(),
        tx: Date.now()
    }
}

export const useDocStore = defineStore('docStore', () => {
    // Core state management
    const data = ref({ ...EMPTY_DATA })
    const selectedFileId = ref('welcome')
    const openFolders = ref(new Set())

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
    const itemsArray = computed(() => Object.values(data.value))

    const rootItems = computed(() => {
        const folders = itemsArray.value.filter(i => !i.parentId && i.type === 'folder')
        const files = itemsArray.value.filter(i => !i.parentId && i.type === 'file')
        return [...sortByName(folders), ...sortByName(files)]
    })

    const selectedFile = computed(() => {
        if (!selectedFileId.value) return null
        return data.value[selectedFileId.value] || null
    })

    const selectedFileContent = computed(() => {
        if (!selectedFile.value) return ''
        const contentKey = `${selectedFile.value.id}/content`
        return data.value[contentKey]?.text || ''
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

    // ---------- CRUD Operations ----------
    function createFile(name, parentId = null) {
        const id = generateId()
        const newFile = {
            id,
            type: 'file',
            name,
            parentId,
            hash: Date.now(),
            tx: Date.now()
        }
        const contentId = `${id}/content`
        const content = {
            id: contentId,
            type: 'content',
            text: '',
            properties: '\n',
            discussions: {},
            comments: {},
            hash: Date.now(),
            tx: Date.now()
        }

        data.value = {
            ...data.value,
            [id]: newFile,
            [contentId]: content
        }
        selectFile(id)
        if (parentId) {
            openFolders.value.add(parentId)
        }
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
            [id]: newFolder
        }
        if (parentId) {
            openFolders.value.add(parentId)
        }
        return id
    }

    function deleteItem(id) {
        if (!data.value[id]) return

        if (data.value[id].type === 'folder') {
            const children = getChildren(id)
            children.forEach(child => deleteItem(child.id))
            openFolders.value.delete(id)
        }

        if (data.value[id].type === 'file') {
            const contentKey = `${id}/content`
            delete data.value[contentKey]
            if (selectedFileId.value === id) {
                selectedFileId.value = null
            }
        }

        delete data.value[id]
        data.value = { ...data.value }  // Trigger reactivity
    }

    function selectFile(fileId) {
        selectedFileId.value = fileId
    }

    function updateFileContent(fileId, newText) {
        const contentKey = `${fileId}/content`
        if (data.value[contentKey]) {
            data.value = {
                ...data.value,
                [contentKey]: {
                    ...data.value[contentKey],
                    text: newText,
                    lastModified: new Date().toISOString()
                }
            }
        }
    }

    // ---------- PouchDB Management ----------
    async function destroyLocalDB(username) {
        try {
            // Cancel any existing sync
            if (syncHandler) {
                syncHandler.cancel()
                syncHandler = null
            }

            // Close current DB connection
            if (localDB) {
                await localDB.close()
            }

            // Destroy the database
            const dbName = `pn-markdown-notes-${username}`
            const db = new PouchDB(dbName)
            await db.destroy()
            console.log(`Successfully destroyed database: ${dbName}`)
        } catch (err) {
            console.error('Error destroying local DB:', err)
            throw err
        }
    }

    async function loadFromPouchDB() {
        try {
            const doc = await localDB.get('docStoreData')
            if (doc && doc.data) {
                // Deep clone the data to prevent reference issues
                data.value = JSON.parse(JSON.stringify(doc.data))
            }
        } catch (err) {
            if (err.status !== 404) {
                console.error('Error loading from PouchDB:', err)
            }
        }
    }

    async function saveToPouchDB() {
        const retries = 3
        let attempt = 0

        while (attempt < retries) {
            try {
                const existing = await localDB.get('docStoreData')
                await localDB.put({
                    ...existing,
                    data: JSON.parse(JSON.stringify(data.value)),  // Deep clone to prevent conflicts
                    lastModified: new Date().toISOString()
                })
                break
            } catch (err) {
                if (err.status === 404) {
                    try {
                        await localDB.put({
                            _id: 'docStoreData',
                            data: JSON.parse(JSON.stringify(data.value)),
                            lastModified: new Date().toISOString()
                        })
                        break
                    } catch (innerErr) {
                        if (innerErr.name === 'conflict' && attempt < retries - 1) {
                            console.warn(`Conflict on attempt ${attempt + 1}, retrying...`)
                            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)))
                            attempt++
                            continue
                        }
                        throw innerErr
                    }
                }
                if (err.name === 'conflict' && attempt < retries - 1) {
                    console.warn(`Conflict on attempt ${attempt + 1}, retrying...`)
                    await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)))
                    attempt++
                    continue
                }
                throw err
            }
        }
    }

    function initSync() {
        const authStore = useAuthStore()
        if (!authStore.isAuthenticated) {
            console.log('User not authenticated; skipping remote sync.')
            return
        }

        // Cancel any existing sync
        if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
        }

        const remoteCouch = `http://localhost:5984/${authStore.user.dbName}`

        syncHandler = localDB.sync(remoteCouch, {
            live: true,
            retry: true,
            batch_size: 10,  // Reduce batch size to minimize conflicts
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
            .on('change', info => {
                console.log('Sync change:', info)
                if (info.direction === 'pull' && info.change.docs.length > 0) {
                    loadFromPouchDB()  // Reload data on remote changes
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
                // Attempt to reconnect after error
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

        // 1) Cancel any existing sync
        if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
        }

        // 2) Close any existing DB connection
        if (localDB) {
            await localDB.close()
            localDB = null
        }

        // 3) Choose and create new DB
        const dbName = authStore.isAuthenticated
            ? `pn-markdown-notes-${authStore.user.name}`
            : 'pn-markdown-notes-guest'

        localDB = new PouchDB(dbName, {
            auto_compaction: true,  // Enable automatic compaction
        })

        // Register this database with authStore for tracking
        authStore.registerDatabase(dbName)

        // 4) Load existing data
        await loadFromPouchDB()

        // 5) Set up data watching with debounce
        let saveTimeout
        watch(data, () => {
            clearTimeout(saveTimeout)
            saveTimeout = setTimeout(() => {
                saveToPouchDB()
            }, 1000)  // Debounce saves by 1 second
        }, { deep: true })

        // 6) Initialize sync if authenticated
        if (authStore.isAuthenticated) {
            initSync()
        }
    }

    // ---------- Import/Export ----------
    function exportJson() {
        return JSON.stringify(data.value, null, 2)
    }

    function importData(newData) {
        try {
            if (typeof newData !== 'object' || newData === null) {
                throw new Error('Invalid data structure')
            }
            const validatedData = {}
            const files = new Set()
            const contentFiles = new Set()

            for (const [key, item] of Object.entries(newData)) {
                if (!item || typeof item !== 'object') {
                    throw new Error(`Invalid item for key ${key}`)
                }
                if (!item.id || !item.type) {
                    throw new Error(`Missing id or type for ${key}`)
                }
                switch (item.type) {
                    case 'file':
                        if (!item.name) {
                            throw new Error(`File ${item.id} missing name`)
                        }
                        files.add(item.id)
                        validatedData[key] = item
                        break
                    case 'content':
                        if (typeof item.text === 'undefined') {
                            throw new Error(`Content ${item.id} missing text`)
                        }
                        contentFiles.add(item.id.split('/')[0])
                        validatedData[key] = item
                        break
                    case 'folder':
                        if (!item.name) {
                            throw new Error(`Folder ${item.id} missing name`)
                        }
                        validatedData[key] = item
                        break
                    default:
                        validatedData[key] = item
                }
            }

            files.forEach(fileId => {
                if (!contentFiles.has(fileId)) {
                    console.warn(`Warning: File ${fileId} has no content`)
                }
            })

            data.value = validatedData
            selectedFileId.value = null
            openFolders.value = new Set()

            const firstFile = Object.values(validatedData).find(item => item.type === 'file')
            if (firstFile) {
                selectedFileId.value = firstFile.id
            }
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

        // Configure markdown renderer to apply our Tailwind CSS styles
        md.renderer.rules.paragraph_open = () => `<span class="${styles.value.p}">`
        md.renderer.rules.paragraph_close = () => '</span>'

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