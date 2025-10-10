<template>
    <transition name="fade-fast" mode="out-in">
        <div v-if="ui.isAnyMenuOpen"
            class="border-t bg-gray-50 px-4 py-2 min-h-14 flex items-center overflow-x-auto"
            data-testid="submenu-bar">
            <div v-if="ui.showViewMenu" class="flex flex-wrap items-center gap-2" key="view">
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
                    <Palette class="w-4 h-4" /><span>Styles</span>
                </BaseButton>
            </div>

            <div v-else-if="ui.showActionBar" class="flex flex-wrap items-center gap-2"
                :class="{ 'editor-menu-collapsed': ui.editorMenuCollapsed }" key="editor">
                <button v-for="format in textFormats" :key="format.label" @click="insertFormat(format)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5 cursor-pointer"
                    :title="format.label" :data-testid="`submenu-editor-${format.label.toLowerCase()}`">
                    <component :is="format.icon" class="w-4 h-4" />
                    <span class="button-text">{{ format.label }}</span>
                </button>

                <div class="separator"></div>

                <button v-for="list in listFormats" :key="list.label" @click="insertList(list)"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5 cursor-pointer"
                    :title="list.label" :data-testid="`submenu-editor-${list.label.toLowerCase().replace(' ', '-')}`">
                    <component :is="list.icon" class="w-4 h-4" />
                    <span class="button-text">{{ list.label }}</span>
                </button>

                <div class="separator"></div>

                <button @click="insertTable"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                    title="Insert Table" data-testid="submenu-editor-table">
                    <Table class="w-4 h-4" />
                    <span class="button-text">Table</span>
                </button>

                <button @click="insertCodeBlock"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                    title="Insert Code Block" data-testid="submenu-editor-code">
                    <Code2 class="w-4 h-4" />
                    <span class="button-text">Code</span>
                </button>

                <div class="separator"></div>

                <button @click="insertImagePlaceholder"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                    title="Insert Image Markdown" data-testid="submenu-editor-image-placeholder">
                    <ImageIcon class="w-4 h-4" />
                    <span class="button-text">Image</span>
                </button>

                <button @click="openImageDialog"
                    class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                    title="Upload and Insert Image" data-testid="submenu-editor-image-upload">
                    <Upload class="w-4 h-4" />
                    <span class="button-text">Image&nbsp;from&nbsp;File</span>
                </button>
                <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="handleImageSelect" />

                <div class="separator"></div>

                <div class="flex items-center gap-2">
                    <div class="relative">
                        <Search class="absolute left-2 top-1.5 w-4 h-4 text-gray-400" />
                        <input type="text" placeholder="Find..." v-model="searchTerm"
                            class="border pl-7 pr-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500"
                            data-testid="submenu-editor-search-input" @keyup.enter="findNext(searchTerm)" />
                    </div>
                    <button @click="findNext(searchTerm)"
                        class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                        title="Find Next" data-testid="submenu-editor-search-next">
                        <ArrowRight class="w-4 h-4" />
                        <span class="button-text">Next</span>
                    </button>

                    <BaseButton :isActive="replaceEnabled" @click="replaceEnabled = !replaceEnabled"
                        data-testid="submenu-editor-replace-toggle" title="Toggle Replace" class="text-sm">
                        <ToggleLeft v-if="!replaceEnabled" class="w-4 h-4" />
                        <ToggleRight v-else class="w-4 h-4" />
                        <span class="button-text">Replace</span>
                    </BaseButton>

                    <template v-if="replaceEnabled">
                        <input type="text" placeholder="Replacement…" v-model="replaceTerm"
                            class="border px-2 py-1 rounded text-sm w-36 focus:outline-none focus:border-gray-500"
                            data-testid="submenu-editor-replace-input"
                            @keyup.enter="replaceNext(searchTerm, replaceTerm)" />

                        <button @click="replaceNext(searchTerm, replaceTerm)"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                            title="Replace Next" data-testid="submenu-editor-replace-next">
                            <Replace class="w-4 h-4" />
                            <span class="button-text">Go</span>
                        </button>

                        <button @click="replaceAll(searchTerm, replaceTerm)"
                            class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm flex items-center gap-1.5"
                            title="Replace All" data-testid="submenu-editor-replace-all">
                            <Replace class="w-4 h-4" />
                            <span class="button-text">All</span>
                        </button>
                    </template>
                </div>

                <div class="separator"></div>

                <BaseButton :isActive="ui.showStats" @click="ui.toggleStats()" data-testid="submenu-editor-stats"
                    title="Toggle Stats" class="text-sm">
                    <BarChart2 class="w-4 h-4" />
                    <span class="button-text">Stats</span>
                </BaseButton>
                <BaseButton :isActive="ui.showMetadata" @click="ui.toggleMetadata()"
                    data-testid="submenu-editor-info" title="Toggle Info" class="text-sm">
                    <Info class="w-4 h-4" />
                    <span class="button-text">Info</span>
                </BaseButton>

                <div class="separator"></div>

                <BaseButton :isActive="ui.editorMenuCollapsed" @click="ui.toggleEditorMenuCollapsed()"
                    title="Collapse/Expand Menu" data-testid="submenu-editor-collapse" class="text-sm">
                    <PanelLeftClose v-if="!ui.editorMenuCollapsed" class="w-4 h-4" />
                    <PanelLeftOpen v-else class="w-4 h-4" />
                    <span class="button-text">Collapse</span>
                </BaseButton>

            </div>

            <div v-else-if="ui.showFileMenu" class="flex flex-wrap items-center gap-2" key="file">
                <BaseButton :disabled="printDisabled" :title="printDisabled ? 'Select a document to enable printing' : 'Customize print styles'" @click="goToPrintStyles" data-testid="submenu-tools-print">
                    <Printer class="w-4 h-4" /><span>Print</span>
                </BaseButton>

                <BaseButton @click="ui.openImportModal()" data-testid="submenu-tools-import">
                    <Upload class="w-4 h-4" /><span>Import</span>
                </BaseButton>

                <BaseButton @click="ui.openExportModal()" data-testid="submenu-tools-export">
                    <Download class="w-4 h-4" /><span>Export</span>
                </BaseButton>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from '@/store/uiStore'
