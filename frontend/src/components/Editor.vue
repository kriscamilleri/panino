<template>
    <div v-if="file" class="h-full flex flex-col">
        <!-- Document Stats -->
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

        <!-- File Metadata -->
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

        <!-- Upload Progress -->
        <div v-if="isUploading" class="mb-4 p-2 bg-blue-50 text-blue-700 rounded flex items-center">
            <span class="mr-2">Uploading image...</span>
            <div class="animate-spin h-4 w-4 border-2 border-blue-500 rounded-full border-t-transparent"></div>
        </div>

        <!-- Upload Error -->
        <div v-if="uploadError" class="mb-4 p-2 bg-red-50 text-red-700 rounded">
            {{ uploadError }}
        </div>

        <!-- Textarea -->
        <div class="flex-1 flex flex-col min-h-0">
            <textarea ref="textareaRef" v-model="contentDraft" @input="handleInput" @paste="handlePaste"
                class="flex-1 border p-4 rounded w-full font-mono resize-none focus:outline-none focus:border-blue-500"
                placeholder="Start writing..."></textarea>
        </div>
    </div>
    <div v-else>
        <p class="text-gray-500 mt-3 ml-3">No file selected</p>
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

// Upload state
const isUploading = ref(false)
const uploadError = ref('')

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

// Handle paste events
async function handlePaste(event) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) {
                await uploadImage(file)
            }
            break
        }
    }
}
async function uploadImage(file) {
    isUploading.value = true
    uploadError.value = ''

    const formData = new FormData()
    formData.append('image', file)

    try {
        const response = await fetch('http://localhost:3001/upload', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        })

        if (!response.ok) {
            const error = await response.json()
            throw new Error(error.message || 'Upload failed')
        }

        const data = await response.json()

        // Insert image markdown at cursor position or at the end
        const textarea = textareaRef.value
        const imageUrl = `http://localhost:3001${data.url}`
        const imageMarkdown = `![Image](${imageUrl})\n`

        if (textarea) {
            const start = textarea.selectionStart
            const end = textarea.selectionEnd

            contentDraft.value =
                contentDraft.value.substring(0, start) +
                imageMarkdown +
                contentDraft.value.substring(end)

            // Update cursor position
            nextTick(() => {
                const newPosition = start + imageMarkdown.length
                textarea.setSelectionRange(newPosition, newPosition)
                textarea.focus()
            })
        } else {
            contentDraft.value += imageMarkdown
        }

        handleInput()
    } catch (error) {
        console.error('Image upload error:', error)
        uploadError.value = error.message || 'Failed to upload image'
    } finally {
        isUploading.value = false
    }
}

function handleInput() {
    if (file.value) {
        docStore.updateFileContent(file.value.id, contentDraft.value)
    }
}

// Expose formatting & search methods so the Nav can call
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

    if (foundIndex === -1) return

    textarea.focus()
    textarea.setSelectionRange(foundIndex, foundIndex + term.length)
    nextTick(() => {
        textarea.focus()
    })
}

defineExpose({
    insertFormat,
    insertList,
    insertTable,
    insertCodeBlock,
    findNext,
})
</script>
