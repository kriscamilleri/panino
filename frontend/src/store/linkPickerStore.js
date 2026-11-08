// /frontend/src/store/linkPickerStore.js
/**
 * Screen state for writing links and tables of contents
 * (docs/specs/active/editor-toc-and-internal-links.md §4.4, §6.4): the one link picker,
 * opened by `[[`, Ctrl/Cmd+K, the toolbar Link button or the phone Link key; the table of
 * contents Options dialog; and whether the editor has had focus for the open Document,
 * which decides where Insert puts a table. Nothing here is persisted.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * @typedef {object} PickerRequest
 * @property {'wikilink'|'link'} mode `wikilink`: typed `[[`, the query is the text after it
 *   in the editor; `link`: the picker has its own field (Ctrl/Cmd+K, toolbar, phone)
 * @property {string} [query] the first query
 * @property {string} [label] selected text, used as the link's label
 * @property {{ start: number, end: number, text: string }|null} [range] the editor text the
 *   link replaces (`[[query`, or the selection)
 * @property {{ top: number, left: number, bottom: number }|null} [anchor] the caret on screen
 * @property {string|null} [sourceId] the Document being edited
 * @property {string|null} [sourceDbKey] its database
 */

export const useLinkPickerStore = defineStore('linkPickerStore', () => {
  const open = ref(false)
  /** @type {import('vue').Ref<PickerRequest|null>} */
  const request = ref(null)
  /** The `[[` query as typed in the editor, while a wikilink picker is open. */
  const query = ref('')
  /** Keys the editor forwards to an open wikilink picker: `{ key, nonce }`. */
  const forwardedKey = ref(null)

  /** @param {PickerRequest} next */
  function openPicker(next) {
    request.value = { range: null, anchor: null, label: '', query: '', sourceId: null, sourceDbKey: null, ...next }
    query.value = next.query || ''
    open.value = true
  }

  function closePicker() {
    open.value = false
    request.value = null
    query.value = ''
  }

  /** @param {string} next @param {{ start: number, end: number, text: string }} range */
  function updateWikilinkQuery(next, range) {
    if (!open.value || request.value?.mode !== 'wikilink') return
    query.value = next
    request.value = { ...request.value, range }
  }

  let keyNonce = 0
  /** @param {'ArrowUp'|'ArrowDown'|'Enter'|'Tab'|'Escape'} key */
  function forwardKey(key) {
    keyNonce += 1
    forwardedKey.value = { key, nonce: keyNonce }
  }

  // Table of contents Options (desktop dialog; the phone uses ?sheet=toc).
  const tocOptionsOpen = ref(false)
  const tocOptionsIndex = ref(0)

  function openTocOptions(index = 0) {
    tocOptionsIndex.value = index
    tocOptionsOpen.value = true
  }

  function closeTocOptions() {
    tocOptionsOpen.value = false
  }

  // Whether the editor has had focus since this Document opened.
  const focusedDocumentId = ref(null)

  function markEditorFocused(documentId) {
    focusedDocumentId.value = documentId || null
  }

  function editorHadFocus(documentId) {
    return Boolean(documentId) && focusedDocumentId.value === documentId
  }

  return {
    open,
    request,
    query,
    forwardedKey,
    openPicker,
    closePicker,
    updateWikilinkQuery,
    forwardKey,
    tocOptionsOpen,
    tocOptionsIndex,
    openTocOptions,
    closeTocOptions,
    markEditorFocused,
    editorHadFocus,
  }
})
