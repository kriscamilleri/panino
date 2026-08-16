// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { THEME_STORAGE_KEY, THEMES } from '@/utils/themePreference'
import { useThemeStore } from '@/store/themeStore'

describe('themeStore', () => {
    beforeEach(() => {
        window.localStorage.clear()
        delete document.documentElement.dataset.theme
        document.documentElement.style.colorScheme = ''
        setActivePinia(createPinia())
    })

    it('initializes the root from the saved preference', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, THEMES.DARK)
        const store = useThemeStore()

        store.initializeTheme()

        expect(store.theme).toBe(THEMES.DARK)
        expect(document.documentElement.dataset.theme).toBe(THEMES.DARK)
        expect(document.documentElement.style.colorScheme).toBe(THEMES.DARK)
    })

    it('persists and applies a selected theme', () => {
        const store = useThemeStore()

        store.setTheme(THEMES.DARK)

        expect(store.theme).toBe(THEMES.DARK)
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEMES.DARK)
        expect(document.documentElement.dataset.theme).toBe(THEMES.DARK)
    })

    it('toggles the active theme and updates browser storage', () => {
        const store = useThemeStore()

        store.toggleTheme()

        expect(store.theme).toBe(THEMES.DARK)
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEMES.DARK)
    })
})
