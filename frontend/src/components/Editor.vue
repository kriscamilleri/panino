<template>
  <div
    v-if="file"
    class="h-full flex flex-col gap-0"
  >
    <div
      v-if="ui.showMetadata"
      class="p-2 bg-gray-50 text-gray-700 text-sm flex gap-4 border-b border-gray-200"
      data-testid="editor-metadata-container"
    >
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

    <div
      v-if="isUploading"
      class="mb-4 p-2 bg-blue-50 text-blue-700 rounded flex items-center"
      data-testid="editor-upload-progress"
    >
      <span class="mr-2">Uploading image...</span>
      <div class="animate-spin h-4 w-4 border-2 border-blue-500 rounded-full border-t-transparent"></div>
    </div>

    <div
      v-if="uploadError"
      class="mb-4 p-2 bg-red-50 text-red-700 rounded"
      data-testid="editor-upload-error"
    >
      {{ uploadError }}
    </div>

    <div
      v-if="ui.showStats"
      class="p-2 bg-gray-50 text-gray-700 text-sm flex gap-4 border-b border-gray-200"
      data-testid="editor-stats-display"
    >
      <div class="flex items-center gap-1">
        <span class="font-medium">Words:</span>
        <span data-testid="editor-stats-words">{{ wordCount }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="font-medium">Characters:</span>
        <span data-testid="editor-stats-chars">{{ characterCount }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="font-medium">Lines:</span>
        <span data-testid="editor-stats-lines">{{ lineCount }}</span>
      </div>
    </div>

    <div class="flex-1 flex flex-col min-h-0 mt-0">
      <div
        ref="editorContainerRef"
        class="flex-1 bg-white mt-0 p-0"
        data-testid="editor-container"
      ></div>
    </div>
  </div>

  <div
    v-else
    data-testid="editor-no-file"
  >
    <p class="text-gray-500 mt-3 ml-3">No file selected</p>
  </div>
</template>

<style scoped>
.bg-white {
  background-color: white !important;
}

/* Remove all padding and margin from editor container */
[data-testid="editor-container"] {
  padding: 0 !important;
  margin: 0 !important;
}

:deep(.overtype-container),
:deep(.overtype-wrapper),
:deep(.overtype-editor),
:deep(.overtype-preview),
:deep(textarea) {
  background-color: white !important;
}

:deep(.overtype-container) {
  padding-top: 0 !important;
  margin-top: 0 !important;
}

:deep(.overtype-wrapper) {
  padding-top: 0 !important;
  margin-top: 0 !important;
}

:deep(.overtype-editor) {
  padding-top: 0 !important;
  margin-top: 0 !important;
}

:deep(.code-block-line) {
  background-color: #f3f4f6 !important;
}
</style>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { useDraftStore } from '@/store/draftStore';
import { useAuthStore } from '@/store/authStore';
import { useEditorStore } from '@/store/editorStore';
import { useHistoryStore } from '@/store/historyStore';
import { useOverTypePatches } from '@/composables/useOverTypePatches';
import OverType from 'overtype';

useOverTypePatches();

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
const imageServiceUrl = isProduction ? '/api' : devImageServiceUrl;

/* ───── stores & refs ───── */
const docStore = useDocStore();
const ui = useUiStore();
const draftStore = useDraftStore();
const authStore = useAuthStore();
const editorStore = useEditorStore();
const historyStore = useHistoryStore(); // <--- INIT STORE
const editorContainerRef = ref(null);
const editorInstance = ref(null);

const { selectedFile: file } = storeToRefs(docStore);

/* ───── upload state ───── */
const isUploading = ref(false);
const uploadError = ref('');

/* ───── reactive draft ───── */
const contentDraft = ref('');

/* ───── debounced save ───── */
const debouncedSyncToDB = debounce((id, text) => {
  docStore.updateFileContent(id, text);
}, 500);

/* ───── History Setup ───── */
const isHistoryAction = ref(false)
// Create a debounced record function for typing
const debouncedRecord = debounce((text, cursor) => {
  if (file.value) {
    historyStore.record(file.value.id, text, cursor);
  }
}, 500);

/* ───── Keydown Handler (Trap Undo/Redo) ───── */
function handleKeydown(e) {
  // Trap Ctrl+Z (Undo)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    performUndo();
    return;
  }

  // Trap Ctrl+Y or Ctrl+Shift+Z (Redo)
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === 'y' || (e.shiftKey && e.key === 'z'))
  ) {
    e.preventDefault();
    performRedo();
    return;
  }
}

