# In src/components/ImportModal.vue

<template>
    <div
        v-if="show"
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="import-modal-container"
    >
        <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">Import Data</h3>
                    <button
                        @click="$emit('close')"
                        class="text-gray-400 hover:text-gray-600 transition-colors"
                        data-testid="import-modal-close-button"
                    >

                        <X class="w-5 h-5" />

                    </button>
                </div>
            </div>

            <div class="px-6 py-4 flex-1 overflow-y-auto">
                <div class="mb-6">
                    <div
                        class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                        :class="[
                            isDragging
                                ? 'border-gray-800 bg-gray-50'
                                : 'border-gray-300 hover:border-gray-400'
                        ]"
                        @dragenter.prevent="isDragging = true"
                        @dragleave.prevent="isDragging = false"
                        @dragover.prevent
                        @drop.prevent="handleDrop"
                        data-testid="import-modal-dropzone"
                    >

                        <div
                            v-if="isDragging"
                            class="text-gray-800 font-medium"
                        >
                            Drop your file here
                        </div>
                        <div
                            v-else
                            class="space-y-2"
                        >

                            <Upload class="w-12 h-12 mx-auto text-gray-400" />
                            <p class="text-gray-600 font-medium">
                                Drag and drop your JSON file here
                            </p>
                            <p class="text-sm text-gray-500">or</p>
                            <input
                                type="file"
                                accept=".json"
                                @change="handleFileSelect"
                                class="hidden"
                                ref="fileInput"
                            />
                            <button
                                @click="$refs.fileInput.click()"
                                class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900
                                           text-white text-sm font-medium rounded-md shadow-sm
                                           transition-colors"
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
                        <label
                            for="stackedit-format"
                            class="ml-2 block text-sm text-gray-900"
                        >Import from StackEdit
                            format</label>
                    </div>
                </div>

                <div
                    v-if="error"
                    class="mt-4 p-4 bg-red-50 border border-red-200 rounded-md"
                    data-testid="import-modal-error"
                >
                    <div class="flex">

                        <AlertCircle class="w-5 h-5 text-red-400 mr-2" />
                        <p class="text-sm text-red-600">{{ error }}</p>

                    </div>
                </div>

            </div>

            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-end space-x-3">
                    <button
                        @click="$emit('close')"
                        class="px-4 py-2 text-sm font-medium text-gray-700
                                   bg-white border border-gray-300 rounded-md
                                   hover:bg-gray-50 transition-colors"
                        data-testid="import-modal-cancel-button"
                    >
                        Cancel
                    </button>
                    <button
                        @click="importData"
                        :disabled="!jsonData"
                        class="px-4 py-2 text-sm font-medium text-white
                                   bg-gray-800 rounded-md hover:bg-gray-900
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transition-colors focus:outline-none focus:ring-2
                                   focus:ring-offset-2 focus:ring-gray-500"
                        data-testid="import-modal-import-button"
                    >
                        Import
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useDocStore } from '@/store/docStore'
import { X, Upload, AlertCircle } from 'lucide-vue-next'

const props = defineProps({
    show: Boolean
})

const emit = defineEmits(['close', 'import-success'])
const docStore = useDocStore()

const isDragging = ref(false)
const jsonData = ref('')
const error = ref('')
const fileInput = ref(null)
const isStackEditFormat = ref(false);

function handleDrop(e) {
    isDragging.value = false
    const file = e.dataTransfer.files[0]
    if (file) {
        readFile(file)
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0]
    if (file) {
        readFile(file)
    }
}

function readFile(file) {
    if (file.type !== 'application/json') {
        error.value = 'Please select a JSON file'
        return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
        try {
            const content = e.target.result
            // Try to parse JSON to validate it
            JSON.parse(content)
            jsonData.value = content
            error.value = ''
        } catch (err) {
            error.value = 'Invalid JSON format'
        }
    }
    reader.onerror = () => {
        error.value = 'Error reading file'
    }
    reader.readAsText(file)
}

async function importData() {
    if (!jsonData.value) {
        error.value = 'Please provide JSON data'
        return
    }
    try {
        const data = JSON.parse(jsonData.value)
        if (isStackEditFormat.value) {
            await docStore.importStackEditData(data);
        } else {
            await docStore.importData(data);
        }
        emit('import-success')
        emit('close')
    } catch (err) {
        console.error('Import failed:', err) // Log the actual error
        error.value = 'Import failed: ' + (err.message || 'Invalid JSON data')
    }
}
</script>
