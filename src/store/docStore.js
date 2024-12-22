// In src/store/docStore.js

import { defineStore } from 'pinia'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { ref, computed } from 'vue'
import rawDataImport from '@/assets/data.json'

export const useDocStore = defineStore('docStore', () => {
    // Initialize the data store with the imported data
    const data = ref(rawDataImport)
    const selectedFileId = ref(null)
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
            // Using Vue's reactivity system to trigger updates
            data.value = {
                ...data.value,
                [contentKey]: {
                    ...data.value[contentKey],
                    text: newText,
                    lastModified: new Date().toISOString() // Optional: track modifications
                }
            }
        }
    }

    function exportJson() {
        return JSON.stringify(data.value, null, 2)
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
        toggleFolder,
        updateStyle,
        getMarkdownIt,
    }
})