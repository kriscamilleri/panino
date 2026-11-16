// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const PLAN = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const SPACE_DOC = '11111111-2222-4333-8444-555555555555'
const SPACE = 'space:99999999-9999-4999-8999-999999999999'

const hoisted = vi.hoisted(() => ({
    openSheet: vi.fn(),
    transform: vi.fn(),
    searches: [],
    followed: [],
}))

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/composables/useSheetRoute', () => ({ useSheetRoute: () => ({ openSheet: hoisted.openSheet }) }))
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }))
vi.mock('@/store/globalVariablesStore', () => ({ useGlobalVariablesStore: () => ({ globalsMap: new Map() }) }))
vi.mock('@/store/syncStore', () => ({
    useSyncStore: () => ({ databases: new Map([['user:me', { kind: 'user', name: 'Personal' }], [SPACE, { kind: 'space', name: 'Acme' }]]) }),
}))
vi.mock('@/store/editorStore', () => ({
    useEditorStore: () => ({ transformText: hoisted.transform, flushPendingSave: vi.fn(), focus: vi.fn() }),
}))
const documents = [
    { id: PLAN, dbKey: 'user:me', title: 'Project plan', folderPath: 'Proposals', spaceName: null, updatedAt: '2026-11-01T00:00:00Z' },
    { id: SPACE_DOC, dbKey: SPACE, title: 'Acme brief', folderPath: '', spaceName: 'Acme', updatedAt: '2026-10-01T00:00:00Z' },
]
const outlines = {
    self: [{ level: 2, text: 'Budget', slug: 'budget', listed: true }, { level: 2, text: 'Risks', slug: 'risks', listed: true }],
    [PLAN]: [{ level: 2, text: 'Budget', slug: 'budget', listed: true }],
}
vi.mock('@/store/documentLinkStore', () => ({
    useDocumentLinkStore: () => ({
        searchLinkTargets: async (query) => {
            hoisted.searches.push(query)
            return documents.filter((doc) => doc.title.toLowerCase().includes(query.toLowerCase()))
        },
        requestHeading: vi.fn(),
    }),
}))
vi.mock('@/store/docStore', () => ({
    useDocStore: () => ({
        selectedFile: { id: 'self', dbKey: 'user:me' },
        getDocumentOutline: async (id) => outlines[id] || [],
        resolveDocuments: async () => new Map(),
    }),
}))

const { default: LinkPicker } = await import('@/components/LinkPicker.vue')
const { useEditorLinks } = await import('@/composables/useEditorLinks')
const { useLinkPickerStore } = await import('@/store/linkPickerStore')
const { useLinkPickerChoice } = await import('@/composables/useLinkPickerChoice')

async function settle() {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
}

let wrappers = []
afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount()
    wrappers = []
})

function mountPicker(props) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(LinkPicker, { props: { sourceId: 'self', sourceDbKey: 'user:me', ...props }, global: { plugins: [pinia] }, attachTo: document.body })
    wrappers.push(wrapper)
    return wrapper
}

describe('the link picker', () => {
    it('lists Documents for a [[ query and writes a link to the chosen one', async () => {
        const wrapper = mountPicker({ mode: 'wikilink', query: 'proj' })
        await settle()
        expect(wrapper.find('[data-testid="link-picker-row-0"]').text()).toContain('Project plan')
        expect(wrapper.find('[data-testid="link-picker-row-0"]').text()).toContain('Proposals')
        await wrapper.setProps({ forwardedKey: { key: 'Enter', nonce: 1 } })
        expect(wrapper.emitted('choose')[0]).toEqual([`[Project plan](panino:doc/${PLAN})`])
    })

    it('lists this Document\'s headings after [[#', async () => {
        const wrapper = mountPicker({ mode: 'wikilink', query: '#bud' })
        await settle()
        expect(wrapper.findAll('[role="option"]').map((row) => row.find('.pn-link-picker-title').text())).toEqual(['Budget'])
        await wrapper.find('[data-testid="link-picker-row-0"]').trigger('click')
        expect(wrapper.emitted('choose')[0]).toEqual(['[Budget](#budget)'])
    })

    it('lists the chosen Document\'s headings once # is typed after it', async () => {
        const wrapper = mountPicker({ mode: 'wikilink', query: 'Project' })
        await settle()
        await wrapper.setProps({ query: 'Project#' })
        await settle()
        expect(wrapper.find('[data-testid="link-picker-row-0"]').text()).toContain('Budget')
        await wrapper.setProps({ forwardedKey: { key: 'Enter', nonce: 2 } })
        expect(wrapper.emitted('choose')[0]).toEqual([`[Budget](panino:doc/${PLAN}#budget)`])
    })

    it('writes a web address typed in its field, with the selection as label', async () => {
        const wrapper = mountPicker({ mode: 'link', query: 'see docs', label: 'see docs' })
        await settle()
        await wrapper.find('[data-testid="link-picker-input"]').setValue('https://example.com/a')
        await settle()
        await wrapper.find('[data-testid="link-picker-input"]').trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('choose')[0]).toEqual(['[see docs](https://example.com/a)'])
    })

    it('shows a note and the link text before linking into another database', async () => {
        const wrapper = mountPicker({ mode: 'link', query: 'Acme' })
        await settle()
        await wrapper.find('[data-testid="link-picker-input"]').trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('choose')).toBeUndefined()
        expect(wrapper.find('[data-testid="link-picker-note"]').text()).toContain('Only members of Acme can open this Document.')
        expect(wrapper.find('[data-testid="link-picker-label"]').text()).toBe('Acme brief')
        await wrapper.find('[data-testid="link-picker-confirm"]').trigger('click')
        expect(wrapper.emitted('choose')[0]).toEqual([`[Acme brief](panino:doc/${SPACE_DOC})`])
    })

    it('warns space members when a space Document links elsewhere', async () => {
        const wrapper = mountPicker({ mode: 'link', query: 'Project', sourceDbKey: SPACE })
        await settle()
        await wrapper.find('[data-testid="link-picker-input"]').trigger('keydown', { key: 'Enter' })
        expect(wrapper.find('[data-testid="link-picker-note"]').text()).toContain('Members of Acme may not be able to open this Document.')
    })
})

