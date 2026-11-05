// @vitest-environment jsdom
// The Navbar's Add-ons button: present while an add-on that is on has a toolbar
// action, and it opens the Add-ons submenu (docs/specs/active/addon-folders.md §6.2).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, reactive } from 'vue'

const ui = reactive({
    showViewMenu: false,
    showActionBar: false,
    showFileMenu: false,
    showAddonsMenu: false,
    navbarCollapsed: false,
    toggleViewMenu: vi.fn(),
    toggleActionBar: vi.fn(),
    toggleFileMenu: vi.fn(),
    toggleAddonsMenu: vi.fn(() => { ui.showAddonsMenu = !ui.showAddonsMenu }),
    toggleNavbarCollapsed: vi.fn(),
    addToast: vi.fn(),
})

vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }))
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ isAuthenticated: false, user: null, token: 'jwt' }) }))
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ syncEnabled: false, isOnline: true, isSyncing: false }) }))
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))
vi.mock('@/composables/useSyncToggle', () => ({ useSyncToggle: () => ({ toggleSync: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const Icon = { render: () => h('svg') }
vi.mock('@/addons/registry', () => {
    const manifests = [
        { id: 'probe', actions: [{ id: 'go', icon: Icon, label: 'Probe', modal: 'main' }] },
        { id: 'phoneonly', actions: [{ id: 'tap', icon: Icon, label: 'Tap', surfaces: ['menu'], modal: 'main' }] },
        { id: 'quiet' },
    ]
    return {
        ADDON_MANIFESTS: manifests,
        addonManifest: (id) => manifests.find((manifest) => manifest.id === id) || null,
        addonsContributing: (point) => manifests.filter((manifest) => manifest[point]),
    }
})

const { default: Navbar } = await import('@/components/Navbar.vue')
const { useAddonsStore } = await import('@/store/addonsStore')

/** Mark these add-ons offered and on. */
function enabled(...ids) {
    const store = useAddonsStore()
    store.addons = ids.map((id) => ({ id, name: id, description: '', enabled: true, enabledAt: null }))
    store.isLoaded = true
}

function mountNavbar() {
    return mount(Navbar, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
}

describe('Navbar Add-ons button', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        ui.showAddonsMenu = false
        ui.toggleAddonsMenu.mockClear()
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    })

    it('is absent while no add-on with a toolbar action is on', async () => {
        enabled('phoneonly', 'quiet')
        const wrapper = mountNavbar()
        await flushPromises()
        expect(wrapper.find('[data-testid="navbar-addons-button"]').exists()).toBe(false)
    })

    it('shows after Tools and toggles the Add-ons menu', async () => {
        enabled('probe')
        const wrapper = mountNavbar()
        await flushPromises()
        const button = wrapper.get('[data-testid="navbar-addons-button"]')
        expect(button.text()).toBe('Add-ons')
        expect(wrapper.html().indexOf('navbar-tools-button')).toBeLessThan(wrapper.html().indexOf('navbar-addons-button'))

        await button.trigger('click')
        expect(ui.toggleAddonsMenu).toHaveBeenCalledOnce()
        expect(ui.showAddonsMenu).toBe(true)
    })

    it('closes the open menu when its last add-on is switched off', async () => {
        enabled('probe')
        const wrapper = mountNavbar()
        await flushPromises()
        await wrapper.get('[data-testid="navbar-addons-button"]').trigger('click')
        expect(ui.showAddonsMenu).toBe(true)

        enabled()
        await flushPromises()
        expect(wrapper.find('[data-testid="navbar-addons-button"]').exists()).toBe(false)
        expect(ui.showAddonsMenu).toBe(false)
    })
})
