// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
    applyTheme,
    DEFAULT_THEME,
    getStoredTheme,
    saveTheme,
    THEMES,
    THEME_STORAGE_KEY,
    toggleTheme,
} from '@/utils/themePreference'

function createStorage(initialValue = null) {
    let value = initialValue

    return {
        getItem: (key) => (key === THEME_STORAGE_KEY ? value : null),
        setItem: (key, nextValue) => {
            if (key === THEME_STORAGE_KEY) value = nextValue
        },
    }
}

describe('themePreference', () => {
    it('defaults missing and unsupported saved preferences to light', () => {
        expect(getStoredTheme(createStorage())).toBe(DEFAULT_THEME)
        expect(getStoredTheme(createStorage('system'))).toBe(THEMES.LIGHT)
    })

    it('reads and saves supported theme preferences', () => {
        const storage = createStorage(THEMES.DARK)

        expect(getStoredTheme(storage)).toBe(THEMES.DARK)
        expect(saveTheme(THEMES.LIGHT, storage)).toBe(THEMES.LIGHT)
        expect(getStoredTheme(storage)).toBe(THEMES.LIGHT)
    })

    it('normalizes unsupported saved values to the light theme', () => {
        const storage = createStorage()

        expect(saveTheme('unknown', storage)).toBe(THEMES.LIGHT)
        expect(getStoredTheme(storage)).toBe(THEMES.LIGHT)
    })

    it('applies the data attribute and native color scheme to a root element', () => {
        const root = document.createElement('html')

        expect(applyTheme(THEMES.DARK, root)).toBe(THEMES.DARK)
        expect(root.dataset.theme).toBe(THEMES.DARK)
        expect(root.style.colorScheme).toBe(THEMES.DARK)
    })

    it('toggles between the two supported themes', () => {
        expect(toggleTheme(THEMES.LIGHT)).toBe(THEMES.DARK)
        expect(toggleTheme(THEMES.DARK)).toBe(THEMES.LIGHT)
        expect(toggleTheme('invalid')).toBe(THEMES.DARK)
    })
})
