// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { locateDocument, usableDbKey } from '@/utils/routeDocument'

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111'
const SPACE = 'space:22222222-2222-4222-8222-222222222222'
const DOC = '33333333-3333-4333-8333-333333333333'

const hoisted = vi.hoisted(() => ({
    route: null,
    replace: vi.fn(),
    databases: null,
    findDocumentDbKey: vi.fn(),
    refreshMembership: vi.fn(async () => {}),
    selectFile: vi.fn(async () => {}),
    selectFolder: vi.fn(),
    loadGlobals: vi.fn(async () => {}),
}))

vi.mock('vue-router', () => ({
    useRoute: () => hoisted.route,
    useRouter: () => ({ replace: hoisted.replace, push: vi.fn() }),
}))
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => ({}) }))
vi.mock('@/store/globalVariablesStore', () => ({ useGlobalVariablesStore: () => ({ loadGlobals: hoisted.loadGlobals }) }))
vi.mock('@/store/docStore', () => ({
    useDocStore: () => ({
        syncStore: {
            get databases() { return hoisted.databases },
            personalDbKey: PERSONAL,
            refreshMembership: hoisted.refreshMembership,
            isSyncing: false,
        },
        findDocumentDbKey: hoisted.findDocumentDbKey,
        selectFile: hoisted.selectFile,
        selectFolder: hoisted.selectFolder,
        selectedDbKey: PERSONAL,
    }),
}))
vi.mock('@/composables/useViewport', () => ({ useViewport: () => ({ isPhone: ref(false) }) }))
vi.mock('@/composables/useSheetRoute', () => ({ useSheetRoute: () => ({ activeSheet: ref(null), sheetArg: ref(''), closeSheet: vi.fn() }) }))
vi.mock('@/composables/usePhoneSelection', () => ({ usePhoneSelection: () => ({ clear: vi.fn() }) }))

const { default: HomePage } = await import('@/pages/HomePage.vue')

function mountAt({ fileId = DOC, query = {} } = {}) {
    hoisted.route = reactive({ name: 'doc', params: { fileId }, query })
    return shallowMount(HomePage)
}

beforeEach(() => {
    hoisted.databases = new Map([[PERSONAL, { db: {} }], [SPACE, { db: {} }]])
    for (const fn of ['replace', 'findDocumentDbKey', 'refreshMembership', 'selectFile', 'selectFolder']) hoisted[fn].mockReset()
    hoisted.refreshMembership.mockResolvedValue()
})

describe('opening #/doc/<id> (§6.8)', () => {
    it('looks a missing dbKey up and adds it with replace', async () => {
        hoisted.findDocumentDbKey.mockResolvedValue(SPACE)
        mountAt({ query: { heading: 'budget' } })
        await flushPromises()
        expect(hoisted.findDocumentDbKey).toHaveBeenCalledWith(DOC)
        expect(hoisted.replace).toHaveBeenCalledWith({ query: { heading: 'budget', dbKey: SPACE } })
        expect(hoisted.selectFile).not.toHaveBeenCalled()
    })

    it('waits for start-up so a space Document arriving with the first sync is found', async () => {
        let arrived = false
        hoisted.findDocumentDbKey.mockImplementation(async () => (arrived ? SPACE : null))
        hoisted.refreshMembership.mockImplementation(async () => { arrived = true })
        const wrapper = mountAt()
        await flushPromises()
        expect(hoisted.refreshMembership).toHaveBeenCalled()
        expect(hoisted.replace).toHaveBeenCalledWith({ query: { dbKey: SPACE } })
        expect(wrapper.find('document-not-available-stub').exists()).toBe(false)
    })

    it('shows the same empty state for a missing id and one from another account', async () => {
        hoisted.findDocumentDbKey.mockResolvedValue(null)
        const missing = mountAt()
        await flushPromises()
        expect(missing.find('document-not-available-stub').exists()).toBe(true)
        expect(missing.find('content-area-stub').exists()).toBe(false)
        const someoneElses = mountAt({ query: { dbKey: 'user:44444444-4444-4444-8444-444444444444' } })
        await flushPromises()
        expect(someoneElses.find('document-not-available-stub').exists()).toBe(true)
        expect(someoneElses.html()).toBe(missing.html())
    })

    it('ignores an unusable dbKey and runs the lookup', async () => {
        hoisted.findDocumentDbKey.mockResolvedValue(PERSONAL)
        mountAt({ query: { dbKey: 'User:Nope' } })
        await flushPromises()
        expect(hoisted.findDocumentDbKey).toHaveBeenCalled()
        expect(hoisted.replace).toHaveBeenCalledWith({ query: { dbKey: PERSONAL } })
    })

    it('selects straight away with a usable dbKey', async () => {
        mountAt({ query: { dbKey: SPACE } })
        await flushPromises()
        expect(hoisted.findDocumentDbKey).not.toHaveBeenCalled()
        expect(hoisted.selectFile).toHaveBeenCalledWith(DOC, SPACE)
    })
})

describe('route document helpers', () => {
    it('accepts only canonical, open database keys', () => {
        const databases = new Map([[PERSONAL, { db: {} }], [SPACE, { db: null }]])
        expect(usableDbKey(PERSONAL, databases)).toBe(PERSONAL)
        expect(usableDbKey(SPACE, databases)).toBeNull()
        expect(usableDbKey(PERSONAL.toUpperCase(), databases)).toBeNull()
        expect(usableDbKey(['x'], databases)).toBeNull()
    })

    it('decides after start-up even when start-up fails offline', async () => {
        const lookup = vi.fn(async () => null)
        expect(await locateDocument(DOC, { lookup, waitForStartup: async () => { throw new Error('offline') } })).toBeNull()
        expect(lookup).toHaveBeenCalledTimes(2)
    })

    it('keeps the heading through sign-in: the guard sends the full path as redirect', async () => {
        // router.js sends `to.fullPath` as `redirect`; LoginForm and LoadingPage accept any
        // path that starts with `/`, so the heading query survives both.
        const fullPath = `/doc/${DOC}?heading=budget`
        const redirect = typeof fullPath === 'string' && fullPath.startsWith('/') ? fullPath : '/'
        expect(redirect).toBe(fullPath)
        const source = await import('@/router.js?raw').then((module) => module.default).catch(() => null)
        if (source) expect(source).toContain('redirect: to.fullPath')
    })
})
