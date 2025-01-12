# In src/components/ImportModal.vue

<template>
    <div v-if="show" class="fixed inset-0 flex items-center justify-center z-50">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>

        <!-- Modal -->
        <div class="relative bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <!-- Header -->
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">Import Data</h3>
                    <button @click="$emit('close')" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <X class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <!-- Content -->
            <div class="px-6 py-4 flex-1 overflow-y-auto">
                <!-- Drag and drop zone -->
                <div class="mb-6">
                    <div class="border-2 border-dashed rounded-lg p-8 text-center transition-colors" :class="[
                        isDragging
                            ? 'border-gray-800 bg-gray-50'
                            : 'border-gray-300 hover:border-gray-400'
                    ]" @dragenter.prevent="isDragging = true" @dragleave.prevent="isDragging = false"
                        @dragover.prevent @drop.prevent="handleDrop">

                        <div v-if="isDragging" class="text-gray-800 font-medium">
                            Drop your file here
                        </div>
                        <div v-else class="space-y-2">
                            <Upload class="w-12 h-12 mx-auto text-gray-400" />
                            <p class="text-gray-600 font-medium">
                                Drag and drop your JSON file here
                            </p>
                            <p class="text-sm text-gray-500">or</p>
                            <input type="file" accept=".json" @change="handleFileSelect" class="hidden"
                                ref="fileInput" />
                            <button @click="$refs.fileInput.click()" class="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900 
                                           text-white text-sm font-medium rounded-md shadow-sm 
                                           transition-colors">
                                Choose File
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Manual JSON input -->
                <div class="space-y-2">
                    <label class="block text-sm font-medium text-gray-700">
                        Or paste your JSON data here:
                    </label>
                    <textarea v-model="jsonData" rows="8" placeholder="Paste your JSON data here..." class="w-full px-3 py-2 border border-gray-300 rounded-lg 
                                     font-mono text-sm resize-none focus:ring-1 focus:ring-blue-500 
                                     focus:border-blue-500"></textarea>
                </div>

                <!-- Error message -->
                <div v-if="error" class="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <div class="flex">
                        <AlertCircle class="w-5 h-5 text-red-400 mr-2" />
                        <p class="text-sm text-red-600">{{ error }}</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-end space-x-3">
                    <button @click="$emit('close')" class="px-4 py-2 text-sm font-medium text-gray-700 
                                   bg-white border border-gray-300 rounded-md 
                                   hover:bg-gray-50 transition-colors">
                        Cancel
                    </button>
                    <button @click="importData" :disabled="!jsonData" class="px-4 py-2 text-sm font-medium text-white 
                                   bg-gray-800 rounded-md hover:bg-gray-900 
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transition-colors focus:outline-none focus:ring-2 
                                   focus:ring-offset-2 focus:ring-gray-500">
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
        await docStore.importData(data)
        emit('import-success')
        emit('close')
    } catch (err) {
        error.value = 'Invalid JSON data: ' + err.message
    }
}
</script>