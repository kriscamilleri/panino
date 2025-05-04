<template>
  <div v-if="file" class="h-full flex flex-col">
    <!-- Document Stats -->
    <div v-if="ui.showStats" class="flex gap-4 text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded"
      data-testid="editor-stats-container">
      <div class="flex items-center gap-2">
        <span class="font-medium">Words:</span>
        <span data-testid="editor-stats-words">{{ wordCount }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-medium">Characters:</span>
        <span data-testid="editor-stats-characters">{{ characterCount }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-medium">Lines:</span>
        <span data-testid="editor-stats-lines">{{ lineCount }}</span>
      </div>
    </div>

    <!-- File Metadata -->
    <div v-if="ui.showMetadata" class="text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded"
      data-testid="editor-metadata-container">
      <div class="flex gap-4">
        <div class="flex items-center gap-2">
          <span class="font-medium">Name:</span>
          <span data-testid="editor-metadata-name">{{ file.name }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">Type:</span>
          <span data-testid="editor-metadata-type">{{ file.type }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">Hash:</span>
          <span data-testid="editor-metadata-hash">{{ file.hash }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">TX:</span>
          <span data-testid="editor-metadata-tx">{{ file.tx }}</span>
        </div>
      </div>
    </div>

    <!-- Upload Progress -->
    <div v-if="isUploading" class="mb-4 p-2 bg-blue-50 text-blue-700 rounded flex items-center"
      data-testid="editor-upload-progress">
      <span class="mr-2">Uploading image...</span>
      <div class="animate-spin h-4 w-4 border-2 border-blue-500 rounded-full border-t-transparent"></div>
    </div>

    <!-- Upload Error -->
    <div v-if="uploadError" class="mb-4 p-2 bg-red-50 text-red-700 rounded" data-testid="editor-upload-error">
      {{ uploadError }}
    </div>

    <!-- Textarea -->
    <div class="flex-1 flex flex-col min-h-0">
      <textarea ref="textareaRef" v-model="contentDraft" @input="handleInput" @paste="handlePaste"
        class="flex-1 border p-4 rounded w-full font-mono resize-none focus:outline-none focus:border-blue-500"
        placeholder="Start writing..." data-testid="editor-textarea"></textarea>
    </div>
  </div>

  <div v-else data-testid="editor-no-file">
    <p class="text-gray-500 mt-3 ml-3">No file selected</p>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  watch,
  nextTick,
  defineExpose,
  onMounted
} from 'vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { useDraftStore } from '@/store/draftStore'
import { useContentStore } from '@/store/contentStore'

/* ───── local helpers ───── */
function debounce(fn, wait) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), wait)
  }
}

const isProduction = import.meta.env.PROD
const devImageServiceUrl =
  import.meta.env.VITE_IMAGE_SERVICE_URL || 'http://localhost:3001'
const imageServiceUrl = isProduction ? '' : devImageServiceUrl

/* ───── stores & refs ───── */
const docStore = useDocStore()
const ui = useUiStore()
const draftStore = useDraftStore()
const contentStore = useContentStore()

const textareaRef = ref(null)

/* ───── upload state ───── */
const isUploading = ref(false)
const uploadError = ref('')

/* ───── reactive file & draft ───── */
const file = computed(() => docStore.selectedFile)
const contentDraft = ref('')

watch(
  file,
  async newFile => {
    if (newFile?.id) {
      const existingDraft = draftStore.getDraft(newFile.id)
      if (existingDraft) {
        contentDraft.value = existingDraft
        return
      }
      if (docStore.selectedFileContent) {
        contentDraft.value = docStore.selectedFileContent
        return
      }
      try {
        const content = await contentStore.loadContent(newFile.id)
        contentDraft.value = content || ''
      } catch (err) {
        console.error('Error loading content:', err)
        contentDraft.value = ''
      }
    } else {
      contentDraft.value = ''
    }
  },
  { immediate: true }
)

/* ───── stats ───── */
const wordCount = computed(() =>
  contentDraft.value ? contentDraft.value.trim().split(/\s+/).filter(w => w).length : 0
)
const characterCount = computed(() => contentDraft.value.length)
const lineCount = computed(() => (contentDraft.value ? contentDraft.value.split('\n').length : 0))

/* ───── debounced save ───── */
const debouncedSyncToDB = debounce((id, text) => {
  docStore.updateFileContent(id, text)
}, 500)

