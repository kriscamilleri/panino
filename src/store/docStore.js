// src/store/docStore.js
import { defineStore } from 'pinia'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { ref, computed } from 'vue'

// Initialize with empty data instead of importing
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
    // Initialize with empty data
    const data = ref(EMPTY_DATA)
    const selectedFileId = ref('welcome')
    const openFolders = ref(new Set())

    // Default Tailwind classes for each element
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

    const itemsArray = computed(() => Object.values(data.value))

    const rootItems = computed(() => {
        const folders = itemsArray.value.filter(i => !i.parentId && i.type === 'folder')
        const files = itemsArray.value.filter(i => !i.parentId && i.type === 'file')
        return [...sortByName(folders), ...sortByName(files)]
    })

    // Generate a unique ID
    function generateId() {
        return Math.random().toString(36).substring(2, 15)
    }

    // Create a new file
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

        // Create the file content
        const contentId = `${id}/content`
        const content = {
            id: contentId,
            type: 'content',
            text: '', // Empty initial content
            properties: '\n',
            discussions: {},
            comments: {},
            hash: Date.now(),
            tx: Date.now()
        }

        // Add both the file and its content to the store
        data.value = {
            ...data.value,
            [id]: newFile,
            [contentId]: content
        }

        // Select the newly created file
        selectFile(id)

        // If parent is a folder, ensure it's open
        if (parentId) {
            openFolders.value.add(parentId)
        }

        return id
    }

    // Create a new folder
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

        // Open the parent folder if it exists
        if (parentId) {
            openFolders.value.add(parentId)
        }

        return id
    }

    // Delete an item (file or folder)
    function deleteItem(id) {
        if (!data.value[id]) return

        // If it's a folder, recursively delete all children
        if (data.value[id].type === 'folder') {
            const children = getChildren(id)
            children.forEach(child => deleteItem(child.id))
            openFolders.value.delete(id)
        }

        // If it's a file, delete its content
        if (data.value[id].type === 'file') {
            const contentKey = `${id}/content`
            delete data.value[contentKey]
            if (selectedFileId.value === id) {
                selectedFileId.value = null
            }
        }

        // Delete the item itself
        delete data.value[id]
        data.value = { ...data.value } // Trigger reactivity
    }

    function getChildren(parentId) {
        const folders = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'folder')
        const files = itemsArray.value.filter(i => i.parentId === parentId && i.type === 'file')
        return [...sortByName(folders), ...sortByName(files)]
    }

    function sortByName(items) {
        return items.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }

    function selectFile(fileId) {
        selectedFileId.value = fileId
    }

    const selectedFile = computed(() => {
        if (!selectedFileId.value) return null
        return data.value[selectedFileId.value] || null
    })

    const selectedFileContent = computed(() => {
        if (!selectedFile.value) return ''
        const contentKey = `${selectedFile.value.id}/content`
        return data.value[contentKey]?.text || ''
    })

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
    function exportJson() {
        return JSON.stringify(data.value, null, 2)
    }

    function importData(newData) {
        // Validate the data structure
        try {
            // Check if it's an object
            if (typeof newData !== 'object' || newData === null) {
                throw new Error('Invalid data structure: must be an object')
            }

            // Validate the structure
            const validatedData = {}
            const files = new Set()
            const contentFiles = new Set()

            // First pass: collect all files and validate basic structure
            for (const [key, item] of Object.entries(newData)) {
                if (!item || typeof item !== 'object') {
                    throw new Error(`Invalid item structure for key ${key}`)
                }

                if (!item.id || !item.type) {
                    throw new Error(`Missing required properties (id or type) for item ${key}`)
                }

                // Validate based on type
                switch (item.type) {
                    case 'file':
                        if (!item.name) {
                            throw new Error(`File ${item.id} missing name property`)
                        }
                        files.add(item.id)
                        validatedData[key] = item
                        break

                    case 'content':
                        if (!item.text) {
                            throw new Error(`Content ${item.id} missing text property`)
                        }
                        const fileId = item.id.split('/')[0]
                        contentFiles.add(fileId)
                        validatedData[key] = item
                        break

                    case 'folder':
                        if (!item.name) {
                            throw new Error(`Folder ${item.id} missing name property`)
                        }
                        validatedData[key] = item
                        break

                    // Allow other types but don't validate them strictly
                    default:
                        validatedData[key] = item
                }
            }

            // Second pass: validate relationships
            files.forEach(fileId => {
                if (!contentFiles.has(fileId)) {
                    console.warn(`Warning: File ${fileId} has no associated content`)
                }
            })

            contentFiles.forEach(fileId => {
                if (!files.has(fileId)) {
                    console.warn(`Warning: Content exists for non-existent file ${fileId}`)
                }
            })

            // If validation passes, update the store
            data.value = validatedData

            // Reset selection and open folders
            selectedFileId.value = null
            openFolders.value = new Set()

            // Select the first file if available
            const firstFile = Object.values(validatedData)
                .find(item => item.type === 'file')
            if (firstFile) {
                selectedFileId.value = firstFile.id
            }

        } catch (error) {
            console.error('Import failed:', error)
            throw error
        }
    }


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

    // Create markdown-it instance with desired options
    function getMarkdownIt() {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true
        }).use(markdownItTaskLists)

        // Customize the rendering rules to add our Tailwind classes
        md.renderer.rules.paragraph_open = () => `<span class="${styles.value.p}">`
        md.renderer.rules.paragraph_close = () => '</span>'
        md.renderer.rules.heading_open = (tokens, idx) => {
            const tag = tokens[idx].tag
            return `<${tag} class="${styles.value[tag]}">`
        }
        md.renderer.rules.bullet_list_open = () => `<ul class="${styles.value.ul}">`
        md.renderer.rules.ordered_list_open = () => `<ol class="${styles.value.ol}">`
        md.renderer.rules.list_item_open = (tokens, idx) => {
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

    return {
        selectedFileId,
        openFolders,
        styles,
        itemsArray,
        rootItems,
        selectedFile,
        selectedFileContent,
        getChildren,
        selectFile,
        updateFileContent,
        exportJson,
        importData,
        toggleFolder,
        updateStyle,
        getMarkdownIt,
        createFile,
        createFolder,
        deleteItem,
    }
})