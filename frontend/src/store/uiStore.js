import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('uiStore', () => {
    // Panel visibility
    const showDocuments = ref(true)
    const showEditor = ref(true)
    const showPreview = ref(true)

    // Menu visibility
    const showViewMenu = ref(false)
    const showActionBar = ref(false)
    const showFileMenu = ref(false)

    // Import modal
    const showImportModal = ref(false)

    // Stats & metadata
    const showStats = ref(false)
    const showMetadata = ref(false)

    // Toasts
    const toasts = ref([])

    /** Add a toast message */
    function addToast(message, duration = 5000) {
        console.log('addToast', message)
        const id = Date.now().toString() + Math.random().toString(36).substr(2)
        toasts.value.push({ id, message })
        setTimeout(() => removeToast(id), duration)
    }

    /** Remove a toast by ID */
    function removeToast(id) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    // Computed
    const isAnyMenuOpen = computed(() =>
        showViewMenu.value || showActionBar.value || showFileMenu.value
    )

    // Panel toggles
    function toggleDocuments() { showDocuments.value = !showDocuments.value }
    function toggleEditor() { showEditor.value = !showEditor.value }
    function togglePreview() { showPreview.value = !showPreview.value }

    // Menu toggles
    function toggleViewMenu() {
        if (showViewMenu.value) showViewMenu.value = false
        else {
            showActionBar.value = false
            showFileMenu.value = false
            showViewMenu.value = true
        }
    }
    function toggleActionBar() {
        if (showActionBar.value) showActionBar.value = false
        else {
            showViewMenu.value = false
            showFileMenu.value = false
            showActionBar.value = true
        }
    }
    function toggleFileMenu() {
        if (showFileMenu.value) showFileMenu.value = false
        else {
            showViewMenu.value = false
            showActionBar.value = false
            showFileMenu.value = true
        }
    }

    function toggleStats() { showStats.value = !showStats.value }
    function toggleMetadata() { showMetadata.value = !showMetadata.value }

    function closeAllMenus() {
        showViewMenu.value = false
        showActionBar.value = false
        showFileMenu.value = false
    }

    // Import modal
    function openImportModal() { showImportModal.value = true }
    function closeImportModal() { showImportModal.value = false }

    return {
        // visibility
        showDocuments,
        showEditor,
        showPreview,
        showViewMenu,
        showActionBar,
        showFileMenu,
        showImportModal,
        showStats,
        showMetadata,
        toasts,

        // computed
        isAnyMenuOpen,

        // actions
        toggleDocuments,
        toggleEditor,
        togglePreview,
        toggleViewMenu,
        toggleActionBar,
        toggleFileMenu,
        toggleStats,
        toggleMetadata,
        closeAllMenus,
        openImportModal,
        closeImportModal,
        addToast,
        removeToast
    }
})