function handleInput() {
  if (file.value) {
    draftStore.setDraft(file.value.id, contentDraft.value)
    debouncedSyncToDB(file.value.id, contentDraft.value)
  }
}

/* ───── paste-images & upload helper (unchanged) ───── */
async function handlePaste(event) {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.indexOf('image') === 0) {
      event.preventDefault()
      const fileObj = item.getAsFile()
      if (fileObj) await uploadImage(fileObj)
      break
    }
  }
}

async function uploadImage(fileObj) {
  isUploading.value = true
  uploadError.value = ''
  try {
    const formData = new FormData()
    formData.append('image', fileObj)
    const response = await fetch(`${imageServiceUrl}/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.message || 'Upload failed')
    }
    const data = await response.json()
    const finalUrl = isProduction ? data.url : imageServiceUrl + data.url
    insertAtCursor(`![Image](${finalUrl})\n`)
  } catch (err) {
    console.error('Image upload error:', err)
    uploadError.value = err.message || 'Failed to upload image'
  } finally {
    isUploading.value = false
  }
}

/* ───── insertion helpers ───── */
function insertFormat(prefix, suffix) {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = contentDraft.value.slice(start, end)
  contentDraft.value =
    contentDraft.value.slice(0, start) + prefix + selected + suffix + contentDraft.value.slice(end)
  handleInput()
  textarea.focus()
  const newPos = selected
    ? start + prefix.length + selected.length + suffix.length
    : start + prefix.length
  textarea.setSelectionRange(newPos, newPos)
}
function insertList(prefix) {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = contentDraft.value.slice(start, end)
  let newText
  if (selected) {
    newText = selected
      .split('\n')
      .map(line => prefix + line)
      .join('\n')
    contentDraft.value = contentDraft.value.slice(0, start) + newText + contentDraft.value.slice(end)
  } else {
    newText = prefix
    contentDraft.value =
      contentDraft.value.slice(0, start) + newText + contentDraft.value.slice(start)
  }
  handleInput()
  textarea.focus()
  textarea.setSelectionRange(start + prefix.length, start + prefix.length)
}
function insertTable() {
  const tpl = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
  insertAtCursor(tpl)
}
function insertCodeBlock() {
  insertFormat('```\n', '\n```')
}
function insertImagePlaceholder() {
  insertAtCursor('![Alt text](url)\n')
}
function insertAtCursor(text) {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart
  contentDraft.value =
    contentDraft.value.slice(0, start) + text + contentDraft.value.slice(start)
  handleInput()
  textarea.focus()
  textarea.setSelectionRange(start + text.length, start + text.length)
}

/* ───── find / replace ───── */
function findNext(term) {
  if (!term?.trim()) return
  const textarea = textareaRef.value
  if (!textarea) return
  let fromIdx = textarea.selectionEnd
  let idx = contentDraft.value.indexOf(term, fromIdx)
  if (idx === -1 && fromIdx !== 0) idx = contentDraft.value.indexOf(term, 0)
  if (idx === -1) return
  textarea.focus()
  textarea.setSelectionRange(idx, idx + term.length)
  nextTick(() => textarea.focus())
}
function replaceNext(term, repl) {
  if (!term?.trim()) return
  const textarea = textareaRef.value
  if (!textarea) return
  let fromIdx = textarea.selectionEnd
  let idx = contentDraft.value.indexOf(term, fromIdx)
  if (idx === -1 && fromIdx !== 0) idx = contentDraft.value.indexOf(term, 0)
  if (idx === -1) return
  contentDraft.value =
    contentDraft.value.slice(0, idx) + repl + contentDraft.value.slice(idx + term.length)
  handleInput()
  textarea.focus()
  textarea.setSelectionRange(idx, idx + repl.length)
}
function replaceAll(term, repl) {
  if (!term?.trim()) return
  if (term === repl) return
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  contentDraft.value = contentDraft.value.replace(regex, repl)
  handleInput()
}

/* ───── expose for other components ───── */
onMounted(() => {
  window.__editorRef = {
    insertFormat,
    insertList,
    insertTable,
    insertCodeBlock,
    insertImagePlaceholder,
    uploadImage,
    findNext,
    replaceNext,
    replaceAll
  }
})
defineExpose({
  insertFormat,
  insertList,
  insertTable,
  insertCodeBlock,
  insertImagePlaceholder,
  uploadImage,
  findNext,
  replaceNext,
  replaceAll
})
</script>
