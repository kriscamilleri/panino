# In src/pages/HomePage.vue

<template>
    <div class="h-screen flex flex-col overflow-hidden" ref="container">
        <!-- Top Navbar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <!-- Left side -->
                <div class="flex items-center space-x-4">
                    <!-- View toggles -->
                    <button @click="ui.toggleViewMenu()"
                        class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                        :class="{ 'bg-gray-200': ui.showViewMenu }" title="Toggle View Menu">
                        <Layout class="w-4 h-4" />
                        <span>View</span>
                    </button>

                    <!-- Tools Menu -->
                    <button @click="ui.toggleActionBar()"
                        class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                        :class="{ 'bg-gray-200': ui.showActionBar }" title="Toggle Tools">
                        <Paintbrush class="w-4 h-4" />
                        <span>Format</span>
                    </button>

                    <!-- File Menu -->
                    <button @click="ui.toggleFileMenu()"
                        class="px-3 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                        :class="{ 'bg-gray-200': ui.showFileMenu }" title="Toggle File Menu">
                        <FileIcon class="w-4 h-4" />
                        <span>Tools</span>
                    </button>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-2">
                    <button @click="goToStyles"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <Palette class="w-4 h-4" />
                        <span>Styles</span>
                    </button>

                    <!-- Print button -->
                    <button @click="handlePrint"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        <Printer class="w-4 h-4" />
                        <span>Print</span>
                    </button>

                    <!-- Login/Logout button -->
                    <button v-if="!authStore.isAuthenticated" @click="goToLogin"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        Login
                    </button>
                    <button v-else @click="handleLogout"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                        Logout
                    </button>
                </div>
            </div>

            <!-- Submenu Bar -->
            <transition name="fade-fast" mode="out-in">
                <div v-if="ui.isAnyMenuOpen" class="border-t bg-gray-50 px-4 py-2">
                    <!-- View Menu Content -->
                    <div v-if="ui.showViewMenu" class="flex flex-wrap gap-2" key="view">
                        <button @click="ui.toggleSidebar()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showSidebar }">
                            <Folder class="w-4 h-4" />
                            <span>Sidebar</span>
                        </button>

                        <button @click="ui.toggleEditor()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showEditor }">
                            <Edit3 class="w-4 h-4" />
                            <span>Editor</span>
                        </button>

                        <button @click="ui.togglePreview()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1"
                            :class="{ 'bg-gray-200': ui.showPreview }">
                            <Eye class="w-4 h-4" />
                            <span>Preview</span>
                        </button>
                    </div>

                    <!-- Tools Menu Content -->
                    <div v-else-if="ui.showActionBar" class="flex flex-wrap gap-2" key="tools">
                        <!-- Text formatting tools -->
                        <div v-for="format in textFormats" :key="format.label"
                            @click="editorRef.insertFormat(format.prefix, format.suffix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                            :title="format.label">
                            <component :is="format.icon" class="w-4 h-4" />
                            <span>{{ format.label }}</span>
                        </div>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- List formatting tools -->
                        <div v-for="list in listFormats" :key="list.label" @click="editorRef.insertList(list.prefix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                            :title="list.label">
                            <component :is="list.icon" class="w-4 h-4" />
                            <span>{{ list.label }}</span>
                        </div>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Table and Code tools -->
                        <button @click="editorRef.insertTable"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            title="Insert Table">
                            <Table class="w-4 h-4" />
                            <span>Table</span>
                        </button>

                        <button @click="editorRef.insertCodeBlock"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            title="Insert Code Block">
                            <Code2 class="w-4 h-4" />
                            <span>Code</span>
                        </button>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Stats and Metadata toggles -->
                        <button @click="ui.toggleStats()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"
                            :class="{ 'bg-gray-200': ui.showStats }">
                            <BarChart2 class="w-4 h-4" />
                            <span>Stats</span>
                        </button>

                        <button @click="ui.toggleMetadata()"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center gap-1"
                            :class="{ 'bg-gray-200': ui.showMetadata }">
                            <Info class="w-4 h-4" />
                            <span>Info</span>
                        </button>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <!-- Search functionality -->
                        <div class="flex items-center gap-2">
                            <div class="relative">
                                <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                                <input type="text" placeholder="Find text..." v-model="searchTerm"
                                    class="border pl-7 pr-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500" />
                            </div>
                            <button @click="editorRef.findNext(searchTerm)"
                                class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                                <ArrowRight class="w-4 h-4" />
                                <span>Next</span>
                            </button>
                        </div>
                    </div>

                    <!-- File Menu Content -->
                    <div v-else-if="ui.showFileMenu" class="flex flex-wrap gap-2" key="file">
                        <button @click="showImportModal = true"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                            <Upload class="w-4 h-4" />
                            <span>Import</span>
                        </button>
                        <button @click="handleExport"
                            class="px-3 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1">
                            <Download class="w-4 h-4" />
                            <span>Export</span>
                        </button>
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
                    <Preview ref="previewRef" />
                </div>
            </div>
        </div>

        <!-- Hidden print container -->
        <div ref="printContainer" class="hidden"></div>
    </div>
    <ImportModal :show="showImportModal" @close="showImportModal = false" @import-success="handleImportSuccess" />
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import Sidebar from '@/components/SideBar.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import ImportModal from '@/components/ImportModal.vue'

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
    ArrowRight,
    FileIcon,
    Layout,
    Printer
} from 'lucide-vue-next'

