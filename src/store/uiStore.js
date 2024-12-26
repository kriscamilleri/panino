// store/uiStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('uiStore', () => {
    // By default, everything is open
    const showSidebar = ref(true)
    const showEditor = ref(true)
    const showPreview = ref(true)

    // New flags for the collapsible action bar and for stats/metadata
    const showActionBar = ref(true)
    const showStats = ref(true)
    const showMetadata = ref(false)

    function toggleSidebar() {
        showSidebar.value = !showSidebar.value
    }

    function toggleEditor() {
        showEditor.value = !showEditor.value
    }

    function togglePreview() {
        showPreview.value = !showPreview.value
    }

    function toggleActionBar() {
        showActionBar.value = !showActionBar.value
    }

    function toggleStats() {
        showStats.value = !showStats.value
    }

    function toggleMetadata() {
        showMetadata.value = !showMetadata.value
    }

    return {
        showSidebar,
        showEditor,
        showPreview,
        showActionBar,
        showStats,
        showMetadata,
        toggleSidebar,
        toggleEditor,
        togglePreview,
        toggleActionBar,
        toggleStats,
        toggleMetadata,
    }
})
