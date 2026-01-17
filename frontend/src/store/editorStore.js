// Alternative approach: Store the editor reference in a global store
// Create a new file: /src/store/editorStore.js

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useEditorStore = defineStore('editorStore', () => {
    const editorRef = ref(null)

    function setEditorRef(ref) {
        editorRef.value = ref
    }

    function clearEditorRef() {
        editorRef.value = null
    }

    // Safe method wrappers
    function insertFormat(prefix, suffix) {
        if (editorRef.value && typeof editorRef.value.insertFormat === 'function') {
            editorRef.value.insertFormat(prefix, suffix)
        } else {
            console.warn('Editor not available for insertFormat')
        }
    }

    function insertList(prefix) {
        if (editorRef.value && typeof editorRef.value.insertList === 'function') {
            editorRef.value.insertList(prefix)
        } else {
            console.warn('Editor not available for insertList')
        }
    }

    function insertLink() {
        if (editorRef.value && typeof editorRef.value.insertLink === 'function') {
            editorRef.value.insertLink()
        } else {
            console.warn('Editor not available for insertLink')
        }
    }

    function insertTable() {
        if (editorRef.value && typeof editorRef.value.insertTable === 'function') {
            editorRef.value.insertTable()
        } else {
            console.warn('Editor not available for insertTable')
        }
    }

    function insertPageBreak() {
        if (editorRef.value && typeof editorRef.value.insertPageBreak === 'function') {
            editorRef.value.insertPageBreak()
        } else {
            console.warn('Editor not available for insertPageBreak')
        }
    }

    function insertCodeBlock() {
        if (editorRef.value && typeof editorRef.value.insertCodeBlock === 'function') {
            editorRef.value.insertCodeBlock()
        } else {
            console.warn('Editor not available for insertCodeBlock')
        }
    }

    function insertImagePlaceholder() {
        if (editorRef.value && typeof editorRef.value.insertImagePlaceholder === 'function') {
            editorRef.value.insertImagePlaceholder()
        } else {
            console.warn('Editor not available for insertImagePlaceholder')
        }
    }

    function uploadImage(file) {
        if (editorRef.value && typeof editorRef.value.uploadImage === 'function') {
            editorRef.value.uploadImage(file)
        } else {
            console.warn('Editor not available for uploadImage')
        }
    }

    function findNext(term) {
        if (editorRef.value && typeof editorRef.value.findNext === 'function') {
            editorRef.value.findNext(term)
        } else {
            console.warn('Editor not available for findNext')
        }
    }

    function replaceNext(term, replacement) {
        if (editorRef.value && typeof editorRef.value.replaceNext === 'function') {
            editorRef.value.replaceNext(term, replacement)
        } else {
            console.warn('Editor not available for replaceNext')
        }
    }

    function replaceAll(term, replacement) {
        if (editorRef.value && typeof editorRef.value.replaceAll === 'function') {
            editorRef.value.replaceAll(term, replacement)
        } else {
            console.warn('Editor not available for replaceAll')
        }
    }

    const isEditorAvailable = computed(() => {
        return editorRef.value !== null && typeof editorRef.value.insertFormat === 'function'
    })

    // Add reactive state proxies if you want buttons to disable/enable
    // Note: Since editorRef is not deeply reactive in the way Pinia might expect for
    // internal component state, usually we just fire methods.
    // For simple implementation, we just pass the calls through.

    function undo() {
        if (editorRef.value?.undo) editorRef.value.undo()
    }

    function redo() {
        if (editorRef.value?.redo) editorRef.value.redo()
    }

    return {
        editorRef,
        setEditorRef,
        clearEditorRef,
        insertFormat,
        insertList,
        insertLink,
        insertTable,
        insertPageBreak,
        insertCodeBlock,
        insertImagePlaceholder,
        uploadImage,
        findNext,
        replaceNext,
        replaceAll,
        isEditorAvailable,
        undo,
        redo,
    }
})
