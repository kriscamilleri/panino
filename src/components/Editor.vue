<template>
    <div>
        <div v-if="file">
            <!-- Title -->
            <h2 class="text-2xl font-bold mb-2">{{ file.name }}</h2>

            <!-- Basic metadata (type, hash, etc.) - adapt as desired -->
            <div class="text-sm text-gray-600 mb-4">
                <p>Type: {{ file.type }}</p>
                <p>Hash: {{ file.hash }}</p>
                <p>Transaction (tx): {{ file.tx }}</p>
                <!-- You can include anything else from the file object or the content object -->
            </div>

            <!-- Plain text Markdown content -->
            <label class="block mb-1 font-medium">Markdown Content:</label>
            <textarea class="w-full border p-2 rounded min-h-[300px]" :value="fileContent" readonly />
        </div>
        <div v-else>
            <p class="text-gray-500">No file selected. Please choose a file from the sidebar.</p>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'

const docStore = useDocStore()

// The currently selected file object
const file = computed(() => docStore.selectedFile)

// The text content of the selected file
const fileContent = computed(() => docStore.selectedFileContent)
</script>

<style scoped></style>