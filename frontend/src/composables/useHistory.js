import { ref, computed } from 'vue'

export function useHistory(initialValue = '', maxHistory = 100) {
    // Initialize with the starting state
    const history = ref([{ text: initialValue, cursor: 0 }])
    const currentIndex = ref(0)

    const canUndo = computed(() => currentIndex.value > 0)
    const canRedo = computed(() => currentIndex.value < history.value.length - 1)

    function record(text, cursor) {
        // 1. If we are in the middle of the stack (after undoing), discard the future
        if (currentIndex.value < history.value.length - 1) {
            history.value = history.value.slice(0, currentIndex.value + 1)
        }

        // 2. Prevent duplicates (compare text content)
        const currentRecord = history.value[currentIndex.value]
        // If text hasn't changed, don't push a new state
        if (currentRecord && currentRecord.text === text) return

        // 3. Add new state
        history.value.push({ text, cursor })

        // 4. Enforce size limit
        if (history.value.length > maxHistory) {
            history.value.shift()
        } else {
            currentIndex.value = history.value.length - 1
        }
    }

    function undo() {
        if (!canUndo.value) return null
        currentIndex.value--
        return history.value[currentIndex.value]
    }

    function redo() {
        if (!canRedo.value) return null
        currentIndex.value++
        return history.value[currentIndex.value]
    }

    function clear(text = '') {
        history.value = [{ text, cursor: 0 }]
        currentIndex.value = 0
    }

    return {
        record,
        undo,
        redo,
        clear,
        canUndo,
        canRedo
    }
}
