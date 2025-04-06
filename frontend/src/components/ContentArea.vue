<template>
    <div class="flex flex-1 overflow-hidden flex-col md:flex-row" data-testid="content-area-container">
        <!-- If a folder is selected and no file, show FolderPreview -->
        <template v-if="docStore.selectedFolderId && !docStore.selectedFileId">
            <div class="flex-1 overflow-hidden" data-testid="content-area-folder-preview">
                <FolderPreview :folderId="docStore.selectedFolderId" class="h-full overflow-y-auto" />
            </div>
        </template>

        <!-- Else if no folder and no file => show recent docs -->
        <template v-else-if="!docStore.selectedFolderId && !docStore.selectedFileId">
            <div class="flex-1 overflow-hidden" data-testid="content-area-recent-docs">
                <FolderPreview folderId="__recent__" class="h-full overflow-y-auto" />
            </div>
        </template>

        <!-- Otherwise, show normal Editor/Preview layout -->
        <template v-else>
            <div class="flex flex-1 h-full overflow-hidden"
                :class="{ 'flex-col': isMobileView, 'flex-row': !isMobileView }">
                <div class="flex flex-col md:flex-row flex-1 overflow-hidden">
                    <!-- Editor Pane -->
                    <template v-if="ui.showEditor">
                        <div :class="{
                            'h-1/2': isMobileView && ui.showPreview,
                            'h-full': isMobileView && !ui.showPreview,
                            'flex-shrink-0': !isMobileView
                        }" :style="!isMobileView ? { width: editorWidth + 'px' } : {}"
                            class="w-full overflow-hidden order-2 md:order-1" data-testid="content-area-editor-pane">
                            <div class="h-full overflow-y-auto">
                                <Editor ref="editorRef" />
                            </div>
                        </div>

                        <!-- Resizer handle between Editor and Preview (desktop only) -->
                        <div v-if="!isMobileView && ui.showPreview"
                            class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400 order-1"
                            @mousedown="startEditorResize($event)" data-testid="content-area-editor-resizer"></div>
                    </template>

                    <!-- Preview Pane -->
                    <div v-if="ui.showPreview" :class="{
                        'h-1/2': isMobileView && ui.showEditor,
                        'h-full': isMobileView && !ui.showEditor,
                        'flex-1': !isMobileView
                    }" class="w-full overflow-hidden order-1 md:order-2" data-testid="content-area-preview-pane">
                        <div class="h-full overflow-y-auto p-4">
                            <Preview ref="previewRef" />
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import FolderPreview from '@/components/FolderPreview.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'

const docStore = useDocStore()
const ui = useUiStore()

// Props from parent or a store: determines if we’re in mobile layout
const props = defineProps({
    isMobileView: {
        type: Boolean,
        default: false
    }
})

// Editor resizing
const editorWidth = ref(500)
const isResizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)

function startEditorResize(event) {
    if (props.isMobileView) return
    isResizing.value = true
    startX.value = event.pageX
    startWidth.value = editorWidth.value

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResize)
    document.body.style.userSelect = 'none'
}

function handleMouseMove(event) {
    if (!isResizing.value) return

    const container = getContentContainer()
    if (!container) return
    const containerWidth = container.clientWidth

    const documentsWidth = ui.showDocuments ? 300 + 4 : 0 // This is simplified; you might pass actual sidebar width as prop
    const availableWidth = containerWidth - documentsWidth

    const diff = event.pageX - startX.value
    const newWidth = startWidth.value + diff

    // If user shrinks to 0 => hide editor
    if (newWidth <= 0) {
        ui.showEditor = false
        stopResize()
    }
    // If user grows editor too large => hide preview
    else if (newWidth >= availableWidth - 50) {
        editorWidth.value = availableWidth
        ui.showPreview = false
    } else {
        editorWidth.value = newWidth
        if (!ui.showPreview) {
            ui.showPreview = true
        }
    }
}

function stopResize() {
    isResizing.value = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    document.body.style.userSelect = ''
}

function getContentContainer() {
    // This is a hacky approach:
    // If the parent holds a ref to the main content container, you can provide it as a prop.
    // Or query an element with a known ID/class.
    // Using data-testid for this is more robust
    return document.querySelector('[data-testid="content-area-container"]')
}

onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
})

</script>

<style scoped>
/* Optional local styles for the content area */
</style>
