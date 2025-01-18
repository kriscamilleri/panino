// store/uiStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('uiStore', () => {
    // Panel visibility
    const showSidebar = ref(true)
    const showEditor = ref(true)
    const showPreview = ref(true)

    // Menu visibility
    const showViewMenu = ref(false)
    const showActionBar = ref(false)
    const showFileMenu = ref(false)

    // Computed property to check if any menu is open
    const isAnyMenuOpen = computed(() =>
        showViewMenu.value || showActionBar.value || showFileMenu.value
    )

    // Stats and metadata
    const showStats = ref(false)
    const showMetadata = ref(false)

    // Panel toggles
    function toggleSidebar() {
        showSidebar.value = !showSidebar.value
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

    return {
        // Panel visibility
        showSidebar,
        showEditor,
        showPreview,

        // Menu visibility
        showViewMenu,
        showActionBar,
        showFileMenu,
        isAnyMenuOpen,

        // Stats and metadata
        showStats,
        showMetadata,

        // Toggle functions
        toggleSidebar,
        toggleEditor,
        togglePreview,
        toggleViewMenu,
        toggleActionBar,
        toggleFileMenu,
        toggleStats,
        toggleMetadata,
        closeAllMenus,
    }
})