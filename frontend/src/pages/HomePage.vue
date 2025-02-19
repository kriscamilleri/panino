<template>
    <div class="h-screen flex flex-col overflow-hidden" ref="container">
        <!-- Top Navbar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <!-- Left side -->
                <div class="flex items-center space-x-4">
                    <!-- Format -->
                    <BaseButton :isActive="ui.showActionBar" @click="ui.toggleActionBar()" title="Toggle Format">
                        <Paintbrush class="md:w-4 md:h-4 w-5 h-5" />
                        <span class="hidden md:inline">Format</span>
                    </BaseButton>

                    <!-- View -->
                    <BaseButton :isActive="ui.showViewMenu" @click="ui.toggleViewMenu()" title="Toggle View Menu">
                        <Layout class="md:w-4 md:h-4 w-5 h-5" />
                        <span class="hidden md:inline">View</span>
                    </BaseButton>

                    <!-- Tools -->
                    <BaseButton :isActive="ui.showFileMenu" @click="ui.toggleFileMenu()" title="Toggle File Menu">
                        <FileIcon class="md:w-4 md:h-4 w-5 h-5" />
                        <span class="hidden md:inline">Tools</span>
                    </BaseButton>
                    <!-- Sync Button (replaces old checkbox) -->
                    <BaseButton v-if="authStore.isAuthenticated" :isActive="syncStore.syncEnabled"
                        @click="handleToggleSync" class="space-x-1" title="Toggle Sync">
                        <RefreshCw class="w-4 h-4" />
                        <span>Sync</span>
                    </BaseButton>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-4">
                    <!-- Desktop menu items -->
                    <div class="hidden md:flex items-center space-x-4">
                        <!-- Show user name if authenticated -->
                        <div v-if="authStore.isAuthenticated" class=" text-gray-500">
                            {{authStore.user?.name.replace(/\b\w/g, char => char.toUpperCase()) || 'Guest'}}
                        </div>

                        <!-- About link -->
                        <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                            class="flex items-center space-x-1 transition ">
                            <Info class="w-4 h-4" title="About" />
                            <span>About</span>
                        </a>

                        <!-- Login/Logout -->
                        <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin" class="space-x-1">
                            <LogIn class="w-4 h-4" title="Login" />
                            <span>Login</span>
                        </BaseButton>
                        <BaseButton v-else @click="handleLogout" class="space-x-1">
                            <LogOut class="w-4 h-4" title="Logout" />
                            <span>Logout</span>
                        </BaseButton>
                    </div>

                    <!-- Mobile hamburger menu -->
                    <div class="md:hidden">
                        <BaseButton @click="isMobileMenuOpen = !isMobileMenuOpen">
                            <Menu class="w-6 h-6" />
                        </BaseButton>
                    </div>
                </div>
            </div>

            <!-- Mobile menu -->
            <transition name="fade-fast" mode="out-in">
                <div v-if="isMobileMenuOpen" class="md:hidden border-t bg-gray-50">
                    <div class="px-4 py-2 space-y-2">
                        <!-- Show user name if authenticated -->
                        <div v-if="authStore.isAuthenticated" class="text-gray-500 py-2 px-2">
                            {{authStore.user?.name.replace(/\b\w/g, char => char.toUpperCase()) || 'Guest'}}
                        </div>

                        <!-- Sync Button (mobile) -->
                        <div v-if="authStore.isAuthenticated" class="px-2">
                            <BaseButton :isActive="syncStore.syncEnabled" @click="handleToggleSync"
                                class="w-full space-x-1">
                                <RefreshCw class="w-4 h-4" />
                                <span>Sync</span>
                            </BaseButton>
                        </div>

                        <!-- About link -->
                        <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                            class="flex items-center space-x-2 mx-2">
                            <Info class="w-4 h-4" title="About" />
                            <span>About</span>
                        </a>

                        <!-- Login/Logout -->
                        <div class="py-2">
                            <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin" class="w-full">
                                <LogIn class="w-4 h-4" title="Login" />
                                <span>Login</span>
                            </BaseButton>
                            <BaseButton v-else @click="handleLogout" class="w-full">
                                <LogOut class="w-4 h-4" title="Logout" />
                                <span>Logout</span>
                            </BaseButton>
                        </div>
                    </div>
                </div>
            </transition>

            <!-- Submenu Bar -->
            <transition name="fade-fast" mode="out-in">
                <div v-if="ui.isAnyMenuOpen"
                    class="border-t bg-gray-50 px-4 py-2 min-h-[40px] flex items-center overflow-x-auto">
                    <!-- View Menu Content -->
                    <div v-if="ui.showViewMenu" class="flex flex-wrap gap-2" key="view">
                        <BaseButton :isActive="ui.showDocuments" @click="ui.toggleDocuments()">
                            <Folder class="w-4 h-4" />
                            <span>Documents</span>
                        </BaseButton>

                        <BaseButton :isActive="ui.showEditor" @click="ui.toggleEditor()">
                            <Edit3 class="w-4 h-4" />
                            <span>Editor</span>
                        </BaseButton>

                        <BaseButton :isActive="ui.showPreview" @click="ui.togglePreview()">
                            <Eye class="w-4 h-4" />
                            <span>Preview</span>
                        </BaseButton>

                        <BaseButton @click="goToStyles">
                            <Palette class="w-4 h-4" />
                            <span>Preview Styles</span>
                        </BaseButton>
                    </div>

                    <!-- Format Menu Content -->
                    <div v-else-if="ui.showActionBar" class="flex flex-wrap gap-2" key="tools">
                        <div v-for="format in textFormats" :key="format.label"
                            @click="editorRef.insertFormat(format.prefix, format.suffix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                            :title="format.label">
                            <component :is="format.icon" class="w-4 h-4" />
                            <span>{{ format.label }}</span>
                        </div>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

                        <div v-for="list in listFormats" :key="list.label" @click="editorRef.insertList(list.prefix)"
                            class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                            :title="list.label">
                            <component :is="list.icon" class="w-4 h-4" />
                            <span>{{ list.label }}</span>
                        </div>

                        <div class="w-px h-6 bg-gray-300 mx-2"></div>

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

                        <BaseButton :isActive="ui.showStats" @click="ui.toggleStats()">
                            <BarChart2 class="w-4 h-4" />
                            <span>Stats</span>
                        </BaseButton>

                        <BaseButton :isActive="ui.showMetadata" @click="ui.toggleMetadata()">
                            <Info class="w-4 h-4" />
                            <span>Info</span>
                        </BaseButton>

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

                    <!-- Tools Menu Content -->
                    <div v-else-if="ui.showFileMenu" class="flex flex-wrap gap-2" key="file">
                        <BaseButton @click="showImportModal = true">
                            <Upload class="w-4 h-4" />
                            <span>Import JSON</span>
                        </BaseButton>

                        <BaseButton @click="handleExport">
                            <FileJson class="w-4 h-4" />
                            <span>Export JSON</span>
                        </BaseButton>

                        <BaseButton @click="handleExportZip">
                            <FolderArchive class="w-4 h-4" />
                            <span>Export Markdown</span>
                        </BaseButton>

                        <BaseButton @click="handlePrint">
                            <Printer class="w-4 h-4" />
                            <span>Print Document</span>
                        </BaseButton>

                        <BaseButton @click="goToPrintStyles">
                            <Printer class="w-4 h-4" />
                            <span>Print Styles</span>
                        </BaseButton>
                    </div>
                </div>
            </transition>
        </nav>

        <!-- Main content area -->
        <div class="flex flex-1 overflow-hidden flex-col md:flex-row" ref="mainContent">
            <!-- Documents (sidebar) with resizer -->
            <template v-if="ui.showDocuments">
                <div :class="{ 'w-full h-full': isMobileView, 'flex-shrink-0': !isMobileView }"
                    :style="!isMobileView ? { width: documentsWidth + 'px' } : {}"
                    class="bg-gray-100 border-r overflow-hidden">
                    <div class="h-full overflow-y-auto p-4">
                        <Documents />
                    </div>
                </div>
                <div v-if="!isMobileView" class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400"
                    @mousedown="startResize('sidebar', $event)"></div>
            </template>

            <!-- Content panes - only shown when Documents is not visible on mobile -->
            <template v-if="!isMobileView || !ui.showDocuments">
                <!-- If a folder is selected and no file, show FolderPreview -->
                <template v-if="docStore.selectedFolderId && !docStore.selectedFileId">
                    <div class="flex-1 overflow-hidden">
                        <FolderPreview :folderId="docStore.selectedFolderId" class="h-full overflow-y-auto" />
                    </div>
                </template>
                <!-- ELSE IF no folder selected & no file, show the 10 recent docs -->
                <template v-else-if="!docStore.selectedFolderId && !docStore.selectedFileId">
                    <div class="flex-1 overflow-hidden">
                        <FolderPreview folderId="__recent__" class="h-full overflow-y-auto" />
                    </div>
                </template>
                <!-- Otherwise, show normal Editor/Preview -->
                <template v-else>
                    <div class="flex flex-1 h-full overflow-hidden"
                        :class="{ 'flex-col': isMobileView, 'flex-row': !isMobileView }">
                        <div class="flex flex-col md:flex-row flex-1 overflow-hidden">
                            <!-- Editor (shown first on desktop) -->
                            <template v-if="ui.showEditor">
                                <div :class="{
                                    'h-1/2': isMobileView && ui.showPreview,
                                    'h-full': isMobileView && !ui.showPreview,
                                    'flex-shrink-0': !isMobileView
                                }" :style="!isMobileView ? { width: editorWidth + 'px' } : {}"
                                    class="w-full overflow-hidden order-2 md:order-1">
                                    <div class="h-full overflow-y-auto">
                                        <Editor ref="editorRef" />
                                    </div>
                                </div>
                                <div v-if="!isMobileView && ui.showPreview"
                                    class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400 order-1"
                                    @mousedown="startResize('editor', $event)"></div>
                            </template>

                            <!-- Preview -->
                            <div v-if="ui.showPreview" :class="{
                                'h-1/2': isMobileView && ui.showEditor,
                                'h-full': isMobileView && !ui.showEditor,
                                'flex-1': !isMobileView
                            }" class="w-full overflow-hidden order-1 md:order-2">
                                <div class="h-full overflow-y-auto p-4">
                                    <Preview ref="previewRef" />
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </template>
        </div>

        <!-- Hidden print container -->
        <div ref="printContainer" class="hidden"></div>

        <ImportModal :show="showImportModal" @close="showImportModal = false" @import-success="handleImportSuccess" />
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import Documents from '@/components/Documents.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import FolderPreview from '@/components/FolderPreview.vue'
import ImportModal from '@/components/ImportModal.vue'
import BaseButton from '@/components/BaseButton.vue'

