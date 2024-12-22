// store/uiStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('uiStore', () => {
    // By default, everything is open
    const showSidebar = ref(true)
    const showEditor = ref(true)
    const showPreview = ref(true)

    function toggleSidebar() {
        showSidebar.value = !showSidebar.value
    }

    function toggleEditor() {
        showEditor.value = !showEditor.value
    }

    function togglePreview() {
        showPreview.value = !showPreview.value
    }

    return {
        showSidebar,
        showEditor,
        showPreview,
        toggleSidebar,
        toggleEditor,
        togglePreview,
    }
})
