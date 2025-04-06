<!-- frontend/src/components/SubMenuBar.vue -->
<template>
    <!-- The container that shows/hides based on ui.isAnyMenuOpen -->
    <transition name="fade-fast" mode="out-in">
        <div v-if="ui.isAnyMenuOpen"
            class="border-t bg-gray-50 px-4 py-2 min-h-[40px] flex items-center overflow-x-auto"
            data-testid="submenu-bar">
            <!-- View Menu Content -->
            <div v-if="ui.showViewMenu" class="flex flex-wrap gap-2" key="view">
                <BaseButton :isActive="ui.showDocuments" @click="ui.toggleDocuments()"
                    data-testid="submenu-view-documents">
                    <Folder class="w-4 h-4" />
                    <span>Documents</span>
                </BaseButton>

                <BaseButton :isActive="ui.showEditor" @click="ui.toggleEditor()" data-testid="submenu-view-editor">
                    <Edit3 class="w-4 h-4" />
                    <span>Editor</span>
                </BaseButton>

                <BaseButton :isActive="ui.showPreview" @click="ui.togglePreview()" data-testid="submenu-view-preview">
                    <Eye class="w-4 h-4" />
                    <span>Preview</span>
                </BaseButton>

                <BaseButton @click="goToStyles" data-testid="submenu-view-styles">
                    <Palette class="w-4 h-4" />
                    <span>Preview Styles</span>
                </BaseButton>
            </div>

            <!-- Format Menu Content -->
            <div v-else-if="ui.showActionBar" class="flex flex-wrap gap-2" key="tools">
                <!-- Text Formats -->
                <button v-for="format in textFormats" :key="format.label" @click="insertFormat(format)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                    :title="format.label" :data-testid="`submenu-format-${format.label.toLowerCase()}`">
                    <component :is="format.icon" class="w-4 h-4" />
                    <span>{{ format.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- List Formats -->
                <button v-for="list in listFormats" :key="list.label" @click="insertList(list)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                    :title="list.label" :data-testid="`submenu-format-${list.label.toLowerCase().replace(' ', '-')}`">
                    <component :is="list.icon" class="w-4 h-4" />
                    <span>{{ list.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- Table / Code -->
                <button @click="insertTable"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Table" data-testid="submenu-format-table">
                    <Table class="w-4 h-4" />
                    <span>Table</span>
                </button>

                <button @click="insertCodeBlock"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Code Block" data-testid="submenu-format-code">
                    <Code2 class="w-4 h-4" />
                    <span>Code</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- Stats / Info -->
                <BaseButton :isActive="ui.showStats" @click="ui.toggleStats()" data-testid="submenu-format-stats">
                    <BarChart2 class="w-4 h-4" />
                    <span>Stats</span>
                </BaseButton>

                <BaseButton :isActive="ui.showMetadata" @click="ui.toggleMetadata()" data-testid="submenu-format-info">
                    <Info class="w-4 h-4" />
                    <span>Info</span>
                </BaseButton>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- Search functionality -->
                <div class="flex items-center gap-2">
                    <div class="relative">
                        <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                        <input type="text" placeholder="Find text..." v-model="searchTerm"
                            class="border pl-7 pr-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500"
                            data-testid="submenu-format-search-input" @keyup.enter="findNext(searchTerm)" />
                    </div>
                    <button @click="findNext(searchTerm)"
                        class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                        data-testid="submenu-format-search-next">
                        <ArrowRight class="w-4 h-4" />
                        <span>Next</span>
                    </button>
                </div>
            </div>

            <!-- Tools Menu Content -->
            <div v-else-if="ui.showFileMenu" class="flex flex-wrap gap-2" key="file">
                <!-- Use ui.openImportModal() instead of local state -->
                <BaseButton @click="ui.openImportModal()" data-testid="submenu-tools-import-json">
                    <Upload class="w-4 h-4" />
                    <span>Import JSON</span>
                </BaseButton>

                <BaseButton @click="handleExport" data-testid="submenu-tools-export-json">
                    <FileJson class="w-4 h-4" />
                    <span>Export JSON</span>
                </BaseButton>

                <BaseButton @click="handleExportZip" data-testid="submenu-tools-export-markdown">
                    <FolderArchive class="w-4 h-4" />
                    <span>Export Markdown</span>
                </BaseButton>

                <BaseButton @click="handlePrint" data-testid="submenu-tools-print-document">
                    <Printer class="w-4 h-4" />
                    <span>Print Document</span>
                </BaseButton>

                <BaseButton @click="goToPrintStyles" data-testid="submenu-tools-print-styles">
                    <Printer class="w-4 h-4" />
                    <span>Print Styles</span>
                </BaseButton>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { ref } from 'vue' // Removed 'computed' as we no longer need local showImportModal
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore' // Import uiStore
import { useAuthStore } from '@/store/authStore'

import BaseButton from '@/components/BaseButton.vue'

import {
    Folder,
    Edit3,
    Eye,
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
    Upload,
    FileJson,
    FolderArchive,
    Printer
} from 'lucide-vue-next'

// Stores
const ui = useUiStore() // Initialize uiStore
const docStore = useDocStore()
const authStore = useAuthStore()
const router = useRouter()

// Local states
// Removed: const showImportModal = ref(false)
const searchTerm = ref('')

// Hard-coded formats (taken from original)
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

// Methods for menu actions
function goToStyles() {
    router.push('/styles')
}

function insertFormat(format) {
    // Insert text around selection, e.g. **bold** or > quote
    // This would require referencing an editor instance.
    // Typically you'd do `editorRef.value.insertFormat(format.prefix, format.suffix)`
    // For now let's assume docStore or some global method:
    const editor = window.__editorRef // (example hack) or inject from parent
    if (editor && editor.insertFormat) {
        editor.insertFormat(format.prefix, format.suffix)
    }
}

function insertList(list) {
    const editor = window.__editorRef
    if (editor && editor.insertList) {
        editor.insertList(list.prefix)
    }
}

function insertTable() {
    const editor = window.__editorRef
    editor?.insertTable()
}

function insertCodeBlock() {
    const editor = window.__editorRef
    editor?.insertCodeBlock()
}

function findNext(term) {
    const editor = window.__editorRef
    editor?.findNext(term)
}
async function handleExport() {
    try {
        // Wait for the promise to resolve and get the actual JSON string
        const jsonString = await docStore.exportJson();

        // Verify we have a valid string before creating the blob
        if (typeof jsonString !== 'string') {
            throw new Error('Export returned invalid data type: ' + typeof jsonString);
        }

        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'markdown-notes-export.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error exporting JSON:', err);
        alert('Failed to export JSON: ' + err.message);
    }
}
async function handleExportZip() {
    try {
        await docStore.exportZip()
    } catch (err) {
        console.error('Error exporting zip:', err)
        alert('Failed to export ZIP. Check console for details.')
    }
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

function goToPrintStyles() {
    router.push('/print-styles')
}

</script>

<style scoped>
.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity 0.15s;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}
</style>