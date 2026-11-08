import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useGlobalVariablesStore } from '@/store/globalVariablesStore'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { useDocumentLinkStore } from '@/store/documentLinkStore'
import { useDocumentLinks } from '@/composables/useDocumentLinks'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { patchLinkTooltip } from '@/composables/useOverTypePatches'
import { caretRect, scrollCaretIntoView } from '@/utils/caretRect'
import { headingOffset, linkAt, pastedDocumentId, replaceRange, wikilinkQueryAt } from '@/utils/editorLinks'
import { escapeInlineText } from '@panino/content-merge/marker-blocks'
import { formatDocumentHref } from '@panino/content-merge/document-links'

/** Keys an open `[[` picker takes from the editor. */
const PICKER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'])

const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')

/**
 * Writing and following links in the editor's textarea
 * (docs/specs/active/editor-toc-and-internal-links.md §6.4, §6.5): `[[` opens the picker at
 * the caret (a sheet on the phone), Ctrl/Cmd+K and the toolbar Link button open it with
 * the selection as label, Cmd+click (macOS) or Ctrl+click follows the link under the
 * pointer, pasting this app's address of a Document writes a link to it, and OverType's
 * link tooltip follows internal links in the app.
 *
 * Its listeners sit on the textarea itself. OverType listens on the document, so a key
 * this handles (and stops) never reaches OverType's own shortcuts.
 *
 * @param {{ phone?: boolean, getFile: () => ({ id: string, dbKey: string }|null) }} options
 */
export function useEditorLinks({ phone = false, getFile }) {
    const docStore = useDocStore()
    const draftStore = useDraftStore()
    const editorStore = useEditorStore()
    const globalVariablesStore = useGlobalVariablesStore()
    const picker = useLinkPickerStore()
    const linkStore = useDocumentLinkStore()
    const { followHref } = useDocumentLinks()
    const { openSheet } = useSheetRoute()

    let textarea = null

    function source() {
        const file = getFile?.() || null
        return { sourceId: file?.id || null, sourceDbKey: file?.dbKey || null }
    }

    function markFocused() {
        const file = getFile?.()
        if (file?.id) picker.markEditorFocused(file.id)
    }

    /** Move the caret to a heading of this Document and scroll the Preview to it. */
    function goToHeading(slug) {
        const file = getFile?.()
        if (!file || !textarea) return
        linkStore.requestHeading(slug)
        if (!slug) return
        const text = draftStore.getDraft(file.id) ?? textarea.value
        const offset = headingOffset(text, slug, { globals: globalVariablesStore.globalsMap })
        if (offset === null) return
        textarea.focus()
        textarea.setSelectionRange(offset, offset)
        scrollCaretIntoView(textarea, offset)
    }

    function follow(href) {
        return followHref(href, { onHeading: goToHeading })
    }

    /**
     * Open the picker in link mode: Ctrl/Cmd+K, the toolbar Link button, the phone Link key.
     * The selection becomes the label and the first query.
     */
    function openPicker() {
        const area = textarea
        if (!area) return
        const start = area.selectionStart
        const end = area.selectionEnd
        const selected = area.value.slice(start, end)
        const label = selected.includes('\n') ? '' : selected
        picker.openPicker({
            mode: 'link',
            query: label.trim(),
            label,
            range: { start, end, text: selected },
            anchor: phone ? null : caretRect(area, start),
            ...source(),
        })
        if (phone) void openSheet('link')
    }

    function onInput(event) {
        const area = event.target
        if (area.selectionStart !== area.selectionEnd) {
            if (picker.open && picker.request?.mode === 'wikilink') picker.closePicker()
            return
        }
        const found = wikilinkQueryAt(area.value, area.selectionEnd)
        if (picker.open && picker.request?.mode === 'wikilink') {
            if (found) picker.updateWikilinkQuery(found.query, { start: found.start, end: found.end, text: area.value.slice(found.start, found.end) })
            else picker.closePicker()
            return
        }
        // Only the keystroke that typed the second `[` opens the picker.
        if (!found || found.query !== '' || event.inputType !== 'insertText' || event.data !== '[') return
        const range = { start: found.start, end: found.end, text: '[[' }
        if (phone) {
            picker.openPicker({ mode: 'link', range, ...source() })
            void openSheet('link')
            return
        }
        picker.openPicker({ mode: 'wikilink', range, anchor: caretRect(area, found.end), ...source() })
    }

    function onKeydown(event) {
        markFocused()
        const mod = isMac() ? event.metaKey : event.ctrlKey
        if (mod && !event.shiftKey && !event.altKey && (event.key === 'k' || event.key === 'K')) {
            event.preventDefault()
            event.stopPropagation()
            openPicker()
            return
        }
        if (picker.open && picker.request?.mode === 'wikilink' && PICKER_KEYS.has(event.key)
            && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            event.stopPropagation()
            picker.forwardKey(event.key)
        }
    }

    function onClick(event) {
        markFocused()
        const mod = isMac() ? event.metaKey : event.ctrlKey
        if (!mod) return
        const area = event.target
        const link = linkAt(area.value, area.selectionStart)
        if (!link) return
        event.preventDefault()
        void follow(link.href)
    }

    function onBlur() {
        // A click on the popover keeps the focus here (its rows prevent mousedown).
        if (picker.open && picker.request?.mode === 'wikilink') picker.closePicker()
    }

    /** Pasting this app's address of a Document writes a link to it, titled as it is now. */
    function onPaste(event) {
        const pasted = event.clipboardData?.getData?.('text/plain')
        if (!pasted) return
        const id = pastedDocumentId(pasted, window.location.origin, window.location.pathname)
        if (!id) return
        event.preventDefault()
        const area = event.target
        const start = area.selectionStart
        const end = area.selectionEnd
        void (async () => {
            const file = getFile?.()
            const target = (await docStore.resolveDocuments([id], { preferDbKey: file?.dbKey || null })).get(id)
            const text = target ? `[${escapeInlineText(target.title) || 'Untitled'}](${formatDocumentHref(id)})` : pasted
            editorStore.transformText((state) => replaceRange(state, Math.min(start, state.value.length), Math.min(end, state.value.length), text))
        })()
    }

    /**
     * @param {HTMLTextAreaElement} area
     * @param {object} [editor] the OverType instance, for its link tooltip
     */
    function attach(area, editor = null) {
        detach()
        if (!area) return
        textarea = area
        area.addEventListener('input', onInput)
        area.addEventListener('keydown', onKeydown)
        area.addEventListener('click', onClick)
        area.addEventListener('paste', onPaste)
        area.addEventListener('focus', markFocused)
        area.addEventListener('blur', onBlur)
        if (editor) patchLinkTooltip(editor, (url) => follow(url))
    }

    function detach() {
        if (!textarea) return
        textarea.removeEventListener('input', onInput)
        textarea.removeEventListener('keydown', onKeydown)
        textarea.removeEventListener('click', onClick)
        textarea.removeEventListener('paste', onPaste)
        textarea.removeEventListener('focus', markFocused)
        textarea.removeEventListener('blur', onBlur)
        textarea = null
        if (picker.open) picker.closePicker()
    }

    return { attach, detach, openPicker, follow }
}
