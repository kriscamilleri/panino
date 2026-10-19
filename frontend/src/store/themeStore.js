import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
    THEME_STORAGE_KEY,
    applyTheme,
    getStoredPreference,
    normalizePreference,
    resolveTheme,
    toggleTheme as getToggledTheme,
} from '@/utils/themePreference'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const useThemeStore = defineStore('theme', () => {
    const systemQuery = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
    /** The Appearance choice: 'system', 'light' or 'dark'. */
    const preference = ref(getStoredPreference(window.localStorage))
    /** The theme on screen, always 'light' or 'dark'. */
    const theme = ref(resolveTheme(preference.value, Boolean(systemQuery?.matches)))

    function apply() {
        theme.value = applyTheme(
            resolveTheme(preference.value, Boolean(systemQuery?.matches)),
            document.documentElement,
        )
    }

    /**
     * Apply the saved preference before the application becomes interactive.
     */
    function initializeTheme() {
        apply()
        systemQuery?.addEventListener?.('change', () => {
            if (preference.value === 'system') apply()
        })
    }

    /**
     * Persist and immediately apply an Appearance choice.
     *
     * @param {unknown} nextPreference 'system', 'light' or 'dark'
     */
    function setPreference(nextPreference) {
        preference.value = normalizePreference(nextPreference)
        window.localStorage.setItem(THEME_STORAGE_KEY, preference.value)
        apply()
    }

    /**
     * Persist and immediately apply a requested color theme.
     *
     * @param {unknown} nextTheme Theme to persist and apply.
     */
    function setTheme(nextTheme) {
        setPreference(resolveTheme(nextTheme, false))
    }

    /**
     * Switch between the light and dark application themes.
     */
    function toggleTheme() {
        setTheme(getToggledTheme(theme.value))
    }

    return {
        preference,
        theme,
        initializeTheme,
        setPreference,
        setTheme,
        toggleTheme,
    }
})