/* ───── Handle Native Input ───── */
// This runs on every keystroke via the native event listener
// This runs on every keystroke via the native event listener
function handleNativeInput(e) {
  if (isHistoryAction.value || !file.value) return;

  const textarea = e.target;
  const val = textarea.value;
  const cursor = textarea.selectionEnd;

  // Handle input types that should trigger immediate saves
  const inputType = e.inputType;
  const char = e.data;

  // Added insertLineBreak here 👇
  const isDelimiter =
    inputType === 'insertParagraph' ||
    inputType === 'insertLineBreak' ||
    (char && /[\s\.,;!?:(){}\[\]"']/.test(char));

  if (isDelimiter) {
    // Record immediately on word break/sentence end
    historyStore.record(file.value.id, val, cursor);
  } else {
    // Debounce for character streams
    debouncedRecord(val, cursor);
  }
}

/* ───── History Methods ───── */
function performUndo() {
  if (!file.value) return;
  const previousState = historyStore.undo(file.value.id);
  if (previousState) applyHistoryState(previousState);
}

function performRedo() {
  if (!file.value) return;
  const nextState = historyStore.redo(file.value.id);
  if (nextState) applyHistoryState(nextState);
}

function applyHistoryState(state) {
  // Lock: prevent handleInput from recording this change as a new user action
  isHistoryAction.value = true;

  if (editorInstance.value && state) {
    const textarea = getTextareaElement();

    // 1. Update OverType (Visuals)
    // using setValue is safer than setting textarea.value manually for OverType sync
    editorInstance.value.setValue(state.text);

    // 2. Update Internal Draft State
    contentDraft.value = state.text;
    if (file.value) {
      draftStore.setDraft(file.value.id, state.text);
      debouncedSyncToDB(file.value.id, state.text);
    }

    // 3. Restore Cursor
    nextTick(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(state.cursor, state.cursor);
      }
      // Unlock after DOM updates
      setTimeout(() => { isHistoryAction.value = false; }, 50);
    });
  } else {
    isHistoryAction.value = false;
  }
}

/* ───── Format Wrapping ───── */
// Pass the current cursor position
function wrapWithRecord(fn) {
  return (...args) => {
    if (!file.value) return;

    const textarea = getTextareaElement();
    const cursor = textarea ? textarea.selectionEnd : 0;

    // 1. Snapshot BEFORE formatting
    historyStore.record(file.value.id, contentDraft.value, cursor);

    // 2. Perform formatting
    fn(...args);

    // Snapshot AFTER formatting
    nextTick(() => {
      const newCursor = textarea ? textarea.selectionEnd : 0;
      historyStore.record(file.value.id, contentDraft.value, newCursor);
    });
  }
}

function handleInput(value) {
  contentDraft.value = value;

  if (file.value) {
    draftStore.setDraft(file.value.id, value);
    debouncedSyncToDB(file.value.id, value);
  }
}

/* ───── Overtype initialization ───── */
function initEditor() {
  if (!editorContainerRef.value || editorInstance.value) return;

  const [editor] = OverType.init(editorContainerRef.value, {
    theme: {
      name: 'panino-theme',
      colors: {
        // Base colors - white background
        bgPrimary: '#ffffff',
        bgSecondary: '#ffffff',
        text: '#111827',

        // Headings - matching your preview defaults
        h1: '#111827',
        h2: '#1f2937',
        h3: '#1f2937',

        // Text formatting
        strong: '#111827',
        em: '#111827',

        // Links - darker blue
        link: '#1d4ed8',

        // Code - matching your preview gray background
        code: '#111827',
        codeBg: '#f3f4f6',

        // Blockquote - darker gray
        blockquote: '#4b5563',

        // HR - matching your preview border
        hr: '#d1d5db',

        // Syntax markers - darker for better visibility
        syntaxMarker: 'rgba(75, 85, 99, 0.5)',

        // Cursor and selection
        cursor: '#2563eb',
        selection: 'rgba(37, 99, 235, 0.15)'
      }
    },
    toolbar: false,  // Disable Overtype's toolbar - we use our own SubMenuBar
    showStats: false,  // Disable OverType's built-in stats - we use our own external display
    placeholder: 'Start writing...',
    value: contentDraft.value || '',
    onChange: (value) => {
      handleInput(value);
    },
    onKeydown: (event, instance) => {
      // Forward keydown to our handler
      handleKeydown(event);

      // Handle paste event for images
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        // Paste will be handled by the native paste event
      }
    },
    autoResize: true,
    minHeight: '200px'
  });

  editorInstance.value = editor;

  // Add paste event listener to the textarea
  nextTick(() => {
    const textarea = getTextareaElement();
    if (textarea) {
      textarea.addEventListener('paste', handlePaste);
      textarea.addEventListener('input', handleNativeInput);
      // Keydown is handled by OverType config, or add manually if OverType consumes it:
      // textarea.addEventListener('keydown', handleKeydown);
    }
  });
}

