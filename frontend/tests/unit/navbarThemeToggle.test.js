// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { themeStoreMock } = vi.hoisted(() => ({
    themeStoreMock: {
        theme: 'light',
        toggleTheme: vi.fn(),
    },
}))

vi.mock('@/store/uiStore', () => ({
    useUiStore: () => ({
        showViewMenu: false,
        showActionBar: false,
        showFileMenu: false,
        toggleViewMenu: vi.fn(),
        toggleActionBar: vi.fn(),
        toggleFileMenu: vi.fn(),
        addToast: vi.fn(),
    }),
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
})
