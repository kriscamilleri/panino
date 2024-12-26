<!-- ----- START: src/components/Editor.vue ----- -->
<template>
    <div v-if="file" class="h-full flex flex-col">
        <!-- Document Stats (toggled via uiStore.showStats) -->
        <div v-if="ui.showStats" class="flex gap-4 text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded">
            <div class="flex items-center gap-2">
                <span class="font-medium">Words:</span>
                <span>{{ wordCount }}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-medium">Characters:</span>
                <span>{{ characterCount }}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-medium">Lines:</span>
                <span>{{ lineCount }}</span>
            </div>
        </div>

        <!-- File Metadata (toggled via uiStore.showMetadata) -->
        <div v-if="ui.showMetadata" class="text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded">
            <div class="flex gap-4">
                <div class="flex items-center gap-2">
                    <span class="font-medium">Name:</span>
                    <span>{{ file.name }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="font-medium">Type:</span>
                    <span>{{ file.type }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="font-medium">Hash:</span>
                    <span>{{ file.hash }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="font-medium">TX:</span>
                    <span>{{ file.tx }}</span>
                </div>
            </div>
        </div>

        <!-- Textarea -->
        <div class="flex-1 flex flex-col min-h-0">
            <textarea ref="textareaRef" v-model="contentDraft" @input="handleInput"
                class="flex-1 border p-2 rounded w-full font-mono resize-none focus:outline-none focus:border-blue-500"
                placeholder="Start writing..."></textarea>
        </div>
    </div>
    <div v-else>
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, defineExpose } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'

const docStore = useDocStore()
const ui = useUiStore()

// References
const textareaRef = ref(null)

// We no longer store showStats / showMetadata locally; they're in uiStore.

// The selected file
const file = computed(() => docStore.selectedFile)
const originalContent = computed(() => docStore.selectedFileContent)
const contentDraft = ref('')
watch(originalContent, (val) => {
    contentDraft.value = val
}, { immediate: true })

// Stats computations
const wordCount = computed(() => {
    if (!contentDraft.value) return 0
    return contentDraft.value.trim().split(/\s+/).filter(word => word.length > 0).length
})
const characterCount = computed(() => {
    return contentDraft.value.length
})
const lineCount = computed(() => {
    if (!contentDraft.value) return 0
    return contentDraft.value.split('\n').length
})

// Sync content to store
function handleInput() {
    if (file.value) {
        docStore.updateFileContent(file.value.id, contentDraft.value)
    }
}

// ------------------------------------------------------
// Expose formatting & search methods so the Nav can call
// ------------------------------------------------------
function insertFormat(prefix, suffix) {
    const textarea = textareaRef.value
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = contentDraft.value.substring(start, end)

    const newText = contentDraft.value.substring(0, start) +
        prefix + selected + suffix +
        contentDraft.value.substring(end)

    contentDraft.value = newText

    // Update cursor position
    textarea.focus()
    const newCursorPos = selected
        ? start + prefix.length + selected.length + suffix.length
        : start + prefix.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

function insertList(prefix) {
    const textarea = textareaRef.value
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = contentDraft.value.substring(start, end)

    let newText
    if (selected) {
        newText = selected.split('\n').map(line => prefix + line).join('\n')
        contentDraft.value = contentDraft.value.substring(0, start) + newText + contentDraft.value.substring(end)
    } else {
        newText = prefix
        contentDraft.value = contentDraft.value.substring(0, start) + newText + contentDraft.value.substring(end)
    }

    textarea.focus()
    const newCursorPos = start + prefix.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

function insertTable() {
    const tableTemplate = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
    insertAtCursor(tableTemplate)
}

function insertCodeBlock() {
    insertFormat('```\n', '\n```')
}

function insertAtCursor(text) {
    const textarea = textareaRef.value
    if (!textarea) return
    const start = textarea.selectionStart

    contentDraft.value = contentDraft.value.substring(0, start) +
        text +
        contentDraft.value.substring(start)

    textarea.focus()
    const newCursorPos = start + text.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

function findNext(term) {
    if (!term?.trim()) return
    const textarea = textareaRef.value
    if (!textarea) return

    // Start searching after the current selectionEnd
    let fromIndex = textarea.selectionEnd
    let foundIndex = contentDraft.value.indexOf(term, fromIndex)

    // If not found, wrap around from start
    if (foundIndex === -1 && fromIndex !== 0) {
        foundIndex = contentDraft.value.indexOf(term, 0)
    }

    // If still not found, nothing to do
    if (foundIndex === -1) return

    // Select that occurrence
    textarea.focus()
    textarea.setSelectionRange(foundIndex, foundIndex + term.length)

    // Attempt to scroll into view
    nextTick(() => {
        textarea.focus()
    })
}

// Expose these methods so parent can call them
defineExpose({
    insertFormat,
    insertList,
    insertTable,
    insertCodeBlock,
    findNext,
})
</script>
<!-- ----- END: src/components/Editor.vue ----- -->