import { useEditorStore } from '@/store/editorStore'
import { storeToRefs } from 'pinia'
import { useDocStore } from '@/store/docStore'
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
    Download,
    Printer,
    Image as ImageIcon,
    Replace,
    PanelLeftClose,
    PanelLeftOpen,
    ToggleLeft,
    ToggleRight,
} from 'lucide-vue-next'

const ui = useUiStore()
const editorStore = useEditorStore()
const router = useRouter()
const docStore = useDocStore()
const { selectedFileId } = storeToRefs(docStore)
const printDisabled = computed(() => !selectedFileId.value)

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
function insertFormat(f) {
    editorStore.insertFormat(f.prefix, f.suffix)
}
function insertList(l) {
    editorStore.insertList(l.prefix)
}
function insertTable() {
    editorStore.insertTable()
}
function insertCodeBlock() {
    editorStore.insertCodeBlock()
}
function insertImagePlaceholder() {
    editorStore.insertImagePlaceholder()
}

function openImageDialog() {
    imageInput.value?.click()
}
function handleImageSelect(e) {
    const file = e.target.files[0]
    if (file) {
        editorStore.uploadImage(file)
        e.target.value = ''
    }
}

/* Find / replace */
function findNext(term) {
    editorStore.findNext(term)
}
function replaceNext(term, repl) {
    if (!replaceEnabled.value) return
    editorStore.replaceNext(term, repl)
}
function replaceAll(term, repl) {
    if (!replaceEnabled.value) return
    editorStore.replaceAll(term, repl)
}

/* Navigation & exports */
function goToStyles() {
    router.push('/styles')
}
function goToPrintStyles() {
    router.push('/print-styles')
}
</script>

<style scoped>
.separator {
    width: 1px;
    height: 1.5rem;
    /* 24px */
    background-color: #d1d5db;
    /* gray-300 */
    margin-left: 0.5rem;
    margin-right: 0.5rem;
}

.editor-menu-collapsed .button-text,
.editor-menu-collapsed label[for="replaceEnabled"] {
    display: none;
}

.editor-menu-collapsed button,
.editor-menu-collapsed .BaseButton {
    padding-left: 0.5rem;
    /* 8px */
    padding-right: 0.5rem;
    /* 8px */
}

/* Target the span inside the slotted BaseButton */
.editor-menu-collapsed :deep(.BaseButton span) {
    display: none;
}
</style>