function destroyEditor() {
  // Remove paste event listener
  const textarea = getTextareaElement();
  if (textarea) {
    textarea.removeEventListener('paste', handlePaste);
    textarea.removeEventListener('input', handleNativeInput);
  }

  if (editorInstance.value) {
    editorInstance.value.destroy();
    editorInstance.value = null;
  }
}

/* ───── watch for file presence (DOM mount/unmount) ───── */
watch(() => file.value, (newFile) => {
  if (newFile && !editorInstance.value) {
    // File selected but no editor - initialize on next tick
    nextTick(() => {
      if (!editorInstance.value && editorContainerRef.value) {
        initEditor();
      }
    });
  } else if (!newFile && editorInstance.value) {
    // No file selected - destroy editor
    destroyEditor();
  }
});

/* ───── watch for file changes ───── */
watch(() => file.value?.id, (newId, oldId) => {
  if (newId) {
    const newContent = file.value.content ?? '';

    // Initialize history for this file (keeps existing stack if revisited)
    historyStore.initialize(newId, newContent);

    contentDraft.value = newContent;
    draftStore.setDraft(newId, newContent);

    // If editor exists, update its value
    if (editorInstance.value) {
      editorInstance.value.setValue(newContent);
    } else {
      // If no editor, initialize it (will happen on next tick after DOM updates)
      nextTick(() => {
        initEditor();
      });
    }
  } else {
    contentDraft.value = '';
    if (editorInstance.value) {
      editorInstance.value.setValue('');
    }
  }
}, { immediate: true });

/* ───── stats ───── */
const wordCount = computed(() => (contentDraft.value ? contentDraft.value.trim().split(/\s+/).filter(Boolean).length : 0));
const characterCount = computed(() => contentDraft.value.length);
const lineCount = computed(() => (contentDraft.value ? contentDraft.value.split('\n').length : 0));

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
    const finalUrl = isProduction ? `/api${data.url}` : `${imageServiceUrl}${data.url}`;
    insertAtCursor(`![${fileObj.name}](${finalUrl})\n`);
  } catch (err) {
    console.error('Image upload error:', err);
    uploadError.value = err.message || 'Failed to upload image.';
  } finally {
    isUploading.value = false;
  }
}

/* ───── insertion helpers ───── */
function getTextareaElement() {
  // Access the underlying textarea from Overtype instance
  if (!editorInstance.value || !editorContainerRef.value) return null;
  return editorContainerRef.value.querySelector('textarea');
}

function insertAtCursor(text) {
  const textarea = getTextareaElement();
  if (!textarea || !editorInstance.value) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const currentText = textarea.value;

  // Create new text with insertion
  const beforeCursor = currentText.slice(0, start);
  const afterCursor = currentText.slice(end);
  const newText = beforeCursor + text + afterCursor;

  // Update textarea directly
  textarea.value = newText;

  // Calculate new cursor position
  const newCursorPos = start + text.length;

  // Set cursor position BEFORE triggering input event
  textarea.setSelectionRange(newCursorPos, newCursorPos);

  // Trigger input event to sync with Overtype
  const inputEvent = new Event('input', { bubbles: true });
  textarea.dispatchEvent(inputEvent);

  // Ensure focus
  textarea.focus();
}

