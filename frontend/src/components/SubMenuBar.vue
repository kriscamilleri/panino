<!-- frontend/src/components/SubMenuBar.vue -->
<template>
    <transition name="fade-fast" mode="out-in">
        <div v-if="ui.isAnyMenuOpen"
            class="border-t bg-gray-50 px-4 py-2 min-h-[40px] flex items-center overflow-x-auto"
            data-testid="submenu-bar">

            <!-- =========== View menu =========== -->
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
                    <Palette class="w-4 h-4" /><span>Preview&nbsp;Styles</span>
                </BaseButton>
            </div>

            <!-- =========== Document / action bar =========== -->
            <div v-else-if="ui.showActionBar" class="flex flex-wrap gap-2" key="document">

                <!-- inline-format buttons -->
                <button v-for="fmt in textFormats" :key="fmt.label" @click="insertFormat(fmt)" :title="fmt.label"
                    :data-testid="`submenu-document-${fmt.label.toLowerCase()}`"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <component :is="fmt.icon" class="w-4 h-4" /><span>{{ fmt.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- list buttons -->
                <button v-for="ls in listFormats" :key="ls.label" @click="insertList(ls)" :title="ls.label"
                    :data-testid="`submenu-document-${ls.label.toLowerCase().replace(' ', '-')}`"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <component :is="ls.icon" class="w-4 h-4" /><span>{{ ls.label }}</span>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <!-- table / code block -->
                <button @click="insertTable" data-testid="submenu-document-table" title="Insert table"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <Table class="w-4 h-4" /><span>Table</span>
                </button>
                <button @click="insertCodeBlock" data-testid="submenu-document-code" title="Insert code block"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <Code2 class="w-4 h-4" /><span>Code</span>
                </button>

                <!-- images -->
                <div class="w-px h-6 bg-gray-300 mx-2"></div>
                <button @click="insertImagePlaceholder" data-testid="submenu-document-image-placeholder"
                    title="Insert image markdown"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <ImageIcon class="w-4 h-4" /><span>Image</span>
                </button>
                <button @click="openImageDialog" data-testid="submenu-document-image-upload"
                    title="Insert image from file"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                    <Upload class="w-4 h-4" /><span>Image&nbsp;from&nbsp;File</span>
                </button>
                <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="handleImageSelect" />

                <!-- find / replace -->
                <div class="w-px h-6 bg-gray-300 mx-2"></div>

                <div class="flex items-center gap-2">
                    <div class="relative">
                        <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                        <input v-model="searchTerm" @keyup.enter="findNext(searchTerm)" placeholder="Find…"
                            data-testid="submenu-document-search-input" class="border pl-7 pr-2 py-1 rounded text-sm w-36
                                      focus:outline-none focus:border-gray-500" />
                    </div>
                    <button @click="findNext(searchTerm)" data-testid="submenu-document-search-next"
                        class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                        <ArrowRight class="w-4 h-4" /><span>Next</span>
                    </button>

                    <!-- replace -->
                    <div class="flex items-center gap-1 ml-4">
                        <input id="replaceEnabled" type="checkbox" v-model="replaceEnabled"
                            data-testid="submenu-document-replace-checkbox" />
                        <label for="replaceEnabled" class="text-sm select-none">Replace</label>
                    </div>

                    <template v-if="replaceEnabled">
                        <input v-model="replaceTerm" @keyup.enter="replaceNext(searchTerm, replaceTerm)"
                            placeholder="Replacement…" data-testid="submenu-document-replace-input" class="border px-2 py-1 rounded text-sm w-36
                                      focus:outline-none focus:border-gray-500" />
                        <button @click="replaceNext(searchTerm, replaceTerm)"
                            data-testid="submenu-document-replace-next"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                            <Replace class="w-4 h-4" /><span>Go</span>
                        </button>
                        <button @click="replaceAll(searchTerm, replaceTerm)" data-testid="submenu-document-replace-all"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1">
                            <Replace class="w-4 h-4" /><span>All</span>
                        </button>
                    </template>
                </div>

                <!-- stats / meta -->
                <BaseButton :isActive="ui.showStats" @click="ui.toggleStats()" data-testid="submenu-document-stats">
                    <BarChart2 class="w-4 h-4" /><span>Stats</span>
                </BaseButton>
                <BaseButton :isActive="ui.showMetadata" @click="ui.toggleMetadata()"
                    data-testid="submenu-document-info">
                    <Info class="w-4 h-4" /><span>Info</span>
                </BaseButton>

                <div class="w-px h-6 bg-gray-300 mx-2"></div>
            </div>

            <!-- =========== Tools menu =========== -->
            <div v-else-if="ui.showFileMenu" class="flex flex-wrap gap-2" key="file">
                <BaseButton @click="ui.openImportModal()" data-testid="submenu-tools-import-json">
                    <Upload class="w-4 h-4" /><span>Import&nbsp;JSON</span>
                </BaseButton>
                <BaseButton @click="handleExport" data-testid="submenu-tools-export-json">
                    <FileJson class="w-4 h-4" /><span>Export&nbsp;JSON</span>
                </BaseButton>
                <BaseButton @click="handleExportZip" data-testid="submenu-tools-export-markdown">
                    <FolderArchive class="w-4 h-4" /><span>Export&nbsp;Markdown</span>
                </BaseButton>
                <BaseButton @click="handlePrint" data-testid="submenu-tools-print-document">
                    <Printer class="w-4 h-4" /><span>Print&nbsp;Document</span>
                </BaseButton>
                <BaseButton @click="goToPrintStyles" data-testid="submenu-tools-print-styles">
                    <Printer class="w-4 h-4" /><span>Print&nbsp;Styles</span>
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
    Folder, Edit3, Eye, Palette, Bold, Italic, Strikethrough, MessageSquare,
    List, ListOrdered, CheckSquare, Table, Code2, BarChart2, Info, Search,
    ArrowRight, Upload, FileJson, FolderArchive, Printer, Image as ImageIcon, Replace
} from 'lucide-vue-next'

const router = useRouter()
const ui = useUiStore()
const docStore = useDocStore()

/* ───────── inline-format presets ───────── */
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

/* ───────── editorRef helpers (exposed via window) ───────── */
function editorRef() { return window.__editorRef || {} }
const insertFormat = (f) => editorRef().insertFormat?.(f.prefix, f.suffix)
const insertList = (l) => editorRef().insertList?.(l.prefix)
const insertTable = () => editorRef().insertTable?.()
const insertCodeBlock = () => editorRef().insertCodeBlock?.()
const insertImagePlaceholder = () => editorRef().insertImagePlaceholder?.()

/* ───────── image upload dialog ───────── */
const imageInput = ref(null)
function openImageDialog() { imageInput.value?.click() }
function handleImageSelect(e) {
    const file = e.target.files[0]
    if (file) editorRef().uploadImage?.(file)
    e.target.value = ''
}

/* ───────── find / replace ───────── */
const searchTerm = ref('')
const replaceEnabled = ref(false)
const replaceTerm = ref('')
const findNext = (t) => editorRef().findNext?.(t)
const replaceNext = (t, r) => replaceEnabled.value && editorRef().replaceNext?.(t, r)
const replaceAll = (t, r) => replaceEnabled.value && editorRef().replaceAll?.(t, r)

/* ───────── navigation shortcuts ───────── */
function goToStyles() { router.push('/styles') }
function goToPrintStyles() { router.push('/print-styles') }

/* ───────── export helpers ───────── */
async function handleExport() {
    try {
        const jsonStr = await docStore.exportJson()
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'markdown-notes-export.json'; a.click()
        URL.revokeObjectURL(url)
    } catch (err) { console.error(err); alert('Failed to export JSON.') }
}
async function handleExportZip() {
    try { await docStore.exportZip() }
    catch (err) { console.error(err); alert('Failed to export ZIP.') }
}

/* ───────── updated PRINT handler (paged-media margin boxes) ───────── */
async function handlePrint() {
    if (!docStore.selectedFile) return alert('Please select a file to print')

    const w = window.open('', '_blank')
    if (!w) { alert('Please allow popup windows for printing'); return }

    const html = docStore.getPrintMarkdownIt().render(docStore.selectedFileContent || '')
    const ps = docStore.printStyles
    const mk = (type, val) => !val ? "''"
        : type === 'image' ? `url("${val}")`
            : `'${val.replace(/'/g, "\\'")}'`
    const pageCss = `
    <style>
      @page{
        size:auto; margin:1cm;
        @top-left    { content:${mk(ps.pageHeaderLeftType, ps.pageHeaderLeftContent)}; font-size:10pt; max-width:3cm; max-height:1cm; }
        @top-right   { content:${mk(ps.pageHeaderRightType, ps.pageHeaderRightContent)}; font-size:10pt; max-width:3cm; max-height:1cm; text-align:right; }
        @bottom-left { content:${mk(ps.pageFooterLeftType, ps.pageFooterLeftContent)}; font-size:8pt;  max-width:3cm; max-height:1cm; }
        @bottom-right{ content:${mk(ps.pageFooterRightType, ps.pageFooterRightContent)};font-size:8pt;  max-width:3cm; max-height:1cm; text-align:right; }
      }
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6;margin:0;padding:0;}
      .print-container{padding:1cm;max-width:800px;margin:auto;}
    </style>`
    w.document.write(`
    <!DOCTYPE html><html><head>
      <title>${docStore.selectedFile.name}</title>
      <link rel="stylesheet"
            href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css">
      ${pageCss}
    </head><body>
      <div class="print-container prose max-w-none">${html}</div>
    </body></html>`)
    w.document.close()
    w.onload = () => setTimeout(() => { w.print(); w.onafterprint = () => w.close() }, 500)
}
</script>

<style scoped>
.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity .15s;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}
</style>
