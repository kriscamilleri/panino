import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, defineStore, setActivePinia } from 'pinia'

// Reactive, like the real draft store, so the store's computed text follows edits.
const hoisted = await vi.hoisted(async () => {
    const { reactive } = await import('vue')
    return reactive({
        state: { value: '', selectionStart: 0, selectionEnd: 0 },
        available: true,
        toast: vi.fn(),
        transforms: 0,
        focusOptions: [],
    })
})

vi.mock('@/store/editorStore', () => ({
    useEditorStore: () => ({
        get isEditorAvailable() { return hoisted.available },
        transformText(fn, options) {
            hoisted.transforms += 1
            hoisted.focusOptions.push(options)
            const next = fn({ ...hoisted.state })
            if (!next) return false
            const changed = next.value !== hoisted.state.value
            hoisted.state = { value: next.value, selectionStart: next.selectionStart, selectionEnd: next.selectionEnd }
            return changed
        },
    }),
}))
vi.mock('@/store/docStore', () => ({
    useDocStore: defineStore('doc', {
        state: () => ({ selectedFile: { id: 'd1', dbKey: 'user:me', content: '' } }),
        actions: { updateFileContent: vi.fn() },
    }),
}))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => hoisted.state.value, setDraft: vi.fn() }) }))
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: hoisted.toast }) }))
vi.mock('@/store/globalVariablesStore', () => ({ useGlobalVariablesStore: () => ({ globalsMap: new Map() }) }))
vi.mock('@/store/conflictStore', () => ({ useConflictStore: () => ({ hasConflict: () => false }) }))

const { useTableOfContentsStore, UP_TO_DATE_MESSAGE } = await import('@/store/tableOfContentsStore')
const { useLinkPickerStore } = await import('@/store/linkPickerStore')

function setText(value, caret = 0) {
    hoisted.state = { value, selectionStart: caret, selectionEnd: caret }
}

describe('the table of contents actions', () => {
    let toc
    beforeEach(() => {
        setActivePinia(createPinia())
        hoisted.toast.mockClear()
        hoisted.transforms = 0
        hoisted.focusOptions = []
        hoisted.available = true
        setText('# Plan\n\nIntro\n\n## Intro\n\n### Background\n\n## Budget\n')
        toc = useTableOfContentsStore()
        toc.recompute()
    })

    it('inserts after the leading H1 when the editor has not had focus (U1)', async () => {
        expect(toc.hasToc).toBe(false)
        expect(await toc.insert()).toBe(true)
        expect(hoisted.transforms).toBe(1)
        expect(hoisted.state.value).toBe([
            '# Plan',
            '',
            '<!-- panino:toc {"v":1,"min":2,"max":3} -->',
            '**Contents**',
            '',
            '- 1 [Intro](#intro)',
            '  - 1.1 [Background](#background)',
            '- 2 [Budget](#budget)',
            '<!-- /panino:toc -->',
            '',
            'Intro',
            '',
            '## Intro',
            '',
            '### Background',
            '',
            '## Budget',
            '',
        ].join('\n'))
        toc.recompute()
        expect(toc.hasToc).toBe(true)
        expect(toc.isStale).toBe(false)
    })

    it('inserts after the caret line once the editor had focus, and focuses it', async () => {
        useLinkPickerStore().markEditorFocused('d1')
        setText(hoisted.state.value, hoisted.state.value.indexOf('Intro\n'))
        await toc.insert()
        expect(hoisted.state.value).toContain('Intro\n\n<!-- panino:toc')
        expect(hoisted.focusOptions.at(-1)).toEqual({ focus: true })
    })

    it('refreshes when a table is present, and says when nothing changed', async () => {
        await toc.insert()
        toc.recompute()
        await toc.insert()
        expect(hoisted.toast).toHaveBeenCalledWith(UP_TO_DATE_MESSAGE, 'success', 2500)
        setText(`${hoisted.state.value}\n## Risks\n`)
        toc.recompute()
        expect(toc.isStale).toBe(true)
        await toc.refresh()
        expect(hoisted.state.value).toContain('- 3 [Risks](#risks)')
        expect(toc.isStale).toBe(false)
    })

    it('refuses a damaged table and points at it', async () => {
        setText('## A\n\n<!-- panino:toc -->\nno end\n')
        toc.recompute()
        await toc.refresh()
        expect(hoisted.toast).toHaveBeenCalledWith("The table of contents can't be refreshed: its end marker is missing", 'warning')
        expect(hoisted.state.selectionStart).toBe('## A\n\n'.length)
    })

    it('applies options and removes the table, each as one edit', async () => {
        await toc.insert()
        toc.recompute()
        expect(toc.optionsFor(0)).toEqual({ min: 2, max: 3, numbered: true, title: 'Contents' })
        hoisted.transforms = 0
        await toc.applyOptions(0, { min: 1, max: 4, numbered: false, title: '' })
        expect(hoisted.transforms).toBe(1)
        expect(hoisted.state.value).toContain('{"v":1,"min":1,"max":4,"numbered":false,"title":""}')
        await toc.remove(0)
        expect(hoisted.state.value).not.toContain('panino:toc')
    })

    it('offers the adaptive levels before a table exists, and inserts with chosen options', async () => {
        expect(toc.optionsFor(0)).toEqual({ min: 2, max: 3, numbered: true, title: 'Contents' })
        await toc.applyOptions(0, { min: 2, max: 2, numbered: true, title: 'On this page' })
        expect(hoisted.state.value).toContain('"title":"On this page"} -->\n**On this page**')
    })
})
