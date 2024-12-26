<!-- src/components/ImportModal.vue -->
<template>
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[80vh] flex flex-col">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold">Import Data</h3>
                <button @click="$emit('close')" class="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <!-- Drag and drop zone -->
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 mb-4 text-center"
                :class="{ 'border-blue-500 bg-blue-50': isDragging }" @dragenter.prevent="isDragging = true"
                @dragleave.prevent="isDragging = false" @dragover.prevent @drop.prevent="handleDrop">
                <div v-if="isDragging">Drop your file here</div>
                <div v-else>
                    <p class="mb-2">Drag and drop your JSON file here</p>
                    <p class="text-sm text-gray-500">or</p>
                    <input type="file" accept=".json" @change="handleFileSelect" class="hidden" ref="fileInput" />
                    <button @click="$refs.fileInput.click()"
                        class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                        Choose File
                    </button>
                </div>
            </div>

            <!-- Manual JSON input -->
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    Or paste your JSON data here:
                </label>
                <textarea v-model="jsonData" rows="8" class="w-full border rounded-lg p-2 font-mono text-sm"
                    placeholder="Paste your JSON data here..."></textarea>
            </div>

            <!-- Error message -->
            <div v-if="error" class="text-red-500 text-sm mb-4">
                {{ error }}
            </div>

            <!-- Action buttons -->
            <div class="flex justify-end space-x-2 mt-auto">
                <button @click="$emit('close')" class="px-4 py-2 border rounded hover:bg-gray-100">
                    Cancel
                </button>
                <button @click="importData" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    :disabled="!jsonData">
                    Import
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useDocStore } from '@/store/docStore'

const props = defineProps({
    show: Boolean
})

const emit = defineEmits(['close', 'import-success'])
const docStore = useDocStore()

const isDragging = ref(false)
const jsonData = ref('')
const error = ref('')
const fileInput = ref(null)

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
            // Just store the content, don't parse yet
            jsonData.value = content
            error.value = ''
        } catch (err) {
            error.value = 'Error reading file'
        }
    }
    reader.readAsText(file)
}

function importData() {
    if (!jsonData.value) {
        error.value = 'Please provide JSON data'
        return
    }

    try {
        const data = JSON.parse(jsonData.value)
        // Basic validation - check if it's an object with at least one entry
        if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid data structure')
        }

        // Additional validation could be added here
        docStore.importData(data)
        emit('import-success')
        emit('close')
    } catch (err) {
        error.value = 'Invalid JSON data: ' + err.message
    }
}
</script>