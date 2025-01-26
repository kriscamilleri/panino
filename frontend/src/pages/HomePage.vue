<template>
    <div class="h-screen flex flex-col overflow-hidden" ref="container">
        <!-- Top Navbar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <!-- Left side -->
                <div class="flex items-center space-x-4">
                    <!-- Format -->
                    <BaseButton :isActive="ui.showActionBar" @click="ui.toggleActionBar()" title="Toggle Format">
                        <Paintbrush class="w-4 h-4" />
                        <span>Format</span>
                    </BaseButton>

                    <!-- View -->
                    <BaseButton :isActive="ui.showViewMenu" @click="ui.toggleViewMenu()" title="Toggle View Menu">
                        <Layout class="w-4 h-4" />
                        <span>View</span>
                    </BaseButton>

                    <!-- Tools -->
                    <BaseButton :isActive="ui.showFileMenu" @click="ui.toggleFileMenu()" title="Toggle File Menu">
                        <FileIcon class="w-4 h-4" />
                        <span>Tools</span>
                    </BaseButton>
                </div>

                <!-- Right side -->
                <div class="flex items-center space-x-2">
                    <!-- About link -->
                    <BaseButton
                        @click="() => window.open('https://github.com/kriscamilleri/pn-markdown-notes', '_blank')"
                        title="About">
                        <Info class="w-4 h-4" />
                        <span>About</span>
                    </BaseButton>

                    <!-- Login/Logout -->
                    <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin">
                        <span>Login</span>
                    </BaseButton>
                    <BaseButton v-else @click="handleLogout">
                        <span>Logout</span>
                    </BaseButton>
                </div>
            </div>

            <!-- Submenu Bar -->
            <transition name="fade-fast" mode="out-in">
                <div v-if="ui.isAnyMenuOpen" class="border-t bg-gray-50 px-4 py-2 min-h-[40px] flex items-center">
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
                            <span>Import</span>
                        </BaseButton>

                        <BaseButton @click="handleExport">
                            <Download class="w-4 h-4" />
                            <span>Export</span>
                        </BaseButton>

                        <BaseButton @click="handlePrint">
                            <Printer class="w-4 h-4" />
                            <span>Print</span>
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
        <div class="flex flex-1 overflow-hidden" ref="mainContent">
            <!-- Documents (formerly Sidebar) with resizer -->
            <template v-if="ui.showDocuments">
                <div :style="{ width: documentsWidth + 'px' }"
                    class="flex-shrink-0 bg-gray-100 border-r overflow-hidden">
                    <div class="h-full overflow-y-auto p-4">
                        <Documents />
                    </div>
                </div>
                <div class="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-300 active:bg-blue-400"
                    @mousedown="startResize('sidebar', $event)"></div>
            </template>

            <!-- Editor with resizer -->
            <template v-if="ui.showEditor">
                <div :style="{ width: editorWidth + 'px' }" class="flex-shrink-0 overflow-hidden">
                    <div class="h-full overflow-y-auto">
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

        <ImportModal :show="showImportModal" @close="showImportModal = false" @import-success="handleImportSuccess" />
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import Documents from '@/components/Documents.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import ImportModal from '@/components/ImportModal.vue'
import BaseButton from '@/components/BaseButton.vue'

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

const documentsWidth = ref(300)
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

    // Instead of relying on preview HTML, render fresh with print styles:
    const printMd = docStore.getPrintMarkdownIt()
    const content = printMd.render(docStore.selectedFileContent || '')

    // Access user-defined header/footer from print styles
    const { printHeaderHtml = '', printFooterHtml = '' } = docStore.printStyles

    // Base print styles
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
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" integrity="sha512-wnea99uKIC3TJF7v4eKk4Y+lMz2Mklv18+r4na2Gn1abDRPPOeef95xTzdwGD9e6zXJBteMIhZ1+68QC5byJZw==" crossorigin="anonymous" referrerpolicy="no-referrer" />
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

// Watch route params -> open correct file
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

// Panel resizing & toggles
function adjustEditorWidthForContainer() {
    if (!mainContent.value || !ui.showEditor) return
    const containerWidth = mainContent.value.clientWidth
    const documentsTotalWidth = ui.showDocuments ? documentsWidth.value + 4 : 0
    const availableWidth = containerWidth - documentsTotalWidth
    if (editorWidth.value >= availableWidth - 50) {
        ui.showPreview = false
    }
}

function startResize(panel, event) {
    isResizing.value = true
    currentResizer.value = panel
    startX.value = event.pageX
    startWidth.value = (panel === 'sidebar') ? documentsWidth.value : editorWidth.value

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
