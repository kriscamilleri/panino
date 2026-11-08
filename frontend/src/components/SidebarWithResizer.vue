<template>
    <!-- Only render if the documents sidebar is toggled on -->
    <template v-if="ui.showDocuments">
        <div
            :style="{ width: documentsWidth + 'px' }"
            class="flex-shrink-0 workspace-chrome bg-gray-100 border-r overflow-hidden relative"
            data-testid="sidebar-container"
        >
            <div class="h-full overflow-y-auto p-4 pb-12">
                <Documents />
            </div>
            <!-- Collapse button sticky to bottom -->
            <div class="sticky bottom-0 left-0 right-0 bg-gray-100 p-2 flex justify-end">
                <button
                    @click="ui.toggleDocuments()"
                    class="px-3 py-2 hover:bg-gray-200 flex items-center gap-2 rounded"
                    title="Collapse Documents"
                    data-testid="collapse-documents-button"
                >
                    <PanelLeftClose class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!-- Resizer handle -->
        <div
            class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400"
            @mousedown="startResize($event)"
            data-testid="sidebar-resizer"
        ></div>
    </template>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/store/uiStore'
import Documents from '@/components/Documents.vue'
import { PanelLeftClose } from 'lucide-vue-next'
import { isSearchShortcut, useDesktopSearchState } from '@/composables/useDocumentSearch'

// Desktop only: phones show PhoneHome instead of the sidebar.
const documentsWidth = ref(300)
const isResizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)

// Access the UI store for toggling "showDocuments"
const ui = useUiStore()

function startResize(event) {
    isResizing.value = true
    startX.value = event.pageX
    startWidth.value = documentsWidth.value

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResize)
    document.body.style.userSelect = 'none'
}

function handleMouseMove(event) {
    if (!isResizing.value) return
    const diff = event.pageX - startX.value
    const newWidth = startWidth.value + diff

    // If user shrinks below 0 => hide docs
    if (newWidth <= 0) {
        ui.showDocuments = false
        stopResize()
        return
    }
    documentsWidth.value = newWidth
}

function stopResize() {
    isResizing.value = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    document.body.style.userSelect = ''
}

// Ctrl+Shift+F / Cmd+Shift+F opens the search panel, showing the sidebar first
// if it is collapsed. Listened for while capturing, so the editor's own key
// handling cannot swallow it.
const desktopSearch = useDesktopSearchState()
function onSearchShortcut(event) {
    if (!isSearchShortcut(event)) return
    event.preventDefault()
    if (!ui.showDocuments) ui.toggleDocuments()
    desktopSearch.openSearch()
}
onMounted(() => window.addEventListener('keydown', onSearchShortcut, true))

onUnmounted(() => {
    // Clean up any event listeners if user leaves the page mid-resize
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    window.removeEventListener('keydown', onSearchShortcut, true)
})

</script>
