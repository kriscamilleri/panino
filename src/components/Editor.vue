<!-- ----- START: src/components/Editor.vue ----- -->
<template>
    <div v-if="file" class="h-full flex flex-col">
        <!-- Formatting toolbar -->
        <div class="flex flex-wrap gap-2 mb-4 p-2 bg-gray-100 rounded items-center">
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
                |-|
            </button>

            <!-- Code block -->
            <button @click="insertCodeBlock" class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                title="Insert Code Block">
                &lt;/&gt;
            </button>

            <!-- Divider -->
            <div class="w-px h-6 bg-gray-300 mx-2"></div>

            <!-- Toggle buttons -->
            <button @click="toggleStats" class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                :class="{ 'bg-blue-50': showStats }" title="Toggle Document Stats">
                📊 Stats
            </button>
            <button @click="toggleMetadata" class="px-3 py-1 bg-white border rounded hover:bg-gray-50 text-sm"
                :class="{ 'bg-blue-50': showMetadata }" title="Toggle File Metadata">
                ℹ️ Info
            </button>

            <!-- Divider -->
            <div class="w-px h-6 bg-gray-300 mx-2"></div>

            <!-- Search box: new feature -->
            <div class="flex items-center gap-2">
                <input type="text" placeholder="Find text..." v-model="searchTerm"
                    class="border p-1 rounded text-sm w-36" />
                <button @click="findNext" class="px-2 py-1 bg-white border rounded hover:bg-gray-50 text-sm">
                    Next
                </button>
            </div>
        </div>

        <!-- Document Stats -->
        <div v-if="showStats" class="flex gap-4 text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded">
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

        <!-- File Metadata -->
        <div v-if="showMetadata" class="text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded">
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
import { ref, computed, watch, nextTick } from 'vue'
import { useDocStore } from '@/store/docStore'

const docStore = useDocStore()
const textareaRef = ref(null)
const showStats = ref(true) // Default to showing stats
const showMetadata = ref(false) // Default to hiding metadata

const file = computed(() => docStore.selectedFile)
const originalContent = computed(() => docStore.selectedFileContent)

const contentDraft = ref('')
watch(originalContent, (val) => {
    contentDraft.value = val
}, { immediate: true })

// Search term (new feature)
const searchTerm = ref('')

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

// Toggle functions
function toggleStats() {
    showStats.value = !showStats.value
}

function toggleMetadata() {
    showMetadata.value = !showMetadata.value
}

// Formatting functions
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
    const newCursorPos = selected
        ? start + prefix.length + selected.length + suffix.length
        : start + prefix.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

function insertList(prefix) {
    const textarea = textareaRef.value
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
    const start = textarea.selectionStart

    contentDraft.value = contentDraft.value.substring(0, start) +
        text +
        contentDraft.value.substring(start)

    textarea.focus()
    const newCursorPos = start + text.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
}

// Sync content to store
function handleInput() {
    if (file.value) {
        docStore.updateFileContent(file.value.id, contentDraft.value)
    }
}

// ======================================
// "Find" feature: simple "Next" search
// ======================================
function findNext() {
    const txt = searchTerm.value.trim()
    if (!txt) return

    const textarea = textareaRef.value
    // Start searching after the current selectionEnd
    let fromIndex = textarea.selectionEnd
    let foundIndex = contentDraft.value.indexOf(txt, fromIndex)

    // If not found, wrap around from start
    if (foundIndex === -1 && fromIndex !== 0) {
        foundIndex = contentDraft.value.indexOf(txt, 0)
    }

    // If still not found, nothing to do
    if (foundIndex === -1) return

    // Select that occurrence
    textarea.focus()
    textarea.setSelectionRange(foundIndex, foundIndex + txt.length)

    // Attempt to scroll the match into view
    // (Usually setSelectionRange triggers a scroll, but we can ensure it by some hack.)
    nextTick(() => {
        // A minimal approach is to re-focus, or do nothing
        textarea.focus()
    })
}
</script>
<!-- ----- END: src/components/Editor.vue ----- -->
