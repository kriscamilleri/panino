<template>
  <div v-if="file" class="h-full flex flex-col">
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
    <div v-if="ui.showMetadata" class="text-sm text-gray-600 mb-4 p-2 bg-gray-50 rounded"
      data-testid="editor-metadata-container">
      <div class="flex gap-4">
        <div class="flex items-center gap-2">
          <span class="font-medium">Name:</span>
          <span data-testid="editor-metadata-name">{{ file.title || file.name }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">Type:</span>
          <span data-testid="editor-metadata-type">file</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">Last Updated:</span>
          <span data-testid="editor-metadata-updated">{{ new Date(file.updated_at).toLocaleString() }}</span>
        </div>
      </div>

    </div>

    <div v-if="isUploading" class="mb-4 p-2 bg-blue-50 text-blue-700 rounded flex items-center"
      data-testid="editor-upload-progress">
      <span class="mr-2">Uploading image...</span>
      <div class="animate-spin h-4 w-4 border-2 border-blue-500 rounded-full border-t-transparent"></div>

    </div>

    <div v-if="uploadError" class="mb-4 p-2 bg-red-50 text-red-700 rounded" data-testid="editor-upload-error">
      {{ uploadError }}
    </div>

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
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { useDraftStore } from '@/store/draftStore';
import { useAuthStore } from '@/store/authStore';

/* ───── helpers ───── */
function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

const isProduction = import.meta.env.PROD;
const devImageServiceUrl = import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:3001';
const imageServiceUrl = isProduction ? '/api/images' : devImageServiceUrl;

/* ───── stores & refs ───── */
const docStore = useDocStore();
const ui = useUiStore();
const draftStore = useDraftStore();
const authStore = useAuthStore();
const textareaRef = ref(null);

// grab the ref directly, not a computed-of-a-ref
const { selectedFile: file } = storeToRefs(docStore);

/* ───── upload state ───── */
const isUploading = ref(false);
const uploadError = ref('');

/* ───── reactive draft ───── */
const contentDraft = ref('');

watch(
  file,
  async (newFile) => {
    if (newFile?.id) {
      const existingDraft = draftStore.getDraft(newFile.id);
      contentDraft.value = existingDraft ?? newFile.content ?? '';
    } else {
      contentDraft.value = '';
    }
  },
  { immediate: true, deep: true }
);

/* ───── stats ───── */
const wordCount = computed(() => (contentDraft.value ? contentDraft.value.trim().split(/\s+/).filter(Boolean).length : 0));
const characterCount = computed(() => contentDraft.value.length);
const lineCount = computed(() => (contentDraft.value ? contentDraft.value.split('\n').length : 0));

/* ───── debounced save ───── */
const debouncedSyncToDB = debounce((id, text) => {
  docStore.updateFileContent(id, text);
}, 500);

function handleInput() {
  if (file.value) {
    draftStore.setDraft(file.value.id, contentDraft.value);
    debouncedSyncToDB(file.value.id, contentDraft.value);
  }
}

/* ───── paste-images & upload helper ───── */
async function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const fileObj = item.getAsFile();
      if (fileObj) await uploadImage(fileObj);
      break;
    }
  }
}

async function uploadImage(fileObj) {
  if (!authStore.isAuthenticated) {
    uploadError.value = 'You must be logged in to upload images.';
    return;
  }
  isUploading.value = true;
  uploadError.value = '';
  try {
    const formData = new FormData();
    formData.append('image', fileObj);

    const response = await fetch(`${imageServiceUrl}/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authStore.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Upload failed');
    }
    const data = await response.json();
    const finalUrl = `${imageServiceUrl}${data.url}`;
    insertAtCursor(`![${fileObj.name}](${finalUrl})\n`);
  } catch (err) {
    console.error('Image upload error:', err);
    uploadError.value = err.message || 'Failed to upload image.';
  } finally {
    isUploading.value = false;
  }
}

/* ───── insertion helpers ───── */
function insertAtCursor(text) {
  const textarea = textareaRef.value;
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const currentText = contentDraft.value;
  contentDraft.value = currentText.slice(0, start) + text + currentText.slice(end);
  handleInput();
  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(start + text.length, start + text.length);
  });
}
function insertFormat(prefix, suffix) {
  const textarea = textareaRef.value;
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = contentDraft.value.slice(start, end);
  insertAtCursor(prefix + selected + suffix);
  nextTick(() => {
    textarea.focus();
    if (selected) {
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    } else {
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }
  });
}
function insertList(prefix) {
  insertAtCursor(prefix);
}
function insertTable() {
  const tpl = `\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n`;
  insertAtCursor(tpl);
}
function insertCodeBlock() {
  insertFormat('\n```\n', '\n```');
}
function insertImagePlaceholder() {
  insertAtCursor('![Alt text](url)');
}

/* ───── find / replace ───── */
function findNext(term) {
  if (!term?.trim() || !textareaRef.value) return;
  const textarea = textareaRef.value;
  let fromIdx = textarea.selectionEnd;
  const text = contentDraft.value;
  let idx = text.indexOf(term, fromIdx);
  if (idx === -1) idx = text.indexOf(term, 0);
  if (idx > -1) {
    textarea.focus();
    textarea.setSelectionRange(idx, idx + term.length);
  }
}
function replaceNext(term, repl) {
  if (!term?.trim() || !textareaRef.value) return;
  const textarea = textareaRef.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (contentDraft.value.substring(start, end) === term) {
    insertAtCursor(repl);
  } else {
    findNext(term);
  }
}
function replaceAll(term, repl) {
  if (!term?.trim()) return;
  contentDraft.value = contentDraft.value.replaceAll(term, repl);
  handleInput();
}

/* ───── expose for other components ───── */
onMounted(() => {
  window.__editorRef = {
    insertFormat, insertList, insertTable, insertCodeBlock, insertImagePlaceholder,
    uploadImage, findNext, replaceNext, replaceAll
  };
});
defineExpose({
  insertFormat, insertList, insertTable, insertCodeBlock, insertImagePlaceholder,
  uploadImage, findNext, replaceNext, replaceAll
});
</script>
<style scoped></style>