import {
    Folder,
    Edit3,
    Eye,
    Paintbrush,
    Upload,
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
    Printer,
    LogIn,
    LogOut,
    FolderArchive,
    FileJson,
    Menu,
    RefreshCw
} from 'lucide-vue-next'

const docStore = useDocStore()
const ui = useUiStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()
const route = useRoute()

const container = ref(null)
const mainContent = ref(null)
const printContainer = ref(null)
const previewRef = ref(null)

const documentsWidth = ref(300)
const editorWidth = ref(500)
const lastKnownDocumentsWidth = ref(300)
const isResizing = ref(false)
const currentResizer = ref(null)
const startX = ref(0)
const startWidth = ref(0)
const showImportModal = ref(false)
const searchTerm = ref('')
const isMobileMenuOpen = ref(false)

const windowWidth = ref(window.innerWidth)
const isMobileView = computed(() => windowWidth.value < 768)

watch(
    () => route.params.fileId,
    (fileId) => {
        if (fileId) {
            docStore.selectFile(fileId)
        } else {
            docStore.selectFile(null)
        }
    },
    { immediate: true }
)

watch(isMobileView, (newValue, oldValue) => {
    if (!newValue && oldValue) {
        // Just left "mobile" mode => restore widths
        documentsWidth.value = lastKnownDocumentsWidth.value
        editorWidth.value = 500
    } else if (newValue) {
        // Entered "mobile" mode => expand docs to full width
        lastKnownDocumentsWidth.value = documentsWidth.value
        documentsWidth.value = window.innerWidth
    }
})

