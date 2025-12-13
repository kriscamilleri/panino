import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useHistoryStore = defineStore('historyStore', () => {
  // State: A map where keys are file Ids and values are { stack: [], index: number }
  const histories = ref({})

  const MAX_HISTORY = 100

  function getHistoryState(fileId) {
    if (!histories.value[fileId]) {
        // Initialize if not exists
        histories.value[fileId] = {
            stack: [{ text: '', cursor: 0 }],
            index: 0
        }
    }
    return histories.value[fileId]
  }

  /**
   * Called when a file is opened.
   * Ensures an entry exists and syncs the initial state if the stack is empty/default.
   */
  function initialize(fileId, currentText) {
    const state = getHistoryState(fileId)

    // If this is a fresh stack (only has empty init), but the file actually has content (from DB),
    // we should update the base state so the first Undo doesn't wipe the file.
    if (state.stack.length === 1 && state.stack[0].text === '' && currentText) {
        state.stack[0].text = currentText
    }
  }

  function record(fileId, text, cursor) {
    const state = getHistoryState(fileId)

    // 1. If we are in the middle of the stack (after undoing), discard the future
    if (state.index < state.stack.length - 1) {
        state.stack = state.stack.slice(0, state.index + 1)
    }

    // 2. Prevent duplicates
    const currentRecord = state.stack[state.index]
    if (currentRecord && currentRecord.text === text) return

    // 3. Push new state
    state.stack.push({ text, cursor })

    // 4. Enforce size limit
    if (state.stack.length > MAX_HISTORY) {
        state.stack.shift()
        // Index stays at end
    } else {
        state.index++
    }
  }

  function undo(fileId) {
    const state = getHistoryState(fileId)
    if (state.index <= 0) return null // Can't undo

    state.index--
    return state.stack[state.index]
  }

  function redo(fileId) {
    const state = getHistoryState(fileId)
    if (state.index >= state.stack.length - 1) return null // Can't redo

    state.index++
    return state.stack[state.index]
  }

  function canUndo(fileId) {
    const state = getHistoryState(fileId)
    return state.index > 0
  }

  function canRedo(fileId) {
    const state = getHistoryState(fileId)
    return state.index < state.stack.length - 1
  }

  // Optional: Clear history for a specific file (e.g., on delete)
  function clear(fileId) {
    delete histories.value[fileId]
  }

  return {
    initialize,
    record,
    undo,
    redo,
    canUndo,
    canRedo,
    clear
  }
})
