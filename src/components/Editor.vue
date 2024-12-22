// src/components/Editor.vue
<template>
    <div v-if="file">
        <h2 class="text-xl font-bold mb-2">{{ file.name }}</h2>
        <div class="text-sm text-gray-600 mb-4">
            <p>Type: {{ file.type }}</p>
            <p>Hash: {{ file.hash }}</p>
            <p>Transaction (tx): {{ file.tx }}</p>
        </div>

        <!-- Edit area -->
        <label class="font-medium mb-1 block">Edit Markdown:</label>
        <textarea v-model="contentDraft" @input="handleInput" class="border p-2 rounded w-full h-64">
        </textarea>
    </div>
    <div v-else>
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useDocStore } from '@/store/docStore'

const docStore = useDocStore()

const file = computed(() => docStore.selectedFile)
const originalContent = computed(() => docStore.selectedFileContent)

const contentDraft = ref('')
watch(originalContent, (val) => {
    contentDraft.value = val
}, { immediate: true })

// Real-time update handler
function handleInput() {
    if (file.value) {
        docStore.updateFileContent(file.value.id, contentDraft.value)
    }
}
</script>