import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Holds ephemeral "draft" text for each file currently being edited.
 * - Editor.vue writes keystrokes to this store.
 * - Preview.vue reads from this store so it updates immediately.
 * - The actual DB save (docStore.updateFileContent) is done on a debounce, so
 *   we don't conflict or spam the DB with every keystroke.
 */
export const useDraftStore = defineStore('draftStore', () => {
    // A Map-like object keyed by fileId => string (the "draft" text)
    const drafts = ref({})

    function getDraft(fileId) {
        return drafts.value[fileId] || ''
    }

    function setDraft(fileId, text) {
        drafts.value[fileId] = text
    }

    function clearDraft(fileId) {
        delete drafts.value[fileId]
    }

    function clearAll() {
        drafts.value = {}
    }

    return {
        getDraft,
        setDraft,
        clearDraft,
        clearAll,
    }
})
