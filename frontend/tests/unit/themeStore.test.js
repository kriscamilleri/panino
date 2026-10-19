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

    it('follows the system scheme while Appearance is System', () => {
        const listeners = []
        let matches = true
        window.matchMedia = () => ({
            get matches() { return matches },
            addEventListener: (_type, listener) => listeners.push(listener),
        })
        window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
        const store = useThemeStore()
        store.initializeTheme()

        expect(store.preference).toBe('system')
        expect(store.theme).toBe(THEMES.DARK)

        matches = false
        listeners.forEach((listener) => listener())
        expect(store.theme).toBe(THEMES.LIGHT)
        expect(document.documentElement.dataset.theme).toBe(THEMES.LIGHT)

        store.setPreference(THEMES.DARK)
        matches = true
        listeners.forEach((listener) => listener())
        expect(store.preference).toBe(THEMES.DARK)
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEMES.DARK)
        delete window.matchMedia
    })
})
