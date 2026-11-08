// @vitest-environment jsdom
// The table of contents entry points (docs/specs/active/editor-toc-and-internal-links.md
// §4.5): the desktop toolbar menu and the phone Document menu rows.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const toc = vi.hoisted(() => ({
    hasToc: false,
    isStale: false,
    canEdit: true,
    insert: null,
    refresh: null,
    remove: null,
    recompute: () => {},
}))
const sheet = vi.hoisted(() => ({ openSheet: null }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/store/tableOfContentsStore', async () => {
    const { reactive: makeReactive } = await import('vue')
    const state = makeReactive(toc)
    toc.state = state
    return { useTableOfContentsStore: () => state }
})
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ editorMenuCollapsed: false, closeAddonModal: vi.fn(), addToast: vi.fn() }) }))
vi.mock('@/store/addonsStore', () => ({ useAddonsStore: () => ({ fetchAddons: vi.fn(async () => {}), isActive: () => false }) }))
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ selectedFile: ref({ id: 'd1', title: 'Doc', content: 'x', dbKey: 'user:me' }) }) }))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }))
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ isOnline: true }) }))
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ preference: 'system', setPreference: vi.fn() }) }))
vi.mock('@/composables/useSheetRoute', () => ({ useSheetRoute: () => ({ openSheet: (...args) => sheet.openSheet(...args), closeSheetAndGo: vi.fn() }) }))
vi.mock('@/composables/usePhoneStatus', () => ({ usePhoneStatus: () => ({ sync: ref({}), liveParticipants: () => [], syncNow: vi.fn() }) }))

const { default: TocMenuButton } = await import('@/components/TocMenuButton.vue')
const { default: DocumentMenuSheet } = await import('@/components/phone/DocumentMenuSheet.vue')
const { useLinkPickerStore } = await import('@/store/linkPickerStore')

beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(toc.state, {
        hasToc: false,
        isStale: false,
        canEdit: true,
        insert: vi.fn(async () => true),
        refresh: vi.fn(async () => true),
        remove: vi.fn(async () => true),
    })
    sheet.openSheet = vi.fn()
})

describe('the desktop Table of contents menu', () => {
    it('sits beside Link and Page Break in the editor toolbar', () => {
        const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/SubMenuBar.vue'), 'utf8')
        expect(source).toMatch(/data-testid="submenu-editor-link"[\s\S]*?data-testid="submenu-editor-pagebreak"[\s\S]*?<TocMenuButton \/>/)
    })

    it('offers Insert and Options without a table, and Refresh, Options and Remove with one', async () => {
        const wrapper = mount(TocMenuButton, { attachTo: document.body })
        await wrapper.get('[data-testid="submenu-editor-toc"]').trigger('click')
        expect(document.querySelector('[data-testid="submenu-editor-toc-insert"]')).not.toBeNull()
        expect(document.querySelector('[data-testid="submenu-editor-toc-refresh"]')).toBeNull()
        expect(document.querySelector('[data-testid="submenu-editor-toc-remove"]')).toBeNull()
        document.querySelector('[data-testid="submenu-editor-toc-insert"]').click()
        await flushPromises()
        expect(toc.state.insert).toHaveBeenCalled()

        toc.state.hasToc = true
        toc.state.isStale = true
        await flushPromises()
        expect(wrapper.get('[data-testid="submenu-editor-toc"]').attributes('title')).toBe('Table of contents (out of date)')
        expect(wrapper.find('[data-testid="submenu-editor-toc-stale"]').exists()).toBe(true)
        await wrapper.get('[data-testid="submenu-editor-toc"]').trigger('click')
        expect(document.querySelector('[data-testid="submenu-editor-toc-refresh"]')).not.toBeNull()
        document.querySelector('[data-testid="submenu-editor-toc-options"]').click()
        await flushPromises()
        expect(useLinkPickerStore().tocOptionsOpen).toBe(true)
        await wrapper.get('[data-testid="submenu-editor-toc"]').trigger('click')
        document.querySelector('[data-testid="submenu-editor-toc-remove"]').click()
        await flushPromises()
        expect(toc.state.remove).toHaveBeenCalledWith(0)
        wrapper.unmount()
    })

    it('is off with no Document selected', () => {
        toc.state.canEdit = false
        const wrapper = mount(TocMenuButton)
        expect(wrapper.get('[data-testid="submenu-editor-toc"]').attributes('disabled')).toBeDefined()
    })
})

describe('the phone Document menu rows', () => {
    const stubs = {
        BottomSheet: { props: ['open'], template: '<div v-if="open"><slot name="header" /><slot /><slot name="footer" /></div>' },
        SegmentedControl: true,
        DocumentStylesModal: true,
        BaseModal: true,
        AddonActions: true,
        AddonModalHost: true,
    }

    it('reads Insert, then Refresh with "Out of date", and opens the options sheet', async () => {
        const wrapper = mount(DocumentMenuSheet, { props: { open: true }, global: { stubs } })
        expect(wrapper.get('[data-testid="phone-menu-toc"]').text()).toBe('Insert table of contents')
        await wrapper.get('[data-testid="phone-menu-toc"]').trigger('click')
        await flushPromises()
        expect(toc.state.insert).toHaveBeenCalledWith({ phone: true })
        expect(wrapper.emitted('close')).toHaveLength(1)

        toc.state.hasToc = true
        toc.state.isStale = true
        await flushPromises()
        expect(wrapper.get('[data-testid="phone-menu-toc"]').text()).toContain('Refresh table of contents')
        expect(wrapper.get('[data-testid="phone-menu-toc-stale"]').text()).toBe('Out of date')
        await wrapper.get('[data-testid="phone-menu-toc"]').trigger('click')
        await flushPromises()
        expect(toc.state.refresh).toHaveBeenCalled()

        await wrapper.get('[data-testid="phone-menu-toc-options"]').trigger('click')
        expect(sheet.openSheet).toHaveBeenCalledWith('toc')
    })
})

