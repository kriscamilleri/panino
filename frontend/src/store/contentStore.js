// src/store/contentStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStructureStore } from './structureStore'
import { useSyncStore } from './syncStore'

export const useContentStore = defineStore('contentStore', () => {
    const contentCache = ref(new Map())
    const structureStore = useStructureStore()
    const syncStore = useSyncStore()

    // Getters
    const selectedFileContent = computed(() => {
        if (!structureStore.selectedFile) return ''
        return contentCache.value.get(structureStore.selectedFile.id)?.text || ''
    })

    // Content operations
    async function loadContent(fileId) {
        if (!contentCache.value.has(fileId)) {
            const content = await syncStore.loadContent(fileId)
            if (content) {
                contentCache.value.set(fileId, content)
            }
        }
        return contentCache.value.get(fileId)?.text || ''
    }

    async function updateContent(fileId, newText) {
        const content = await syncStore.saveContent(fileId, newText)
        if (content) {
            contentCache.value.set(fileId, content)
        }
    }

    async function deleteContent(fileId) {
        await syncStore.deleteContent(fileId)
        contentCache.value.delete(fileId)
    }

    async function initializeContent(fileId) {
        await updateContent(fileId, '')
    }

    function clearCache() {
        contentCache.value.clear()
    }

    return {
        contentCache,
        selectedFileContent,
        loadContent,
        updateContent,
        deleteContent,
        initializeContent,
        clearCache
    }
})