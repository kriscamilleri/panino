# In src/components/ImportModal.vue

<template>
    <div
        v-if="show"
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="import-modal-container"
    >
        <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <!-- Header -->
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">
                        {{ activeMode ? modeTitles[activeMode] : 'Import Data' }}
                    </h3>
                    <button
                        @click="handleClose"
                        class="text-gray-400 hover:text-gray-600 transition-colors"
                        data-testid="import-modal-close-button"
                    >
                        <X class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <!-- Body -->
            <div class="px-6 py-4 flex-1 overflow-y-auto">

                <!-- ── Format selector (main view) ── -->
                <div v-if="!activeMode" class="space-y-3">
                    <button
                        @click="selectMode('markdown')"
                        class="w-full text-left border rounded-lg p-4 hover:bg-gray-50 transition-colors group"
                        data-testid="import-mode-markdown"
                    >
                        <div class="flex items-start gap-3">
                            <FileText class="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
                            <div>
                                <p class="font-medium text-gray-800 group-hover:text-gray-900">Markdown Files (.md)</p>
                                <p class="text-sm text-gray-500 mt-0.5">Import one or more markdown files and update matching notes in place.</p>
                            </div>
                        </div>
                    </button>

                    <button
                        @click="selectMode('directory')"
                        class="w-full text-left border rounded-lg p-4 hover:bg-gray-50 transition-colors group"
                        data-testid="import-mode-directory"
                    >
                        <div class="flex items-start gap-3">
                            <FolderOpen class="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
                            <div>
                                <p class="font-medium text-gray-800 group-hover:text-gray-900">Markdown Folder</p>
                                <p class="text-sm text-gray-500 mt-0.5">Import a directory of .md files, preserving folder structure and updating matching notes.</p>
                            </div>
                        </div>
                    </button>

                    <button
                        @click="selectMode('zip')"
                        class="w-full text-left border rounded-lg p-4 hover:bg-gray-50 transition-colors group"
                        data-testid="import-mode-zip"
                    >
                        <div class="flex items-start gap-3">
                            <Archive class="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
                            <div>
                                <p class="font-medium text-gray-800 group-hover:text-gray-900">ZIP Archive (.zip)</p>
                                <p class="text-sm text-gray-500 mt-0.5">Import folders and .md files from a .zip archive, update matching notes, and restore bundled images from Panino exports.</p>
                            </div>
                        </div>
                    </button>

                    <button
                        @click="selectMode('json')"
                        class="w-full text-left border rounded-lg p-4 hover:bg-gray-50 transition-colors group"
                        data-testid="import-mode-json"
                    >
                        <div class="flex items-start gap-3">
                            <Braces class="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
                            <div>
                                <p class="font-medium text-gray-800 group-hover:text-gray-900">Panino / StackEdit JSON</p>
                                <p class="text-sm text-gray-500 mt-0.5">
                                    Import folders and markdown notes from a Panino or StackEdit JSON export.
                                    <span class="text-amber-600 font-medium">Images, settings, and variables are skipped.</span>
                                </p>
                            </div>
                        </div>
                    </button>
                </div>

                <!-- ── Markdown files mode ── -->
                <div v-else-if="activeMode === 'markdown'">
                    <div
                        class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                        :class="isDragging ? 'border-gray-800 bg-gray-50' : 'border-gray-300 hover:border-gray-400'"
                        @dragenter.prevent="isDragging = true"
                        @dragleave.prevent="isDragging = false"
                        @dragover.prevent
                        @drop.prevent="handleMarkdownDrop"
                        data-testid="import-modal-dropzone"
                    >
                        <div v-if="isDragging" class="text-gray-800 font-medium">Drop your .md files here</div>
                        <div v-else class="space-y-2">
                            <Upload class="w-12 h-12 mx-auto text-gray-400" />
                            <p class="text-gray-600 font-medium">Drag and drop .md files here</p>
                            <p class="text-sm text-gray-500">or</p>
                            <input
                                type="file"
                                accept=".md"
                                multiple
                                @change="handleMarkdownFileSelect"
                                class="hidden"
                                ref="mdFileInput"
                            />
                            <button
                                @click="$refs.mdFileInput.click()"
                                class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900
                                       text-white text-sm font-medium rounded-md shadow-sm transition-colors"
                                data-testid="import-modal-choose-md-button"
                            >
                                Choose Files
                            </button>
                        </div>
                    </div>
                    <div v-if="selectedFiles.length" class="mt-4">
                        <p class="text-sm text-gray-600">
                            {{ selectedFiles.length }} file{{ selectedFiles.length !== 1 ? 's' : '' }} selected
                        </p>
                    </div>
                </div>

                <!-- ── Directory mode ── -->
                <div v-else-if="activeMode === 'directory'">
                    <div class="text-center space-y-3">
                        <FolderOpen class="w-12 h-12 mx-auto text-gray-400" />
                        <p class="text-gray-600 font-medium">Select a folder to import</p>
                        <p class="text-sm text-gray-500">All .md files and folder structure will be preserved.</p>
                        <input
                            type="file"
                            webkitdirectory
                            @change="handleDirectorySelect"
                            class="hidden"
                            ref="dirInput"
                        />
                        <button
                            @click="$refs.dirInput.click()"
                            class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900
                                   text-white text-sm font-medium rounded-md shadow-sm transition-colors"
                            data-testid="import-modal-choose-dir-button"
                        >
                            Choose Folder
                        </button>
                    </div>
                    <div v-if="selectedFiles.length" class="mt-4">
                        <p class="text-sm text-gray-600">
                            {{ selectedFiles.length }} file{{ selectedFiles.length !== 1 ? 's' : '' }} found in directory
                        </p>
                    </div>
                </div>

                <!-- ── ZIP mode ── -->
                <div v-else-if="activeMode === 'zip'">
                    <div
                        class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                        :class="isDragging ? 'border-gray-800 bg-gray-50' : 'border-gray-300 hover:border-gray-400'"
                        @dragenter.prevent="isDragging = true"
                        @dragleave.prevent="isDragging = false"
                        @dragover.prevent
                        @drop.prevent="handleZipDrop"
                        data-testid="import-modal-zip-dropzone"
                    >
                        <div v-if="isDragging" class="text-gray-800 font-medium">Drop your .zip file here</div>
                        <div v-else class="space-y-2">
                            <Archive class="w-12 h-12 mx-auto text-gray-400" />
                            <p class="text-gray-600 font-medium">Drag and drop a .zip file here</p>
                            <p class="text-sm text-gray-500">or</p>
                            <input
                                type="file"
                                accept=".zip"
                                @change="handleZipFileSelect"
                                class="hidden"
                                ref="zipFileInput"
                            />
                            <button
                                @click="$refs.zipFileInput.click()"
                                class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900
                                       text-white text-sm font-medium rounded-md shadow-sm transition-colors"
                                data-testid="import-modal-choose-zip-button"
                            >
                                Choose ZIP File
                            </button>
                        </div>
                    </div>
                    <div v-if="selectedZipFile" class="mt-4">
                        <p class="text-sm text-gray-600">Selected: {{ selectedZipFile.name }}</p>
                    </div>
                </div>

                <!-- ── JSON mode (existing behavior) ── -->
                <div v-else-if="activeMode === 'json'">
                    <div class="mb-4">
                        <div
                            class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                            :class="isDragging ? 'border-gray-800 bg-gray-50' : 'border-gray-300 hover:border-gray-400'"
                            @dragenter.prevent="isDragging = true"
                            @dragleave.prevent="isDragging = false"
                            @dragover.prevent
                            @drop.prevent="handleJsonDrop"
                        >
                            <div v-if="isDragging" class="text-gray-800 font-medium">Drop your JSON file here</div>
                            <div v-else class="space-y-2">
                                <Upload class="w-12 h-12 mx-auto text-gray-400" />
                                <p class="text-gray-600 font-medium">Drag and drop your JSON file here</p>
                                <p class="text-sm text-gray-500">or</p>
                                <input
                                    type="file"
                                    accept=".json"
                                    @change="handleJsonFileSelect"
                                    class="hidden"
                                    ref="jsonFileInput"
                                />
                                <button
                                    @click="$refs.jsonFileInput.click()"
                                    class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900
                                           text-white text-sm font-medium rounded-md shadow-sm transition-colors"
                                    data-testid="import-modal-choose-file-button"
                                >
                                    Choose File
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-medium text-gray-700">
                            Or paste your JSON data here:
                        </label>
                        <textarea
                            v-model="jsonData"
                            rows="8"
                            placeholder="Paste your JSON data here..."
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg
                                   font-mono text-sm resize-none focus:ring-1 focus:ring-blue-500
                                   focus:border-blue-500"
                            data-testid="import-modal-json-textarea"
                        ></textarea>
                    </div>

                    <div class="mt-4">
                        <div class="flex items-center">
                            <input
                                id="stackedit-format"
                                type="checkbox"
                                v-model="isStackEditFormat"
                                class="h-4 w-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500"
                                data-testid="import-modal-stackedit-toggle"
                            >
                            <label for="stackedit-format" class="ml-2 block text-sm text-gray-900">
                                Import from StackEdit format
                            </label>
                        </div>
                    </div>
                </div>

                <!-- ── Progress bar ── -->
                <div v-if="isImporting" class="mt-4">
                    <div class="flex justify-between text-sm text-gray-600 mb-1">
                        <span>Importing...</span>
                        <span>{{ progressCurrent }} / {{ progressTotal }}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                        <div
                            class="bg-gray-800 h-2 rounded-full transition-all duration-150"
                            :style="{ width: progressPercent + '%' }"
                        ></div>
                    </div>
                </div>

                <!-- ── Error ── -->
                <div
                    v-if="error"
                    class="mt-4 p-4 bg-red-50 border border-red-200 rounded-md"
                    data-testid="import-modal-error"
                >
                    <div class="flex">
                        <AlertCircle class="w-5 h-5 text-red-400 mr-2 shrink-0" />
                        <p class="text-sm text-red-600">{{ error }}</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-between">
                    <button
                        v-if="activeMode"
                        @click="goBack"
                        :disabled="isImporting"
                        class="px-4 py-2 text-sm font-medium text-gray-700
                               bg-white border border-gray-300 rounded-md
                               hover:bg-gray-50 transition-colors disabled:opacity-50"
                        data-testid="import-modal-back-button"
                    >
                        Back
                    </button>
                    <div v-else></div>
                    <div class="flex space-x-3">
                        <button
                            @click="handleClose"
                            :disabled="isImporting"
                            class="px-4 py-2 text-sm font-medium text-gray-700
                                   bg-white border border-gray-300 rounded-md
                                   hover:bg-gray-50 transition-colors disabled:opacity-50"
                            data-testid="import-modal-cancel-button"
                        >
                            Cancel
                        </button>
                        <button
                            v-if="activeMode"
                            @click="doImport"
                            :disabled="!canImport || isImporting"
                            class="px-4 py-2 text-sm font-medium text-white
                                   bg-gray-800 rounded-md hover:bg-gray-900
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transition-colors focus:outline-none focus:ring-2
                                   focus:ring-offset-2 focus:ring-gray-500"
                            data-testid="import-modal-import-button"
                        >
                            <span v-if="isImporting">Importing...</span>
                            <span v-else>Import</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { isMarkdownFile } from '@/utils/importUtils'