function insertFormat(prefix, suffix) {
  const textarea = getTextareaElement();
  if (!textarea || !editorInstance.value) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const currentText = textarea.value;
  const selectedText = currentText.slice(start, end);

  // Create formatted text
  const beforeSelection = currentText.slice(0, start);
  const afterSelection = currentText.slice(end);
  const formattedText = prefix + selectedText + suffix;
  const newText = beforeSelection + formattedText + afterSelection;

  // Update textarea directly
  textarea.value = newText;

  // Set selection to the original selected text (now formatted)
  const newStart = start + prefix.length;
  const newEnd = newStart + selectedText.length;
  textarea.setSelectionRange(newStart, newEnd);

  // Trigger input event to sync with Overtype
  const inputEvent = new Event('input', { bubbles: true });
  textarea.dispatchEvent(inputEvent);

  // Ensure focus
  textarea.focus();
}

function insertList(prefix) {
  insertAtCursor(prefix);
}

function insertLink() {
  insertAtCursor('[Link text](url)');
}

function insertTable() {
  const tpl = `\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n`;
  insertAtCursor(tpl);
}

function insertCodeBlock() {
  insertAtCursor('\n```\n\n```\n');
}

function insertImagePlaceholder() {
  insertAtCursor('![Alt text](url)');
}

/* ───── find / replace ───── */
function findNext(term) {
  if (!term?.trim()) return;
  const textarea = getTextareaElement();
  if (!textarea) return;

  const text = textarea.value;
  let fromIdx = textarea.selectionEnd;

  // Search from current position
  let idx = text.indexOf(term, fromIdx);

  // If not found, wrap around to beginning
  if (idx === -1) {
    idx = text.indexOf(term, 0);
  }

  if (idx > -1) {
    textarea.focus();
    textarea.setSelectionRange(idx, idx + term.length);

    // Scroll into view
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
    const textBeforeCursor = text.substring(0, idx);
    const lineNumber = textBeforeCursor.split('\n').length;
    textarea.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
  }
}

function replaceNext(term, repl) {
  if (!term?.trim()) return;
  const textarea = getTextareaElement();
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);

  // If current selection matches the search term, replace it
  if (selectedText === term) {
    const currentText = textarea.value;
    const beforeSelection = currentText.slice(0, start);
    const afterSelection = currentText.slice(end);
    const newText = beforeSelection + repl + afterSelection;

    // Update textarea
    textarea.value = newText;

    // Set cursor after replacement
    const newCursorPos = start + repl.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // Trigger input event to sync with Overtype
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    textarea.focus();
  } else {
    // If selection doesn't match, find next occurrence
    findNext(term);
  }
}

function replaceAll(term, repl) {
  if (!term?.trim()) return;
  const textarea = getTextareaElement();
  if (!textarea || !editorInstance.value) return;

  const currentText = textarea.value;
  const newText = currentText.replaceAll(term, repl);

  if (currentText !== newText) {
    // Update textarea
    textarea.value = newText;

    // Trigger input event to sync with Overtype
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    textarea.focus();
  }
}

// Wrap your existing exposed methods
const insertFormatWrapped = wrapWithRecord(insertFormat);
const insertListWrapped = wrapWithRecord(insertList);
const insertLinkWrapped = wrapWithRecord(insertLink);
const insertTableWrapped = wrapWithRecord(insertTable);
const insertCodeBlockWrapped = wrapWithRecord(insertCodeBlock);
const insertImagePlaceholderWrapped = wrapWithRecord(insertImagePlaceholder);

// Helper wrappers for button enabling state
const canUndo = computed(() => file.value ? historyStore.canUndo(file.value.id) : false);
const canRedo = computed(() => file.value ? historyStore.canRedo(file.value.id) : false);

/* ───── expose methods for parent components ───── */
const exposedMethods = {
  insertFormat: insertFormatWrapped,
  insertList: insertListWrapped,
  insertLink: insertLinkWrapped,
  insertTable: insertTableWrapped,
  insertCodeBlock: insertCodeBlockWrapped,
  insertImagePlaceholder: insertImagePlaceholderWrapped,

  uploadImage,
  findNext,
  replaceNext,
  replaceAll,

  undo: performUndo,
  redo: performRedo,
  canUndo,
  canRedo,
};

defineExpose(exposedMethods);

/* ───── register/unregister with global store ───── */
onMounted(() => {
  nextTick(() => {
    initEditor();
  });
  editorStore.setEditorRef(exposedMethods);
});

onUnmounted(() => {
  destroyEditor();
  editorStore.clearEditorRef();
});
</script>