const docStore = useDocStore()
const ui = useUiStore()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const container = ref(null)
const mainContent = ref(null)
const printContainer = ref(null)
const previewRef = ref(null)
const sidebarWidth = ref(300)
const editorWidth = ref(500)
const isResizing = ref(false)
const currentResizer = ref(null)
const startX = ref(0)
const startWidth = ref(0)
const showImportModal = ref(false)
const searchTerm = ref('')

// Print functionality
async function handlePrint() {
    if (!docStore.selectedFile) {
        alert('Please select a file to print')
        return
    }

    // Create a new window for printing
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
        alert('Please allow popup windows for printing')
        return
    }

    // Get the rendered content
    const content = previewRef.value.$el.innerHTML

    // Create print-friendly styles
    const printStyles = `
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                line-height: 1.6;
                max-width: 800px;
                margin: 40px auto;
                padding: 0 20px;
            }
            h1 { font-size: 2.5em; margin-bottom: 0.5em; }
            h2 { font-size: 2em; margin-bottom: 0.5em; }
            h3 { font-size: 1.5em; margin-bottom: 0.5em; }
            p { margin-bottom: 1em; }
            pre { 
                background: #f5f5f5;
                padding: 1em;
                border-radius: 4px;
                overflow-x: auto;
            }
            code {
                background: #f5f5f5;
                padding: 0.2em 0.4em;
                border-radius: 3px;
            }
            blockquote {
                border-left: 4px solid #ddd;
                padding-left: 1em;
                margin: 1em 0;
                color: #666;
            }
            table {
                border-collapse: collapse;
                width: 100%;
                margin: 1em 0;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                background-color: #f5f5f5;
            }
            img {
                max-width: 100%;
                height: auto;
            }
            @media print {
                body { margin: 1.6cm; }
                pre, code { white-space: pre-wrap; }
            }
        </style>
    `

    // Write content to print window
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${docStore.selectedFile.name}</title>
            ${printStyles}
        </head>
        <body>
            ${content}
        </body>
        </html>
    `)

    // Close the document writing
    printWindow.document.close()

    // Wait for all content to load
    printWindow.onload = () => {
        // Additional delay to ensure styles are applied and content is rendered
        setTimeout(() => {
            printWindow.print()
            // Handle closing after print
            printWindow.onafterprint = () => {
                printWindow.close()
            }
        }, 1000)
    }
}

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

// Editor's methods via template ref:
const editorRef = ref(null)

function handleImportSuccess() {
    console.log('Import successful')
}

async function handleLogout() {
    try {
        await authStore.logout()
        router.push('/login')
    } catch (err) {
        console.error('Error logging out:', err)
    }
}

function goToLogin() {
    router.push('/login')
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