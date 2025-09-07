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
    
    function insertTable() {
        if (editorRef.value && typeof editorRef.value.insertTable === 'function') {
            editorRef.value.insertTable()
        } else {
            console.warn('Editor not available for insertTable')
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
    
    return {
        editorRef,
        setEditorRef,
        clearEditorRef,
        insertFormat,
        insertList,
        insertTable,
        insertCodeBlock,
        insertImagePlaceholder,
        uploadImage,
        findNext,
        replaceNext,
        replaceAll,
        isEditorAvailable
    }
})