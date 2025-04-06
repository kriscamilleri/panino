<template>
    <div v-if="file">
        <div class="mt-2" v-html="renderedHtml" data-testid="preview-content"></div>
    </div>
    <div v-else data-testid="preview-no-file">
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import DOMPurify from 'dompurify'

const docStore = useDocStore()
const draftStore = useDraftStore()

const file = computed(() => docStore.selectedFile)

// We want: preview text = draft if it exists, otherwise docStore content
const text = computed(() => {
    if (!file.value) return ''
    const draft = draftStore.getDraft(file.value.id)
    return draft || docStore.selectedFileContent
})

// Convert markdown => HTML using docStore’s “preview” MarkdownIt instance
const renderedHtml = computed(() => {
    const md = docStore.getMarkdownIt()
    const raw = md.render(text.value || '')
    return DOMPurify.sanitize(raw)
})
</script>
