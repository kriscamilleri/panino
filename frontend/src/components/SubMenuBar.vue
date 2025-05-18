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
import { createPdfExporter } from '@/utils/pdfExporter'
import { processHeaderFooterImages, preProcessHtmlImages } from '@/utils/pdfImageUtils'



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


/* ───────── updated PRINT handler for paged-media margin boxes with base64 images ───────── */
async function handlePrint() {
    if (!docStore.selectedFile) {
        return alert('Please select a file to print')
    }

    try {
        // Show loading indicator
        const loadingEl = document.createElement('div');
        loadingEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;';
        loadingEl.innerHTML = `
      <div style="text-align:center;background:white;padding:20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <div style="display:inline-block;width:50px;height:50px;border:3px solid rgba(0,0,0,.3);border-radius:50%;border-top-color:#000;animation:spin 1s linear infinite;margin-bottom:10px;"></div>
        <p style="margin:0;font-family:system-ui,-apple-system,sans-serif;">Preparing document...</p>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </div>
    `;
        document.body.appendChild(loadingEl);



        // Generate HTML content from markdown
        const markdown = docStore.selectedFileContent || '';
        const html = docStore.getPrintMarkdownIt().render(markdown);

        // Get print styles
        const ps = docStore.printStyles || {};

        // Process header and footer images
        const { headerContent, footerContent } = await processHeaderFooterImages(ps);

        // Prepare full HTML with styling
        const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${docStore.selectedFile.name}</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.5;
            color: #333;
            margin: 0;
            padding: 0;
          }
          
          .pdf-content {
            max-width: 100%;
            margin: 0 auto;
            padding: 10px;
          }
          
          /* Apply all print styles */
          ${Object.entries(ps)
                .filter(([key]) => !key.startsWith('page') && typeof ps[key] === 'string')
                .map(([tag, classes]) => {
                    // Convert Tailwind classes to inline styles (simplified)
                    const style = classes
                        .replace(/text-(\w+)/g, 'font-size: $1;')
                        .replace(/font-(\w+)/g, 'font-weight: $1;')
                        .replace(/my-(\d+)/g, 'margin-top: $1em; margin-bottom: $1em;')
                        .replace(/mb-(\d+)/g, 'margin-bottom: $1em;')
                        .replace(/mt-(\d+)/g, 'margin-top: $1em;')
                        .replace(/px-(\d+)/g, 'padding-left: $1em; padding-right: $1em;')
                        .replace(/py-(\d+)/g, 'padding-top: $1em; padding-bottom: $1em;')
                        .replace(/border/g, 'border: 1px solid #ddd;')
                        .replace(/rounded/g, 'border-radius: 0.25em;')
                        .replace(/block/g, 'display: block;')
                        .replace(/max-w-full/g, 'max-width: 100%;')
                        .replace(/bg-gray-\d+/g, 'background-color: #f9f9f9;')
                        .replace(/text-gray-\d+/g, 'color: #666;')
                        .replace(/text-blue-\d+/g, 'color: #3182ce;')
                        .replace(/font-mono/g, 'font-family: monospace;');

                    return `${tag} { ${style} }`;
                })
                .join('\n')}
          
          /* Special styles for code blocks */
          pre {
            white-space: pre-wrap;
            word-break: break-word;
            padding: 1em;
            background-color: #f7f7f7;
            border-radius: 4px;
            overflow-x: auto;
          }
          
          /* Image handling */
          img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 1em auto;
          }
          
          /* Table styles */
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
          }
          
          th, td {
            border: 1px solid #ddd;
            padding: 0.5em;
          }
          
          th {
            background-color: #f0f0f0;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="pdf-content">
          ${html}
        </div>
      </body>
      </html>
    `;

        // Pre-process HTML to handle images
        const processedHtml = await preProcessHtmlImages(fullHtml);

        // Create PDF exporter
        const exporter = createPdfExporter({
            margins: { top: 50, right: 30, bottom: 50, left: 30 },
            pageSize: 'a4'
        });

        // Preview PDF
        await exporter.previewPDF(processedHtml, {
            title: docStore.selectedFile.name,
            headerContent,
            footerContent
        });

        // Remove loading indicator
        document.body.removeChild(loadingEl);

    } catch (err) {
        console.error('Error preparing document for print:', err);
        alert('Failed to generate PDF. ' + (err.message || 'Unknown error'));

        // Remove loading indicator if it exists
        const loadingEl = document.querySelector('div[style*="position:fixed"]');
        if (loadingEl) {
            document.body.removeChild(loadingEl);
        }
    }
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
