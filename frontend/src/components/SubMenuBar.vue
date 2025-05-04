<!-- frontend/src/components/SubMenuBar.vue -->
<template>
    <transition name="fade-fast" mode="out-in">
        <div v-if="ui.isAnyMenuOpen"
            class="border-t bg-gray-50 px-4 py-2 min-h-[40px] flex items-center overflow-x-auto"
            data-testid="submenu-bar">
            <!-- ─────────────────────── View Menu ─────────────────────── -->
            <div v-if="ui.showViewMenu" class="flex flex-wrap gap-2" key="view">
                <BaseButton :isActive="ui.showDocuments" @click="ui.toggleDocuments()"
                    data-testid="submenu-view-documents">
                    <Folder class="w-4 h-4" /><span>Documents</span>
                </BaseButton>

                <BaseButton :isActive="ui.showEditor" @click="ui.toggleEditor()" data-testid="submenu-view-editor">
                    <Edit3 class="w-4 h-4" /><span>Editor</span>
                </BaseButton>

                <BaseButton :isActive="ui.showPreview" @click="ui.togglePreview()" data-testid="submenu-view-preview">
                    <Eye class="w-4 h-4" /><span>Preview</span>
                </BaseButton>

                <BaseButton @click="goToStyles" data-testid="submenu-view-styles">
                    <Palette class="w-4 h-4" /><span>Preview Styles</span>
                </BaseButton>
            </div>

            <!-- ──────────────── Document Menu (was Format) ─────────────── -->
            <div v-else-if="ui.showActionBar" class="flex flex-wrap gap-2" key="document">
                <!-- Text formatting -->
                <button v-for="format in textFormats" :key="format.label" @click="insertFormat(format)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                    :title="format.label" :data-testid="`submenu-document-${format.label.toLowerCase()}`">
                    <component :is="format.icon" class="w-4 h-4" /><span>{{ format.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- Lists -->
                <button v-for="list in listFormats" :key="list.label" @click="insertList(list)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1 cursor-pointer"
                    :title="list.label" :data-testid="`submenu-document-${list.label.toLowerCase().replace(' ', '-')}`">
                    <component :is="list.icon" class="w-4 h-4" /><span>{{ list.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- Table / Code -->
                <button @click="insertTable"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Table" data-testid="submenu-document-table">
                    <Table class="w-4 h-4" /><span>Table</span>
                </button>

                <button @click="insertCodeBlock"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Code Block" data-testid="submenu-document-code">
                    <Code2 class="w-4 h-4" /><span>Code</span>
                </button>

                <!-- Images -->
                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <button @click="insertImagePlaceholder"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Image Markdown" data-testid="submenu-document-image-placeholder">
                    <ImageIcon class="w-4 h-4" /><span>Image</span>
                </button>

                <button @click="openImageDialog"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                    title="Insert Image From File" data-testid="submenu-document-image-upload">
                    <Upload class="w-4 h-4" /><span>Image&nbsp;from&nbsp;File</span>
                </button>
                <!-- hidden file input -->
                <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="handleImageSelect" />

                <div class="w-px h-6 bg-gray-300 mx-2"></div>



                <!-- Find / Replace -->
                <div class="flex items-center gap-2">
                    <!-- Find -->
                    <div class="relative">
                        <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                        <input type="text" placeholder="Find..." v-model="searchTerm"
                            class="border pl-7 pr-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500"
                            data-testid="submenu-document-search-input" @keyup.enter="findNext(searchTerm)" />
                    </div>
                    <button @click="findNext(searchTerm)"
                        class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                        data-testid="submenu-document-search-next">
                        <ArrowRight class="w-4 h-4" /><span>Next</span>
                    </button>

                    <!-- Replace checkbox -->
                    <div class="flex items-center gap-1 ml-4">
                        <input id="replaceEnabled" type="checkbox" v-model="replaceEnabled"
                            data-testid="submenu-document-replace-checkbox" />
                        <label for="replaceEnabled" class="text-sm select-none">Replace</label>
                    </div>

                    <!-- Replace controls (only when enabled) -->
                    <template v-if="replaceEnabled">
                        <input type="text" placeholder="Replacement…" v-model="replaceTerm"
                            class="border px-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500"
                            data-testid="submenu-document-replace-input"
                            @keyup.enter="replaceNext(searchTerm, replaceTerm)" />

                        <button @click="replaceNext(searchTerm, replaceTerm)"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            data-testid="submenu-document-replace-next">
                            <Replace class="w-4 h-4" /><span>Go</span>
                        </button>

                        <button @click="replaceAll(searchTerm, replaceTerm)"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1"
                            data-testid="submenu-document-replace-all">
                            <Replace class="w-4 h-4" /><span>All</span>
                        </button>
                    </template>
                </div>
                <!-- Stats / Info -->
                <BaseButton :isActive="ui.showStats" @click="ui.toggleStats()" data-testid="submenu-document-stats">
                    <BarChart2 class="w-4 h-4" /><span>Stats</span>
                </BaseButton>
                <BaseButton :isActive="ui.showMetadata" @click="ui.toggleMetadata()"
                    data-testid="submenu-document-info">
                    <Info class="w-4 h-4" /><span>Info</span>
                </BaseButton>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>
            </div>

            <!-- ─────────────────────── Tools Menu ─────────────────────── -->
            <div v-else-if="ui.showFileMenu" class="flex flex-wrap gap-2" key="file">
                <BaseButton @click="ui.openImportModal()" data-testid="submenu-tools-import-json">
                    <Upload class="w-4 h-4" /><span>Import JSON</span>
                </BaseButton>

                <BaseButton @click="handleExport" data-testid="submenu-tools-export-json">
                    <FileJson class="w-4 h-4" /><span>Export JSON</span>
                </BaseButton>

                <BaseButton @click="handleExportZip" data-testid="submenu-tools-export-markdown">
                    <FolderArchive class="w-4 h-4" /><span>Export Markdown</span>
                </BaseButton>

                <BaseButton @click="handlePrint" data-testid="submenu-tools-print-document">
                    <Printer class="w-4 h-4" /><span>Print Document</span>
                </BaseButton>

                <BaseButton @click="goToPrintStyles" data-testid="submenu-tools-print-styles">
                    <Printer class="w-4 h-4" /><span>Print Styles</span>
                </BaseButton>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
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
    Printer,
    Image as ImageIcon,
    Replace
} from 'lucide-vue-next'

const ui = useUiStore()
const docStore = useDocStore()
const router = useRouter()

/* ───────── state ───────── */
const searchTerm = ref('')
const replaceEnabled = ref(false)
const replaceTerm = ref('')
const imageInput = ref(null)

/* ───────── presets ───────── */
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

/* ───────── helpers ───────── */
function editorRef() {
    return window.__editorRef || {}
}

function insertFormat(f) {
    editorRef().insertFormat?.(f.prefix, f.suffix)
}
function insertList(l) {
    editorRef().insertList?.(l.prefix)
}
function insertTable() {
    editorRef().insertTable?.()
}
function insertCodeBlock() {
    editorRef().insertCodeBlock?.()
}
function insertImagePlaceholder() {
    editorRef().insertImagePlaceholder?.()
}

function openImageDialog() {
    imageInput.value?.click()
}
function handleImageSelect(e) {
    const file = e.target.files[0]
    if (file) {
        editorRef().uploadImage?.(file)
        e.target.value = ''
    }
}

/* Find / replace */
function findNext(term) {
    editorRef().findNext?.(term)
}
function replaceNext(term, repl) {
    if (!replaceEnabled.value) return
    editorRef().replaceNext?.(term, repl)
}
function replaceAll(term, repl) {
    if (!replaceEnabled.value) return
    editorRef().replaceAll?.(term, repl)
}

/* Navigation & exports (unchanged) */
function goToStyles() {
    router.push('/styles')
}
function goToPrintStyles() {
    router.push('/print-styles')
}
async function handleExport() {
    try {
        const jsonString = await docStore.exportJson()
        const blob = new Blob([jsonString], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'markdown-notes-export.json'
        a.click()
        URL.revokeObjectURL(url)
    } catch (err) {
        console.error(err)
        alert('Failed to export JSON.')
    }
}
async function handleExportZip() {
    try {
        await docStore.exportZip()
    } catch (err) {
        console.error(err)
        alert('Failed to export ZIP.')
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