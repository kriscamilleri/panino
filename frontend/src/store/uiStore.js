// frontend/src/store/uiStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('uiStore', () => {
    // Panel visibility
    const showDocuments = ref(true)  // Renamed from showSidebar
    const showEditor = ref(true)
    const showPreview = ref(true)

    // Menu visibility
    const showViewMenu = ref(false)
    const showActionBar = ref(false)
    const showFileMenu = ref(false)

    // Modal visibility (NEW)
    const showImportModal = ref(false)

    // Computed property to check if any menu is open
    const isAnyMenuOpen = computed(() =>
        showViewMenu.value || showActionBar.value || showFileMenu.value
    )

    // Stats and metadata
    const showStats = ref(false)
    const showMetadata = ref(false)

    // Panel toggles
    function toggleDocuments() {
        showDocuments.value = !showDocuments.value
    }

    function toggleEditor() {
        showEditor.value = !showEditor.value
    }

    function togglePreview() {
        showPreview.value = !showPreview.value
    }

    // Menu toggles
    function toggleViewMenu() {
        if (showViewMenu.value) {
            showViewMenu.value = false
        } else {
            showActionBar.value = false
            showFileMenu.value = false
            showViewMenu.value = true
        }
    }

    function toggleActionBar() {
        if (showActionBar.value) {
            showActionBar.value = false
        } else {
            showViewMenu.value = false
            showFileMenu.value = false
            showActionBar.value = true
        }
    }

    function toggleFileMenu() {
        if (showFileMenu.value) {
            showFileMenu.value = false
        } else {
            showViewMenu.value = false
            showActionBar.value = false
            showFileMenu.value = true
        }
    }

    function closeAllMenus() {
        showViewMenu.value = false
        showActionBar.value = false
        showFileMenu.value = false
    }

    function toggleStats() {
        showStats.value = !showStats.value
    }

    function toggleMetadata() {
        showMetadata.value = !showMetadata.value
    }

    // Modal toggles (NEW)
    function openImportModal() {
        showImportModal.value = true
    }

    function closeImportModal() {
        showImportModal.value = false
    }

    return {
        // Panel visibility
        showDocuments,
        showEditor,
        showPreview,

        // Menus
        showViewMenu,
        showActionBar,
        showFileMenu,
        isAnyMenuOpen,

        // Modals (NEW)
        showImportModal,

        // Stats and metadata
        showStats,
        showMetadata,

        // Toggles
        toggleDocuments,
        toggleEditor,
        togglePreview,
        toggleViewMenu,
        toggleActionBar,
        toggleFileMenu,
        toggleStats,
        toggleMetadata,
        closeAllMenus,

        // Modal actions (NEW)
        openImportModal,
        closeImportModal,
    }
})