import { X, Upload, AlertCircle, FileText, FolderOpen, Archive, Braces } from 'lucide-vue-next'

const props = defineProps({
    show: Boolean
})

const emit = defineEmits(['close', 'import-success'])
const docStore = useDocStore()
const uiStore = useUiStore()

// ── State ────────────────────────────────────────────────────

const activeMode = ref(null) // null | 'markdown' | 'directory' | 'zip' | 'json'
const isDragging = ref(false)
const error = ref('')
const isImporting = ref(false)

// Progress
const progressCurrent = ref(0)
const progressTotal = ref(0)
const progressPercent = computed(() =>
    progressTotal.value > 0 ? Math.round((progressCurrent.value / progressTotal.value) * 100) : 0
)

// Markdown files mode
const selectedFiles = ref([])
const mdFileInput = ref(null)

// Directory mode
const dirInput = ref(null)

// ZIP mode
const selectedZipFile = ref(null)
const zipFileInput = ref(null)

// JSON mode
const jsonData = ref('')
const isStackEditFormat = ref(false)
const jsonFileInput = ref(null)

const modeTitles = {
    markdown: 'Import Markdown Files',
    directory: 'Import Markdown Folder',
    zip: 'Import ZIP Archive',
    json: 'Import JSON Backup',
}

// ── Computed ─────────────────────────────────────────────────

