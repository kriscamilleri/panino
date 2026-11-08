// /frontend/src/store/tableOfContentsStore.js
/**
 * The open Document's tables of contents (docs/specs/active/editor-toc-and-internal-links.md
 * §4.4): whether it has one, whether one is out of date, and the actions Insert, Refresh,
 * Options and Remove. Every edit is a pure function from shared/tableOfContents.js applied
 * through `editorStore.transformText`, so it is one undo step and saves, syncs and travels
 * through a live session like typing. Nothing is ever rewritten without being asked.
 */
import { computed, ref, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import {
    DEFAULT_TOC_TITLE,
    applyTocOptions,
    documentOutline,
    insertToc,
    resolveTocLevels,
    refreshTocs,
    removeToc,
    tocOptions,
    tocStatus,
} from '@panino/content-merge/table-of-contents'
import { useDocStore } from './docStore'
import { useDraftStore } from './draftStore'
import { useEditorStore } from './editorStore'
import { useUiStore } from './uiStore'
import { useGlobalVariablesStore } from './globalVariablesStore'
import { useConflictStore } from './conflictStore'
import { useHistoryStore } from './historyStore'
import { useCollabSessionStore } from './collabSessionStore'
import { useLinkPickerStore } from './linkPickerStore'

/** Stale checks wait this long after typing; longer for very large Documents. */
const STALE_DEBOUNCE_MS = 300
const LARGE_DOCUMENT = 1024 * 1024
const LARGE_DEBOUNCE_MS = 1500

export const UP_TO_DATE_MESSAGE = 'Table of contents is up to date'

export const useTableOfContentsStore = defineStore('tableOfContentsStore', () => {
    const docStore = useDocStore()
    const draftStore = useDraftStore()
    const editorStore = useEditorStore()
    const ui = useUiStore()
    const globalVariablesStore = useGlobalVariablesStore()
    const conflictStore = useConflictStore()
    const linkPickerStore = useLinkPickerStore()
    const { selectedFile } = storeToRefs(docStore)

    const status = ref({ count: 0, damaged: [], stale: false })

    const text = computed(() => {
        const file = selectedFile.value
        if (!file) return ''
        const draft = draftStore.getDraft(file.id)
        return draft ?? file.content ?? ''
    })

    const variables = () => ({ globals: globalVariablesStore.globalsMap })

    let timer = null
    function recompute() {
        clearTimeout(timer)
        timer = null
        try {
            status.value = tocStatus(text.value, { variables: variables() })
        } catch (error) {
            console.error('[tableOfContentsStore] Checking the table of contents failed:', error)
            status.value = { count: 0, damaged: [], stale: false }
        }
    }

    watch(text, (value) => {
        clearTimeout(timer)
        // Most Documents have no table: answer at once and never parse them.
        if (!value || value.indexOf('<!-- panino:toc') === -1) {
            timer = null
            status.value = { count: 0, damaged: [], stale: false }
            return
        }
        timer = setTimeout(recompute, value.length > LARGE_DOCUMENT ? LARGE_DEBOUNCE_MS : STALE_DEBOUNCE_MS)
    }, { immediate: true })
    watch(() => selectedFile.value?.id, () => recompute())
    watch(() => globalVariablesStore.globalsMap, () => { if (status.value.count) recompute() })

    const hasToc = computed(() => status.value.count > 0)
    const isStale = computed(() => status.value.stale)
    const canEdit = computed(() => Boolean(selectedFile.value))

    /**
     * Apply a pure edit to the open Document. Through the editor when it is mounted;
     * otherwise (desktop with the editor hidden) straight to the saved text, unless a
     * stored conflict holds the Document.
     *
     * @param {(state: object) => object|null} fn
     * @param {{ focus?: boolean }} [options] focus the editor afterwards (desktop Insert)
     * @returns {Promise<boolean>} whether the text changed
     */
    async function edit(fn, { focus = false } = {}) {
        const file = selectedFile.value
        if (!file) return false
        if (editorStore.isEditorAvailable) {
            return editorStore.transformText((state) => fn(state) || null, { focus })
        }
        if (conflictStore.hasConflict(file.id, file.dbKey)) {
            ui.addToast('Resolve the document changes before editing this Document.', 'info')
            return false
        }
        // A live session's text goes through the editor's binding only; writing
        // the saved text here would be overwritten by the session's commit.
        const collab = useCollabSessionStore()
        if (collab.isActive && collab.noteId === file.id) {
            ui.addToast('Open the editor to change the table of contents during a live session.', 'info')
            return false
        }
        const value = text.value
        const next = fn({ value, selectionStart: 0, selectionEnd: 0 })
        if (!next || next.value === value) return false
        // Undo works for this edit as for one made in the editor.
        const history = useHistoryStore()
        history.initialize(file.id, value)
        history.record(file.id, next.value)
        draftStore.setDraft(file.id, next.value)
        await docStore.updateFileContent(file.id, next.value, file.dbKey)
        return true
    }

    /**
     * Insert a table: after the caret's line on a desktop editor that has had focus,
     * otherwise after a leading H1 or at the top. With a table present, refresh instead.
     *
     * @param {{ phone?: boolean }} [options]
     */
    async function insert({ phone = false } = {}) {
        if (!selectedFile.value) return false
        recompute()
        if (hasToc.value) return refresh()
        const atCaret = !phone && editorStore.isEditorAvailable && linkPickerStore.editorHadFocus(selectedFile.value.id)
        const changed = await edit((state) => insertToc(state, { atCaret, variables: variables() }), { focus: atCaret })
        recompute()
        return changed
    }

    /** Refresh every closed, valid table. */
    async function refresh() {
        if (!selectedFile.value) return false
        let damaged = []
        let changed = false
        let count = 0
        const applied = await edit((state) => {
            const result = refreshTocs(state, { variables: variables() })
            damaged = result.damaged
            count = result.count
            changed = result.changed
            if (!result.changed && damaged.length) {
                // Point at the first damaged table.
                const at = damaged[0].block.start
                return { value: state.value, selectionStart: at, selectionEnd: at }
            }
            return result.changed ? result.state : null
        })
        recompute()
        if (damaged.length) {
            const unclosed = damaged.some((toc) => toc.problem === 'unclosed')
            ui.addToast(unclosed
                ? "The table of contents can't be refreshed: its end marker is missing"
                : "The table of contents can't be refreshed: its settings are damaged", 'warning')
        } else if (!changed && count) {
            ui.addToast(UP_TO_DATE_MESSAGE, 'success', 2500)
        }
        return applied
    }

    /**
     * @param {number} [index]
     * @returns {{ min: number, max: number, numbered: boolean, title: string }}
     */
    function optionsFor(index = 0) {
        const existing = tocOptions(text.value, index, variables())
        if (existing) return existing
        // No table yet: the adaptive levels Insert would use.
        const levels = resolveTocLevels({ min: null, max: null }, documentOutline(text.value, variables()))
        return { ...levels, numbered: true, title: DEFAULT_TOC_TITLE }
    }

    /**
     * Rewrite one table's marker with new options and refresh it; insert a table with
     * them when the Document has none.
     *
     * @param {number} index
     * @param {{ min: number, max: number, numbered: boolean, title: string }} options
     */
    async function applyOptions(index, options) {
        if (!selectedFile.value) return false
        if (!hasToc.value) {
            const atCaret = editorStore.isEditorAvailable && linkPickerStore.editorHadFocus(selectedFile.value.id)
            const changed = await edit((state) => insertToc(state, { atCaret, variables: variables(), settings: options }))
            recompute()
            return changed
        }
        const changed = await edit((state) => applyTocOptions(state, index, options, { variables: variables() }))
        recompute()
        return changed
    }

    /** @param {number} [index] */
    async function remove(index = 0) {
        const changed = await edit((state) => removeToc(state, index))
        recompute()
        return changed
    }

    return {
        status,
        hasToc,
        isStale,
        canEdit,
        recompute,
        insert,
        refresh,
        optionsFor,
        applyOptions,
        remove,
    }
})
