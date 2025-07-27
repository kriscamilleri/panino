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
import { storeToRefs } from 'pinia'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import DOMPurify from 'dompurify'

const docStore = useDocStore()
const draftStore = useDraftStore()

// pull the ref directly
const { selectedFile: file, selectedFileContent } = storeToRefs(docStore)

// preview text = draft if present, else DB content
const text = computed(() => {
    if (!file.value) return ''
    const draft = draftStore.getDraft(file.value.id)
    return draft || selectedFileContent.value
})

const renderedHtml = computed(() => {
    const md = docStore.getMarkdownIt()
    const raw = md.render(text.value || '')
    return DOMPurify.sanitize(raw)
})
</script>