const canImport = computed(() => {
    if (isImporting.value) return false
    switch (activeMode.value) {
        case 'markdown': return selectedFiles.value.length > 0
        case 'directory': return selectedFiles.value.length > 0
        case 'zip': return selectedZipFile.value !== null
        case 'json': return jsonData.value.trim().length > 0
        default: return false
    }
})

// ── Navigation ───────────────────────────────────────────────

function selectMode(mode) {
    activeMode.value = mode
    error.value = ''
}

function goBack() {
    activeMode.value = null
    error.value = ''
    resetSelections()
}

function handleClose() {
    if (isImporting.value) return
    activeMode.value = null
    error.value = ''
    resetSelections()
    emit('close')
}

function resetSelections() {
    selectedFiles.value = []
    selectedZipFile.value = null
    jsonData.value = ''
    isStackEditFormat.value = false
    progressCurrent.value = 0
    progressTotal.value = 0
}

function onProgress(current, total) {
    progressCurrent.value = current
    progressTotal.value = total
}

// ── Markdown file handlers ───────────────────────────────────

function handleMarkdownDrop(e) {
    isDragging.value = false
    const files = Array.from(e.dataTransfer.files).filter(f => isMarkdownFile(f.name))
    if (files.length > 0) {
        selectedFiles.value = files
        error.value = ''
    } else {
        error.value = 'No .md files found in the dropped items.'
    }
}

