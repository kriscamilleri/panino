import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
    applyTheme,
    getStoredTheme,
    saveTheme,
    toggleTheme as getToggledTheme,
} from '@/utils/themePreference'

export const useThemeStore = defineStore('theme', () => {
    const theme = ref(getStoredTheme(window.localStorage))

    /**
     * Apply the saved preference before the application becomes interactive.
     */
    function initializeTheme() {
        theme.value = applyTheme(theme.value, document.documentElement)
    }

    /**
     * Persist and immediately apply a requested color theme.
     *
     * @param {unknown} nextTheme Theme to persist and apply.
     */
    function setTheme(nextTheme) {
        theme.value = saveTheme(nextTheme, window.localStorage)
        theme.value = applyTheme(theme.value, document.documentElement)
    }

    /**
     * Switch between the light and dark application themes.
     */
    function toggleTheme() {
        setTheme(getToggledTheme(theme.value))
    }

    return {
        theme,
        initializeTheme,
        setTheme,
        toggleTheme,
    }
})
