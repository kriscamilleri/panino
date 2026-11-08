import { useEditorStore } from '@/store/editorStore'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { replaceRange } from '@/utils/editorLinks'

/**
 * Write the picker's choice into the Document: it replaces what the picker was opened
 * on (`[[query`, or the selection) when that text is still there, else it goes in at
 * the caret. Through `transformText`, so it is one undo step.
 */
export function useLinkPickerChoice() {
    const editorStore = useEditorStore()
    const picker = useLinkPickerStore()

    /**
     * @param {string} markdown
     * @returns {boolean} whether the text changed
     */
    function apply(markdown) {
        const range = picker.request?.range || null
        const changed = editorStore.transformText((state) => {
            if (range && range.end <= state.value.length && state.value.slice(range.start, range.end) === range.text) {
                return replaceRange(state, range.start, range.end, markdown)
            }
            return replaceRange(state, state.selectionStart, state.selectionEnd, markdown)
        })
        picker.closePicker()
        return changed
    }

    return { apply }
}