function handleMarkdownFileSelect(e) {
    selectedFiles.value = Array.from(e.target.files)
    error.value = ''
}

// ── Directory handler ────────────────────────────────────────

function handleDirectorySelect(e) {
    selectedFiles.value = Array.from(e.target.files)
    error.value = ''
}

// ── ZIP handlers ─────────────────────────────────────────────

function handleZipDrop(e) {
    isDragging.value = false
    const file = e.dataTransfer.files[0]
    if (file && file.name.toLowerCase().endsWith('.zip')) {
        selectedZipFile.value = file
        error.value = ''
    } else {
        error.value = 'Please drop a .zip file.'
    }
}

function handleZipFileSelect(e) {
    const file = e.target.files[0]
    if (file) {
        selectedZipFile.value = file
        error.value = ''
    }
}

// ── JSON handlers ────────────────────────────────────────────

function handleJsonDrop(e) {
    isDragging.value = false
    const file = e.dataTransfer.files[0]
    if (file) readJsonFile(file)
}

function handleJsonFileSelect(e) {
    const file = e.target.files[0]
    if (file) readJsonFile(file)
}

function readJsonFile(file) {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        error.value = 'Please select a JSON file'
        return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
        try {
            JSON.parse(e.target.result)
            jsonData.value = e.target.result
            error.value = ''
        } catch {
            error.value = 'Invalid JSON format'
        }
    }
    reader.onerror = () => { error.value = 'Error reading file' }
    reader.readAsText(file)
}

function buildImportToastMessage(result) {
    const parts = []

    if (result.created) parts.push(`${result.created} created`)
    if (result.updated) parts.push(`${result.updated} updated`)
    if (result.unchanged) parts.push(`${result.unchanged} unchanged`)
    if (result.foldersCreated) parts.push(`${result.foldersCreated} folder${result.foldersCreated !== 1 ? 's' : ''} created`)

    return parts.length ? `Import complete: ${parts.join(', ')}.` : 'Nothing changed during import.'
}

function showSkippedItemsToast(result) {
    if (!result?.skippedItems?.length) return

    const preview = result.skippedItems
        .slice(0, 3)
        .map(item => `${item.path} (${item.reason})`)
        .join('; ')
    const remaining = result.skippedItems.length - 3
    const suffix = remaining > 0 ? `; +${remaining} more` : ''

    uiStore.addToast(`Skipped ${result.skippedItems.length} item(s): ${preview}${suffix}`, 'warning', 8000)
}

function shouldReloadAfterImport(result) {
    return Boolean(result && (result.created || result.updated || result.foldersCreated))
}

// ── Import dispatcher ────────────────────────────────────────

async function doImport(importOptions = {}) {
    error.value = ''
    isImporting.value = true

    try {
        let result = null

        switch (activeMode.value) {
            case 'markdown': {
                result = await docStore.importMarkdownFiles(selectedFiles.value, null, onProgress, importOptions)
                break
            }
            case 'directory': {
                result = await docStore.importMarkdownDirectory(selectedFiles.value, onProgress, importOptions)
                break
            }
            case 'zip': {
                result = await docStore.importZipArchive(selectedZipFile.value, onProgress, importOptions)
                break
            }
            case 'json': {
                const data = JSON.parse(jsonData.value)
                if (isStackEditFormat.value) {
                    result = await docStore.importStackEditData(data, importOptions)
                } else {
                    result = await docStore.importData(data, importOptions)
                }
                break
            }
        }

        if (result) {
            uiStore.addToast(buildImportToastMessage(result), 'success')
            showSkippedItemsToast(result)
        }

        emit('import-success')
        emit('close')
        activeMode.value = null
        resetSelections()

        if (shouldReloadAfterImport(result)) {
            window.location.reload()
        }
    } catch (err) {
        if (err?.code === 'UNSAFE_OVERWRITE') {
            const confirmed = window.confirm(`${err.message}\n\nContinue anyway?`)
            if (confirmed) {
                await doImport({ ...importOptions, allowUnsafeOverwrite: true })
            }
            return
        }

        console.error('Import failed:', err)
        error.value = 'Import failed: ' + (err.message || 'Unknown error')
    } finally {
        isImporting.value = false
    }
}
</script>
