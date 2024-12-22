// In src/components/Preview.vue

<template>
    <div v-if="file">
        <h2 class="text-xl font-bold mb-2">Preview: {{ file.name }}</h2>
        <div class="mt-2" v-html="renderedHtml"></div>
    </div>
    <div v-else>
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useDocStore } from '@/store/docStore'
import DOMPurify from 'dompurify'

const docStore = useDocStore()

const file = computed(() => docStore.selectedFile)
const text = computed(() => docStore.selectedFileContent)
const styles = computed(() => docStore.styles)

// Make renderedHtml reactive to both content and styles changes
const renderedHtml = computed(() => {
    const md = docStore.getMarkdownIt()
    const raw = md.render(text.value || '')
    return DOMPurify.sanitize(raw)
})
</script>