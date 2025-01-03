<template>
    <div class="h-screen flex flex-col overflow-hidden" ref="container">
        <!-- Top Navbar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <!-- Left side -->
                <div class="flex items-center space-x-4">
                    <!-- View toggles -->
                    <div class="flex space-x-2">
                        <button @click="ui.toggleSidebar()"
                            class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showSidebar }" title="Toggle Sidebar">
                            <Folder class="w-4 h-4" />
                            <span>Sidebar</span>
                        </button>

                        <button @click="ui.toggleEditor()"
                            class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showEditor }" title="Toggle Editor">
                            <Edit3 class="w-4 h-4" />
                            <span>Editor</span>
                        </button>

                        <button @click="ui.togglePreview()"
                            class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showPreview }" title="Toggle Preview">
                            <Eye class="w-4 h-4" />
                            <span>Preview</span>
                        </button>
                    </div>

                    <!-- Separator -->
                    <div class="w-px h-6 bg-gray-300 mx-2"></div>

                    <!-- Toggle Tools -->
                    <button @click="ui.toggleActionBar()"
                        class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                        :class="{ 'bg-gray-200': ui.showActionBar }" title="Toggle Tools">
                        <Paintbrush class="w-4 h-4" />
                        <span>Tools</span>
                    </button>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-2">
                    <button @click="showImportModal = true"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <Upload class="w-4 h-4" />
                        <span>Import</span>
                    </button>
                    <button @click="handleExport"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <Download class="w-4 h-4" />
                        <span>Export</span>
                    </button>
                    <button @click="goToStyles"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <Palette class="w-4 h-4" />
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
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            :title="format.label">
                            <component :is="format.icon" class="w-4 h-4" />
                            <span>{{ format.label }}</span>
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Lists -->
                        <button v-for="list in listFormats" :key="list.label" @click="editorRef.insertList(list.prefix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            :title="list.label">
                            <component :is="list.icon" class="w-4 h-4" />
                            <span>{{ list.label }}</span>
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Table -->
                        <button @click="editorRef.insertTable"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            title="Insert Table">
                            <Table class="w-4 h-4" />
                            <span>Table</span>
                        </button>

                        <!-- Code block -->
                        <button @click="editorRef.insertCodeBlock"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            title="Insert Code Block">
                            <Code2 class="w-4 h-4" />
                            <span>Code</span>
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Toggle stats / metadata -->
                        <button @click="ui.toggleStats()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"
                            :class="{ 'bg-gray-200': ui.showStats }" title="Toggle Document Stats">
                            <BarChart2 class="w-4 h-4" />
                            <span>Stats</span>
                        </button>
                        <button @click="ui.toggleMetadata()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"
                            :class="{ 'bg-gray-200': ui.showMetadata }" title="Toggle File Metadata">
                            <Info class="w-4 h-4" />
                            <span>Info</span>
                        </button>

                        <!-- Divider -->
                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Search box -->
                        <div class="flex items-center gap-2">
                            <div class="relative">
                                <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                                <input type="text" placeholder="Find text..." v-model="searchTerm"
                                    class="border pl-7 pr-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-blue-500" />
                            </div>
                            <button @click="editorRef.findNext(searchTerm)"
                                class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                                <ArrowRight class="w-4 h-4" />
                                <span>Next</span>
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
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import Sidebar from '@/components/Sidebar.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import ImportModal from '@/components/ImportModal.vue'

// Import only the icons you need from lucide-vue:
import {
    Folder,
    Edit3,
    Eye,
    Paintbrush,
    Upload,
    Download,
    Palette,
    Bold,
    Italic,
    Strikethrough,
    MessageSquare,
    List,
    ListOrdered,
    CheckSquare,
    Table,
    Code2,
    BarChart2,
    Info,
    Search,
    ArrowRight
} from 'lucide-vue-next'

const docStore = useDocStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

// For panel resizing
const container = ref(null)
const mainContent = ref(null)
const sidebarWidth = ref(300)
const editorWidth = ref(500)
const isResizing = ref(false)
const currentResizer = ref(null)
const startX = ref(0)
const startWidth = ref(0)
const showImportModal = ref(false)
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
    // Force preview off if editor tries to fill container
    if (editorWidth.value >= availableWidth - 50) {
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
        } else if (newWidth >= availableWidth - 50) {
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
    { label: 'Bold', icon: Bold, prefix: '**', suffix: '**' },
    { label: 'Italic', icon: Italic, prefix: '_', suffix: '_' },
    { label: 'Strike', icon: Strikethrough, prefix: '~~', suffix: '~~' },
    { label: 'Quote', icon: MessageSquare, prefix: '> ', suffix: '\n' },
]
const listFormats = [
    { label: 'Bullet List', icon: List, prefix: '* ' },
    { label: 'Numbered List', icon: ListOrdered, prefix: '1. ' },
    { label: 'Task List', icon: CheckSquare, prefix: '- [ ] ' },
]

// We’ll access Editor’s methods via a template ref:
const editorRef = ref(null)

function handleImportSuccess() {
    console.log('Import successful')
}
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