/** A textarea with the editor's link handling attached, as Editor.vue attaches it. */
const Harness = defineComponent({
    props: { phone: Boolean },
    setup(props) {
        const api = useEditorLinks({ phone: props.phone, getFile: () => ({ id: 'self', dbKey: 'user:me' }) })
        return { api }
    },
    render() {
        return h('textarea', { onVnodeMounted: (vnode) => this.api.attach(vnode.el) })
    },
})

describe('the editor side of links', () => {
    let textarea
    let links
    let picker

    function mountHarness(phone = false) {
        const pinia = createPinia()
        setActivePinia(pinia)
        picker = useLinkPickerStore()
        const wrapper = mount(Harness, { props: { phone }, global: { plugins: [pinia] }, attachTo: document.body })
        wrappers.push(wrapper)
        links = wrapper.vm.api
        textarea = wrapper.find('textarea').element
    }

    beforeEach(() => {
        hoisted.openSheet.mockClear()
        mountHarness(false)
    })

    function type(text) {
        for (const char of text) {
            const start = textarea.selectionStart
            textarea.value = textarea.value.slice(0, start) + char + textarea.value.slice(textarea.selectionEnd)
            textarea.setSelectionRange(start + 1, start + 1)
            textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: char, bubbles: true }))
        }
    }

    it('opens the [[ picker at the caret and follows the query as it is typed', () => {
        type('see [[')
        expect(picker.open).toBe(true)
        expect(picker.request).toMatchObject({ mode: 'wikilink', range: { start: 4, end: 6, text: '[[' }, sourceId: 'self' })
        type('proj')
        expect(picker.query).toBe('proj')
        expect(picker.request.range).toEqual({ start: 4, end: 10, text: '[[proj' })
        const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
        textarea.dispatchEvent(down)
        expect(down.defaultPrevented).toBe(true)
        expect(picker.forwardedKey.key).toBe('ArrowDown')
        type(']')
        expect(picker.open).toBe(false)
    })

    it('replaces [[query with the chosen link in one edit', () => {
        type('see [[proj')
        let applied
        hoisted.transform.mockImplementation((fn) => {
            applied = fn({ value: textarea.value, selectionStart: 10, selectionEnd: 10 })
            return true
        })
        useLinkPickerChoice().apply(`[Project plan](panino:doc/${PLAN})`)
        expect(applied.value).toBe(`see [Project plan](panino:doc/${PLAN})`)
        expect(picker.open).toBe(false)
    })

    it('opens the picker with the selection as label on Ctrl/Cmd+K, before OverType sees it', () => {
        textarea.value = 'read the plan now'
        textarea.setSelectionRange(9, 13)
        const outer = vi.fn()
        document.addEventListener('keydown', outer)
        const isMac = /mac/i.test(navigator.platform || navigator.userAgent || '')
        const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true })
        textarea.dispatchEvent(event)
        document.removeEventListener('keydown', outer)
        expect(event.defaultPrevented).toBe(true)
        expect(outer).not.toHaveBeenCalled()
        expect(picker.request).toMatchObject({ mode: 'link', label: 'plan', query: 'plan', range: { start: 9, end: 13, text: 'plan' } })
    })

    it('opens the phone sheet for [[ and the Link key', async () => {
        wrappers.pop().unmount()
        mountHarness(true)
        type('[[')
        await nextTick()
        expect(hoisted.openSheet).toHaveBeenCalledWith('link')
        expect(picker.request).toMatchObject({ mode: 'link', range: { start: 0, end: 2, text: '[[' } })
        links.openPicker()
        expect(hoisted.openSheet).toHaveBeenCalledTimes(2)
    })
})
