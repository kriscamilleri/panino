// src/components/Editor.vue
<template>
    <div v-if="file" class="h-full flex flex-col">
        <div class="flex-shrink-0">
            <h2 class="text-xl font-bold mb-2">{{ file.name }}</h2>
            <div class="text-sm text-gray-600 mb-4">
                <p>Type: {{ file.type }}</p>
                <p>Hash: {{ file.hash }}</p>
                <p>Transaction (tx): {{ file.tx }}</p>
            </div>
        </div>

        <!-- Formatting toolbar -->
        <div class="flex flex-wrap gap-2 mb-4 p-2 bg-gray-100 rounded">
            <!-- Text formatting -->
            <button v-for="format in textFormats" :key="format.label"
                @click="insertFormat(format.prefix, format.suffix)"
                class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm" :title="format.label">
                {{ format.icon }}
            </button>

            <!-- Divider -->
            <div class="w-px h-6 bg-gray-300 mx-2"></div>

            <!-- Lists -->
            <button v-for="list in listFormats" :key="list.label" @click="insertList(list.prefix)"
                class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm" :title="list.label">
                {{ list.icon }}
            </button>

            <!-- Divider -->
            <div class="w-px h-6 bg-gray-300 mx-2"></div>

            <!-- Table -->
            <button @click="insertTable" class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                title="Insert Table">
                📊
            </button>

            <!-- Code block -->
            <button @click="insertCodeBlock" class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                title="Insert Code Block">
                &lt;/&gt;
            </button>
        </div>

        <div class="flex-1 flex flex-col min-h-0">
            <label class="font-medium mb-1 block flex-shrink-0">Edit Markdown:</label>
            <textarea ref="textareaRef" v-model="contentDraft" @input="handleInput"
                class="flex-1 border p-2 rounded w-full font-mono resize-none"></textarea>
        </div>
    </div>
    <div v-else>
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useDocStore } from '@/store/docStore'

const docStore = useDocStore()
const textareaRef = ref(null)

const file = computed(() => docStore.selectedFile)
const originalContent = computed(() => docStore.selectedFileContent)

const contentDraft = ref('')
watch(originalContent, (val) => {
    contentDraft.value = val
}, { immediate: true })

// Text formatting options
const textFormats = [
    { label: 'Bold', icon: 'B', prefix: '**', suffix: '**' },
    { label: 'Italic', icon: 'I', prefix: '_', suffix: '_' },
    { label: 'Strike', icon: 'S̶', prefix: '~~', suffix: '~~' },
    { label: 'Quote', icon: '💬', prefix: '> ', suffix: '\n' },
]

// List formatting options
const listFormats = [
    { label: 'Bullet List', icon: '•', prefix: '* ' },
    { label: 'Numbered List', icon: '1.', prefix: '1. ' },
    { label: 'Task List', icon: '☐', prefix: '- [ ] ' },
]

// Insert formatting around selected text or at cursor position
function insertFormat(prefix, suffix) {
    const textarea = textareaRef.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = contentDraft.value.substring(start, end)

    const newText = contentDraft.value.substring(0, start) +
        prefix + selected + suffix +
        contentDraft.value.substring(end)

    contentDraft.value = newText

    // Update cursor position
    textarea.focus()
    const newCursorPos = selected ? start + prefix.length + selected.length + suffix.length : start + prefix.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

// Insert list item
function insertList(prefix) {
    const textarea = textareaRef.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = contentDraft.value.substring(start, end)

    let newText
    if (selected) {
        // Convert each line to list item
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

// Insert table template
function insertTable() {
    const tableTemplate = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
    insertAtCursor(tableTemplate)
}

// Insert code block
function insertCodeBlock() {
    insertFormat('```\n', '\n```')
}

// Helper to insert text at cursor position
function insertAtCursor(text) {
    const textarea = textareaRef.value
    const start = textarea.selectionStart

    contentDraft.value = contentDraft.value.substring(0, start) +
        text +
        contentDraft.value.substring(start)

    textarea.focus()
    const newCursorPos = start + text.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

// Real-time update handler
function handleInput() {
    if (file.value) {
        docStore.updateFileContent(file.value.id, contentDraft.value)
    }
}
</script>