let resizeTimeout
onMounted(() => {
    function handleResize() {
        windowWidth.value = window.innerWidth
    }
    window.addEventListener('resize', handleResize)

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(() => {
            windowWidth.value = window.innerWidth
            adjustEditorWidthForContainer()
        }, 100)
    })
})

onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', stopResize)
    window.removeEventListener('resize', null)
    clearTimeout(resizeTimeout)
})

function adjustEditorWidthForContainer() {
    if (!mainContent.value || !ui.showEditor || isMobileView.value) return
    const containerWidth = mainContent.value.clientWidth
    const documentsTotalWidth = ui.showDocuments ? documentsWidth.value + 4 : 0
    const availableWidth = containerWidth - documentsTotalWidth
    if (editorWidth.value >= availableWidth - 50) {
        ui.showPreview = false
    }
}

function startResize(panel, event) {
    if (isMobileView.value) return
    isResizing.value = true
    currentResizer.value = panel
    startX.value = event.pageX
    startWidth.value = panel === 'sidebar' ? documentsWidth.value : editorWidth.value

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
            ui.showDocuments = false
            stopResize()
        } else {
            documentsWidth.value = newWidth
            adjustEditorWidthForContainer()
        }
    } else if (currentResizer.value === 'editor') {
        const newWidth = startWidth.value + diff
        const documentsTotalWidth = ui.showDocuments ? documentsWidth.value + 4 : 0
        const availableWidth = containerWidth - documentsTotalWidth

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

async function handlePrint() {
    if (!docStore.selectedFile) {
        alert('Please select a file to print')
        return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
        alert('Please allow popup windows for printing')
        return
    }
    const printMd = docStore.getPrintMarkdownIt()
    const content = printMd.render(docStore.selectedFileContent || '')

    const { printHeaderHtml = '', printFooterHtml = '' } = docStore.printStyles

    const basePrintStyles = `
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                line-height: 1.6;
                max-width: 800px;
                margin: 40px auto;
                padding: 0 20px;
            }
            @media print {
                body { margin: 1.6cm; }
                pre, code { white-space: pre-wrap; }
            }
        </style>
    `

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${docStore.selectedFile.name}</title>
            <link
                rel="stylesheet"
                href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css"
                integrity="sha512-wnea99uKIC3TJF7v4eKk4Y+lMz2Mklv18+r4na2Gn1abDRPPOeef95xTzdwGD9e6zXJBteMIhZ1+68QC5byJZw=="
                crossorigin="anonymous"
                referrerpolicy="no-referrer"
            />
            ${basePrintStyles}
        </head>
        <body>
            ${printHeaderHtml}
            ${content}
            ${printFooterHtml}
        </body>
        </html>
    `)

    printWindow.document.close()

    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print()
            printWindow.onafterprint = () => {
                printWindow.close()
            }
        }, 500)
    }
}

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

async function handleExportZip() {
    try {
        await docStore.exportZip()
    } catch (err) {
        console.error('Error exporting zip:', err)
        alert('Failed to export ZIP. Check console for details.')
    }
}

function goToStyles() {
    router.push('/styles')
}

const textFormats = [
    { label: 'Bold', icon: Bold, prefix: '**', suffix: '**' },
    { label: 'Italic', icon: Italic, prefix: '_', suffix: '_' },
    { label: 'Strike', icon: Strikethrough, prefix: '~~', suffix: '~~' },
    { label: 'Quote', icon: MessageSquare, prefix: '> ', suffix: '\n' }
]

const listFormats = [
    { label: 'Bullet List', icon: List, prefix: '* ' },
    { label: 'Numbered List', icon: ListOrdered, prefix: '1. ' },
    { label: 'Task List', icon: CheckSquare, prefix: '- [ ] ' }
]

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

function goToPrintStyles() {
    router.push('/print-styles')
}

/**
 * NEW: Toggle live sync manually.
 * If it's currently disabled, calling this will enable it (and start live sync).
 * If it's enabled, we disable it (stop sync).
 */
function handleToggleSync() {
    syncStore.setSyncEnabled(!syncStore.syncEnabled)
}
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
    transition: all 0.3s ease-out;
}

.slide-enter-from,
.slide-leave-to {
    transform: translateY(-20px);
    opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
