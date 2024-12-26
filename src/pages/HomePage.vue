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

                    <!-- New: Toggle for Action Bar -->
                    <button @click="ui.toggleActionBar()" class="p-2 rounded hover:bg-gray-200"
                        :class="{ 'bg-gray-200': ui.showActionBar }" title="Toggle Tools">
                        🛠️
                    </button>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-2">
                    <button @click="showImportModal = true"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <span>📥</span>
                        <span>Import</span>
                    </button>
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

            <!-- Collapsible Action Bar -->
            <transition name="fade">
                <div v-if="ui.showActionBar" class="border-t bg-gray-50 px-4 py-2">
                    <div class="flex flex-wrap gap-2 items-center">
                        <!-- Text formatting -->
                        <button v-for="format in textFormats" :key="format.label"
                            @click="editorRef.insertFormat(format.prefix, format.suffix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm" :title="format.label">
                            {{ format.icon }}
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Lists -->
                        <button v-for="list in listFormats" :key="list.label" @click="editorRef.insertList(list.prefix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm" :title="list.label">
                            {{ list.icon }}
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Table -->
                        <button @click="editorRef.insertTable"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm" title="Insert Table">
                            |-|
                        </button>

                        <!-- Code block -->
                        <button @click="editorRef.insertCodeBlock"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                            title="Insert Code Block">
                            &lt;/&gt;
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Toggle stats / metadata -->
                        <button @click="ui.toggleStats()"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                            :class="{ 'bg-blue-50': ui.showStats }" title="Toggle Document Stats">
                            📊 Stats
                        </button>
                        <button @click="ui.toggleMetadata()"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                            :class="{ 'bg-blue-50': ui.showMetadata }" title="Toggle File Metadata">
                            ℹ️ Info
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Search box -->
                        <div class="flex items-center gap-2">
                            <input type="text" placeholder="Find text..." v-model="searchTerm"
                                class="border p-1 rounded text-sm w-36" />
                            <button @click="editorRef.findNext(searchTerm)"
                                class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm">
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            </transition>
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
                        <!-- Note the ref on the Editor -->
                        <Editor ref="editorRef" />
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
    <ImportModal :show="showImportModal" @close="showImportModal = false" @import-success="handleImportSuccess" />
</template>

<script setup>
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import Sidebar from '@/components/Sidebar.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import ImportModal from '@/components/ImportModal.vue'
import { useRouter, useRoute } from 'vue-router'
import { ref, onMounted, onUnmounted, watch } from 'vue'

const docStore = useDocStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

// For panel resizing
const container = ref(null)
const mainContent = ref(null)

// Default widths
const DEFAULT_SIDEBAR_WIDTH = 300
const DEFAULT_EDITOR_WIDTH = 500
const MINIMUM_PREVIEW_WIDTH = 50

const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const editorWidth = ref(DEFAULT_EDITOR_WIDTH)
let isResizing = ref(false)
let currentResizer = ref(null)
let startX = ref(0)
let startWidth = ref(0)
const showImportModal = ref(false)

// For Import
function handleImportSuccess() {
    // You could show a success message or perform other actions
    console.log('Import successful')
}

// For search
const searchTerm = ref('')

// 1) Watch route params -> open correct file
onMounted(() => {
    if (route.params.fileId) {
        docStore.selectFile(route.params.fileId)
    }
})
watch(() => docStore.selectedFileId, (newFileId) => {
    if (newFileId && route.params.fileId !== newFileId) {
        router.replace({ name: 'doc', params: { fileId: newFileId } })
    } else if (!newFileId && route.name !== 'home') {
        router.replace({ name: 'home' })
    }
})

// 2) Panel toggles and resizing
function adjustEditorWidthForContainer() {
    if (!mainContent.value || !ui.showEditor) return
    const containerWidth = mainContent.value.clientWidth
    const sidebarTotalWidth = ui.showSidebar ? sidebarWidth.value + 4 : 0
    const availableWidth = containerWidth - sidebarTotalWidth

    if (editorWidth.value >= availableWidth - MINIMUM_PREVIEW_WIDTH) {
        ui.showPreview = false
    }
}

function startResize(panel, event) {
    isResizing.value = true
    currentResizer.value = panel
    startX.value = event.pageX
    startWidth.value = (panel === 'sidebar') ? sidebarWidth.value : editorWidth.value

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

let resizeTimeout
onMounted(() => {
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(() => {
            adjustEditorWidthForContainer()
        }, 100)
    })
})
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

// The old Editor toolbar data (text/list formats) used by the action bar
const textFormats = [
    { label: 'Bold', icon: 'B', prefix: '**', suffix: '**' },
    { label: 'Italic', icon: 'I', prefix: '_', suffix: '_' },
    { label: 'Strike', icon: 'S̶', prefix: '~~', suffix: '~~' },
    { label: 'Quote', icon: '💬', prefix: '> ', suffix: '\n' },
]
const listFormats = [
    { label: 'Bullet List', icon: '•', prefix: '* ' },
    { label: 'Numbered List', icon: '1.', prefix: '1. ' },
    { label: 'Task List', icon: '☐', prefix: '- [ ] ' },
]

// We’ll access Editor’s methods via a template ref:
const editorRef = ref(null)
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
<!-- ----- END: src/pages/HomePage.vue ----- -->
