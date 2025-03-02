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
        const fileId = structureStore.selectedFile.id
        const cachedContent = contentCache.value.get(fileId)
        return cachedContent?.text || ''
    })

    // Content operations
    async function loadContent(fileId) {
        if (!fileId) return ''
        
        // If already in cache, return the text
        if (contentCache.value.has(fileId)) {
            return contentCache.value.get(fileId)?.text || ''
        }
        
        try {
            // Try to load from the database
            const content = await syncStore.loadContent(fileId)
            if (content) {
                contentCache.value.set(fileId, content)
                return content.text || ''
            }
            return ''
        } catch (error) {
            console.error(`Error loading content for file ${fileId}:`, error)
            return ''
        }
    }

    async function updateContent(fileId, newText) {
        try {
            const content = await syncStore.saveContent(fileId, newText)
            if (content) {
                contentCache.value.set(fileId, content)
            }
            return newText
        } catch (error) {
            console.error(`Error saving content for file ${fileId}:`, error)
            throw error
        }
    }

    async function deleteContent(fileId) {
        await syncStore.deleteContent(fileId)
        contentCache.value.delete(fileId)
    }

    async function initializeContent(fileId) {
        return await updateContent(fileId, '')
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