// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { createPinia, defineStore } from 'pinia'
import { createDocumentRenderer } from '@panino/content-merge/markdown-render'

const SELF = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222'
const GONE = 'cccccccc-3333-4333-8333-333333333333'

const hoisted = vi.hoisted(() => ({
    push: vi.fn(async () => {}),
    toast: vi.fn(),
    flush: vi.fn(async () => {}),
    headingRequest: null,
    route: null,
}))

vi.mock('vue-router', () => ({
    useRoute: () => hoisted.route,
    useRouter: () => ({ push: hoisted.push }),
}))
vi.mock('@/store/stylePresetStore', () => ({ useStylePresetStore: () => ({ resolveForSelected: () => ({ values: undefined }) }) }))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }))
vi.mock('@/store/markdownStore', () => ({ useMarkdownStore: () => ({ applyMetadataVariables: (text) => text }) }))
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: hoisted.toast }) }))
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => ({ flushPendingSave: hoisted.flush }) }))
vi.mock('@/store/tableOfContentsStore', () => ({ useTableOfContentsStore: () => ({ isStale: false, refresh: () => {} }) }))
vi.mock('@/store/documentLinkStore', () => ({
    useDocumentLinkStore: () => ({ version: 0, get headingRequest() { return hoisted.headingRequest }, requestHeading: vi.fn() }),
}))

const resolved = {
    [OTHER]: { id: OTHER, dbKey: 'space:22222222-2222-4222-8222-222222222222', title: 'Project plan', folderPath: 'Proposals', spaceName: 'Acme' },
}
const resolveDocuments = vi.fn(async (ids) => new Map(ids.map((id) => [id, resolved[id] || null])))

vi.mock('@/store/docStore', () => ({
    useDocStore: defineStore('doc', {
        state: () => ({ selectedFile: null, selectedFileContent: '' }),
        actions: {
            getMarkdownIt: () => createDocumentRenderer({ documentLinks: 'app' }),
            resolveDocuments: (...args) => resolveDocuments(...args),
        },
    }),
}))

const { default: Preview } = await import('@/components/Preview.vue')
const { useDocStore } = await import('@/store/docStore')

const CONTENT = [
    '## Budget',
    '',
    `[Here](#budget) [Plan](panino:doc/${OTHER}#budget) [Gone](panino:doc/${GONE}) [Screen](#/addons/ai/authorize?client_id=x) [Nowhere](#nowhere)`,
].join('\n')

let wrapper
async function mountPreview({ content = CONTENT, source = null } = {}) {
    const pinia = createPinia()
    wrapper = mount(Preview, {
        props: source === null ? {} : { source },
        global: { plugins: [pinia] },
        attachTo: document.body,
    })
    const docStore = useDocStore(pinia)
    docStore.selectedFile = { id: SELF, dbKey: 'user:me', content }
    docStore.selectedFileContent = content
    await flushPromises()
    await flushPromises()
    return wrapper
}

function click(selector, init = {}) {
    const element = wrapper.find(selector).element
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    element.dispatchEvent(event)
    return event
}

beforeEach(() => {
    hoisted.route = reactive({ params: { fileId: SELF }, query: {} })
    hoisted.push.mockClear()
    hoisted.toast.mockClear()
    resolveDocuments.mockClear()
})
afterEach(() => wrapper?.unmount())

describe('Preview links', () => {
    it('scrolls to a heading in the Document without touching the router', async () => {
        await mountPreview()
        const event = click('a[href="#pn-budget"]')
        expect(event.defaultPrevented).toBe(true)
        expect(hoisted.push).not.toHaveBeenCalled()
        expect(document.activeElement?.id).toBe('pn-budget')
    })

    it('opens another Document through the router with its dbKey and heading', async () => {
        await mountPreview()
        const event = click(`a[data-pn-doc="${OTHER}"]`)
        expect(event.defaultPrevented).toBe(true)
        await flushPromises()
        expect(hoisted.flush).toHaveBeenCalled()
        expect(hoisted.push).toHaveBeenCalledWith({
            name: 'doc',
            params: { fileId: OTHER },
            query: { dbKey: 'space:22222222-2222-4222-8222-222222222222', heading: 'budget' },
        })
    })

    it('toasts and stays for a Document that does not resolve', async () => {
        await mountPreview()
        click(`a[data-pn-doc="${GONE}"]`)
        await flushPromises()
        expect(hoisted.push).not.toHaveBeenCalled()
        expect(hoisted.toast).toHaveBeenCalledWith("This Document isn't available. It may have been deleted, or it isn't shared with you.", 'info')
    })

    it('leaves a modified click on a resolved link to the browser', async () => {
        await mountPreview()
        const event = click(`a[data-pn-doc="${OTHER}"]`, { ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(hoisted.push).not.toHaveBeenCalled()
    })

    it('renders hand-written app routes inert and never lets a # link navigate', async () => {
        await mountPreview()
        const screen = wrapper.find('span.pn-link-broken')
        expect(screen.text()).toBe('Screen')
        expect(screen.attributes('title')).toBe("Links to Panino screens aren't supported")
        expect(click('a[href="#nowhere"]').defaultPrevented).toBe(true)
        expect(hoisted.push).not.toHaveBeenCalled()
    })

    it('decorates Document links with a title or the broken style, through the DOM', async () => {
        await mountPreview()
        const plan = wrapper.find(`a[data-pn-doc="${OTHER}"]`)
        expect(plan.attributes('title')).toBe('Project plan — Acme space · Proposals')
        expect(plan.classes()).not.toContain('pn-link-broken')
        const gone = wrapper.find(`a[data-pn-doc="${GONE}"]`)
        expect(gone.attributes('title')).toBe('Not found, or not shared with you')
        expect(gone.classes()).toContain('pn-link-broken')
        expect(resolveDocuments).toHaveBeenCalledWith([OTHER, GONE], { preferDbKey: 'user:me' })
        // A fragment that matches nothing, and one that does.
        expect(wrapper.find('a[href="#nowhere"]').classes()).toContain('pn-link-broken')
        expect(wrapper.find('a[href="#pn-budget"]').classes()).not.toContain('pn-link-broken')
    })

    it('keeps every internal link inert while showing other text (a capture draft)', async () => {
        await mountPreview({ source: CONTENT })
        expect(click(`a[data-pn-doc="${OTHER}"]`).defaultPrevented).toBe(true)
        expect(click('a[href="#pn-budget"]').defaultPrevented).toBe(true)
        await flushPromises()
        expect(hoisted.push).not.toHaveBeenCalled()
        expect(document.activeElement?.id).not.toBe('pn-budget')
    })

    it('scrolls to the heading named in the address once, and says when it is gone', async () => {
        hoisted.route = reactive({ params: { fileId: SELF }, query: { heading: 'budget' } })
        await mountPreview()
        await flushPromises()
        expect(document.activeElement?.id).toBe('pn-budget')
        wrapper.unmount()
        hoisted.route = reactive({ params: { fileId: SELF }, query: { heading: 'renamed' } })
        await mountPreview()
        await flushPromises()
        expect(hoisted.toast).toHaveBeenCalledWith('Heading not found', 'info')
    })

    it('gives numbered tables of contents the class that hides their bullets', async () => {
        await mountPreview({ content: '<!-- panino:toc {"v":1,"min":2,"max":3} -->\n- 1 [Budget](#budget)\n<!-- /panino:toc -->\n\n## Budget\n' })
        expect(wrapper.find('nav.pn-toc.pn-toc-numbered').exists()).toBe(true)
        expect(wrapper.find('nav a[href="#pn-budget"]').exists()).toBe(true)
    })
})

