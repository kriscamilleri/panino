export const THEME_STORAGE_KEY = 'panino-theme'

export const THEMES = Object.freeze({
    LIGHT: 'light',
    DARK: 'dark',
})

export const DEFAULT_THEME = THEMES.LIGHT

/**
 * Restrict an arbitrary stored value to a supported theme.
 *
 * @param {unknown} theme Candidate theme value.
 * @returns {'light' | 'dark'} A supported theme.
 */
export function normalizeTheme(theme) {
    return theme === THEMES.DARK ? THEMES.DARK : DEFAULT_THEME
}

/**
 * Read and validate the saved browser theme preference.
 *
 * @param {Storage} storage Browser storage containing the preference.
 * @returns {'light' | 'dark'} The saved or default theme.
 */
export function getStoredTheme(storage) {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY))
}

/**
 * Persist a supported theme preference.
 *
 * @param {unknown} theme Theme to persist.
 * @param {Storage} storage Browser storage receiving the preference.
 * @returns {'light' | 'dark'} The normalized saved theme.
 */
export function saveTheme(theme, storage) {
    const normalizedTheme = normalizeTheme(theme)
    storage.setItem(THEME_STORAGE_KEY, normalizedTheme)
    return normalizedTheme
}

/**
 * Apply a theme to the document root for CSS selectors and native form controls.
 *
 * @param {unknown} theme Theme to apply.
 * @param {HTMLElement} root The document root element.
 * @returns {'light' | 'dark'} The normalized applied theme.
 */
export function applyTheme(theme, root) {
    const normalizedTheme = normalizeTheme(theme)
    root.dataset.theme = normalizedTheme
    root.style.colorScheme = normalizedTheme
    return normalizedTheme
}

/**
 * Return the opposite supported theme.
 *
 * @param {unknown} theme Current theme.
 * @returns {'light' | 'dark'} The next theme.
 */
export function toggleTheme(theme) {
    return normalizeTheme(theme) === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK
}
