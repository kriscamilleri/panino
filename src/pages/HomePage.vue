<!-- ----- START: src/pages/HomePage.vue ----- -->
<template>
    <div class="h-screen flex flex-col overflow-hidden" ref="container">
        <!-- Top Navbar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <!-- Left side -->
                <div class="flex items-center space-x-4">
                    <!-- View toggles -->
                    <div class="flex space-x-2">
                        <button @click="ui.toggleSidebar()" class="p-2 rounded hover:bg-gray-200"
                            :class="{ 'bg-gray-200': ui.showSidebar }" title="Toggle Sidebar">
                            📁
                        </button>
                        <button @click="ui.toggleEditor()" class="p-2 rounded hover:bg-gray-200"
                            :class="{ 'bg-gray-200': ui.showEditor }" title="Toggle Editor">
                            ✏️
                        </button>
                        <button @click="ui.togglePreview()" class="p-2 rounded hover:bg-gray-200"
                            :class="{ 'bg-gray-200': ui.showPreview }" title="Toggle Preview">
                            👁️
                        </button>
                    </div>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-2">
                    <button @click="handleExport"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <span>📤</span>
                        <span>Export</span>
                    </button>
                    <button @click="goToStyles"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <span>🎨</span>
                        <span>Styles</span>
                    </button>
                </div>
            </div>
        </nav>

        <!-- Main content area -->
        <div class="flex flex-1 overflow-hidden" ref="mainContent">
            <!-- Sidebar with resizer -->
            <template v-if="ui.showSidebar">
                <div :style="{ width: sidebarWidth + 'px' }" class="flex-shrink-0 bg-gray-100 border-r overflow-hidden">
                    <div class="h-full overflow-y-auto p-4">
                        <Sidebar />
                    </div>
                </div>
                <div class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400"
                    @mousedown="startResize('sidebar', $event)"></div>
            </template>

            <!-- Editor with resizer -->
            <template v-if="ui.showEditor">
                <div :style="{ width: editorWidth + 'px' }" class="flex-shrink-0 overflow-hidden">
                    <div class="h-full overflow-y-auto p-4">
                        <Editor />
                    </div>
                </div>
                <div v-if="ui.showPreview"
                    class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400"
                    @mousedown="startResize('editor', $event)"></div>
            </template>

            <!-- Preview -->
            <div v-if="ui.showPreview" class="flex-1 overflow-hidden">
                <div class="h-full overflow-y-auto p-4">
                    <Preview />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import Sidebar from '@/components/Sidebar.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import { useRouter, useRoute } from 'vue-router'
import { ref, onMounted, onUnmounted, watch } from 'vue'

const docStore = useDocStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

// Refs for DOM elements
const container = ref(null)
const mainContent = ref(null)

// Default widths when panels are restored
const DEFAULT_SIDEBAR_WIDTH = 300
const DEFAULT_EDITOR_WIDTH = 500
const MINIMUM_PREVIEW_WIDTH = 50  // Minimum width before considering preview collapsed

// Panel widths
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const editorWidth = ref(DEFAULT_EDITOR_WIDTH)
let isResizing = ref(false)
let currentResizer = ref(null)
let startX = ref(0)
let startWidth = ref(0)

// ============================================
// 1) Watch route params -> open correct file
// ============================================
onMounted(() => {
    if (route.params.fileId) {
        docStore.selectFile(route.params.fileId)
    }
})

// If user changes the file in the store, update the URL
watch(() => docStore.selectedFileId, (newFileId) => {
    // If there's a new file selected, reflect that in the URL
    // Avoid redundant pushes when already on that URL
    if (newFileId && route.params.fileId !== newFileId) {
        router.replace({ name: 'doc', params: { fileId: newFileId } })
    }
    // If no file is selected, send them back to '/' 
    else if (!newFileId && route.name !== 'home') {
        router.replace({ name: 'home' })
    }
})

// ============================================
// 2) Panel toggles and resizing
// ============================================
function handleSidebarToggle(event) {
    if (event.target.checked) {
        sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH
        adjustEditorWidthForContainer()
    }
}

function handleEditorToggle(event) {
    if (event.target.checked) {
        editorWidth.value = DEFAULT_EDITOR_WIDTH
        adjustEditorWidthForContainer()
    }
}

function handlePreviewToggle(event) {
    if (event.target.checked && mainContent.value) {
        // Calculate available width
        const containerWidth = mainContent.value.clientWidth
        const sidebarTotalWidth = ui.showSidebar ? sidebarWidth.value + 4 : 0
        const availableWidth = containerWidth - sidebarTotalWidth

        const desiredPreviewWidth = Math.max(MINIMUM_PREVIEW_WIDTH * 4, availableWidth * 0.3)
        const maxEditorWidth = availableWidth - desiredPreviewWidth

        if (editorWidth.value > maxEditorWidth) {
            editorWidth.value = maxEditorWidth
        }
    }
}

function adjustEditorWidthForContainer() {
    if (!mainContent.value || !ui.showEditor) return

    const containerWidth = mainContent.value.clientWidth
    const sidebarTotalWidth = ui.showSidebar ? sidebarWidth.value + 4 : 0
    const availableWidth = containerWidth - sidebarTotalWidth

    if (editorWidth.value >= availableWidth - MINIMUM_PREVIEW_WIDTH) {
        ui.showPreview = false
    }
}

// Resize functionality
function startResize(panel, event) {
    isResizing.value = true
    currentResizer.value = panel
    startX.value = event.pageX
    startWidth.value = panel === 'sidebar' ? sidebarWidth.value : editorWidth.value

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResize)
    document.body.style.userSelect = 'none'
}

function handleMouseMove(event) {
    if (!isResizing.value || !mainContent.value) return

    const containerWidth = mainContent.value.clientWidth
    const diff = event.pageX - startX.value

    if (currentResizer.value === 'sidebar') {
        const newWidth = startWidth.value + diff
        if (newWidth <= 0) {
            ui.showSidebar = false
            stopResize()
        } else {
            sidebarWidth.value = newWidth
            adjustEditorWidthForContainer()
        }
    } else if (currentResizer.value === 'editor') {
        const newWidth = startWidth.value + diff
        const sidebarTotalWidth = ui.showSidebar ? sidebarWidth.value + 4 : 0
        const availableWidth = containerWidth - sidebarTotalWidth

        if (newWidth <= 0) {
            ui.showEditor = false
            stopResize()
        } else if (newWidth >= availableWidth - MINIMUM_PREVIEW_WIDTH) {
            editorWidth.value = availableWidth
            ui.showPreview = false
        } else {
            editorWidth.value = newWidth
            if (!ui.showPreview) {
                ui.showPreview = true
            }
        }
    }
}

function stopResize() {
    isResizing.value = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    document.body.style.userSelect = ''
}

// Watch for window resize
let resizeTimeout
onMounted(() => {
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(() => {
            adjustEditorWidthForContainer()
        }, 100)
    })
})

// Cleanup
onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    window.removeEventListener('resize')
    clearTimeout(resizeTimeout)
})

// Export
function handleExport() {
    const jsonString = docStore.exportJson()
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'data.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

function goToStyles() {
    router.push('/styles')
}
</script>

<style scoped>
/* Prevent text selection while resizing */
.resize-handle {
    user-select: none;
}
</style>
<!-- ----- END: src/pages/HomePage.vue ----- -->
