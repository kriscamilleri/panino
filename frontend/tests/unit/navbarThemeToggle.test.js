// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { themeStoreMock } = vi.hoisted(() => ({
    themeStoreMock: {
        theme: 'light',
        toggleTheme: vi.fn(),
    },
}))

const uiStoreMock = {
    showViewMenu: false,
    showActionBar: false,
    showFileMenu: false,
    navbarCollapsed: false,
    toggleViewMenu: vi.fn(),
    toggleActionBar: vi.fn(),
    toggleFileMenu: vi.fn(),
    toggleNavbarCollapsed: vi.fn(),
    addToast: vi.fn(),
}

vi.mock('@/store/uiStore', () => ({
    useUiStore: () => uiStoreMock,
}))

vi.mock('@/store/authStore', () => ({
    useAuthStore: () => ({
        isAuthenticated: false,
        user: null,
    }),
}))

vi.mock('@/store/syncStore', () => ({
    useSyncStore: () => ({
        syncEnabled: false,
        isOnline: true,
        isSyncing: false,
    }),
}))

vi.mock('@/store/themeStore', () => ({
    useThemeStore: () => themeStoreMock,
}))

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
}))

const Navbar = (await import('@/components/Navbar.vue')).default

describe('Navbar theme toggle', () => {
    it('exposes the light-mode state and toggles the theme from the right navbar controls', async () => {
        themeStoreMock.theme = 'light'
        themeStoreMock.toggleTheme.mockClear()
        const wrapper = mount(Navbar, {
            global: {
                stubs: {
                    RouterLink: { template: '<a><slot /></a>' },
                },
            },
        })

        const toggle = wrapper.get('[data-testid="navbar-theme-toggle"]')
        expect(toggle.attributes('aria-pressed')).toBe('false')
        expect(toggle.attributes('title')).toBe('Switch to dark mode')

        await toggle.trigger('click')

        expect(themeStoreMock.toggleTheme).toHaveBeenCalledOnce()
    })

    it('places the theme label before its icon and toggles navbar label collapse', async () => {
        themeStoreMock.theme = 'light'
        uiStoreMock.navbarCollapsed = false
        uiStoreMock.toggleNavbarCollapsed.mockClear()
        const wrapper = mount(Navbar, {
            global: {
                stubs: {
                    RouterLink: { template: '<a><slot /></a>' },
                },
            },
        })

        const themeToggle = wrapper.get('[data-testid="navbar-theme-toggle"]')
        expect(themeToggle.text()).toContain('Dark')
        expect(themeToggle.text()).not.toContain('mode')
        expect(themeToggle.html().indexOf('Dark')).toBeLessThan(themeToggle.html().indexOf('<svg'))

        await wrapper.get('[data-testid="navbar-collapse-button"]').trigger('click')

        expect(uiStoreMock.toggleNavbarCollapsed).toHaveBeenCalledOnce()
    })
})
