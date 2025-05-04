// src/store/uiStore.js
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from './authStore'
import { useSyncStore } from './syncStore'

/**
 * UI store now PERSISTS panel/menu state (Documents, Editor, Preview, Stats, Metadata)
 * by saving a single document (uiSettingsDoc) in the user's PouchDB database.
 * That doc live-syncs just like any other, so the layout follows the user.
 */
export const useUiStore = defineStore('uiStore', () => {
    /* ------------------------------------------------------------------
     * Helpers
     * ----------------------------------------------------------------*/
    const authStore = useAuthStore()
    const syncStore = useSyncStore()

    function getLocalDB() {
        if (!authStore.isAuthenticated || authStore.user?.name === 'guest') {
            return new PouchDB('pn-markdown-notes-guest')
        }
        return new PouchDB(`pn-markdown-notes-${authStore.user.name.toLowerCase()}`)
    }

    function debounce(fn, wait = 500) {
        let t
        return (...args) => {
            clearTimeout(t)
            t = setTimeout(() => fn(...args), wait)
        }
    }

    /* ------------------------------------------------------------------
     * Reactive state
     * ----------------------------------------------------------------*/
    // Panel visibility
    const showDocuments = ref(true)
    const showEditor = ref(true)
    const showPreview = ref(true)

    // Menu visibility (UI only – not persisted)
    const showViewMenu = ref(false)
    const showActionBar = ref(false)
    const showFileMenu = ref(false)

    // Import modal
    const showImportModal = ref(false)

    // Stats & metadata panels
    const showStats = ref(false)
    const showMetadata = ref(false)

    // Toasts
    const toasts = ref([])

    /* ------------------------------------------------------------------
     * Persistence: load / save
     * ----------------------------------------------------------------*/
    let settingsLoaded = false

    async function loadSettingsFromDB() {
        if (!syncStore.isInitialized) return // called again once ready via watcher below
        try {
            const db = getLocalDB()
            const doc = await db.get('uiSettingsDoc')
            if (doc.panels) {
                const p = doc.panels
                showDocuments.value = p.showDocuments ?? true
                showEditor.value = p.showEditor ?? true
                showPreview.value = p.showPreview ?? true
                showStats.value = p.showStats ?? false
                showMetadata.value = p.showMetadata ?? false
            }
            settingsLoaded = true
        } catch (err) {
            if (err.status === 404) {
                // No doc yet; keep defaults
                settingsLoaded = true
            } else {
                console.error('[uiStore] failed to load UI settings', err)
            }
        }
    }

    const saveSettingsDebounced = debounce(saveSettingsToDB, 400)

    async function saveSettingsToDB() {
        if (!settingsLoaded) return // don't save until first load completes
        try {
            const db = getLocalDB()
            let doc
            try {
                doc = await db.get('uiSettingsDoc')
            } catch (err) {
                doc = { _id: 'uiSettingsDoc' }
            }
            doc.panels = {
                showDocuments: showDocuments.value,
                showEditor: showEditor.value,
                showPreview: showPreview.value,
                showStats: showStats.value,
                showMetadata: showMetadata.value
            }
            doc.lastModified = new Date().toISOString()
            await db.put(doc)
        } catch (err) {
            console.error('[uiStore] failed to save UI settings', err)
        }
    }

    // Load once syncStore is ready
    if (syncStore.isInitialized) loadSettingsFromDB()
    else watch(() => syncStore.isInitialized, v => { if (v) loadSettingsFromDB() })

    // Reload settings when user switches account
    watch(() => authStore.user?.name, () => {
        settingsLoaded = false
        loadSettingsFromDB()
    })

    /* ------------------------------------------------------------------
     * Computed helpers
     * ----------------------------------------------------------------*/
    const isAnyMenuOpen = computed(() =>
        showViewMenu.value || showActionBar.value || showFileMenu.value
    )

    /* ------------------------------------------------------------------
     * Panel toggles (persisted)
     * ----------------------------------------------------------------*/
    function toggleDocuments() {
        showDocuments.value = !showDocuments.value
        saveSettingsDebounced()
    }
    function toggleEditor() {
        showEditor.value = !showEditor.value
        saveSettingsDebounced()
    }
    function togglePreview() {
        showPreview.value = !showPreview.value
        saveSettingsDebounced()
    }

    /* ------------------------------------------------------------------
     * Menu toggles (UI only)
     * ----------------------------------------------------------------*/
    function toggleViewMenu() {
        if (showViewMenu.value) showViewMenu.value = false
        else {
            showActionBar.value = false
            showFileMenu.value = false
            showViewMenu.value = true
        }
    }
    function toggleActionBar() {
        if (showActionBar.value) showActionBar.value = false
        else {
            showViewMenu.value = false
            showFileMenu.value = false
            showActionBar.value = true
        }
    }
    function toggleFileMenu() {
        if (showFileMenu.value) showFileMenu.value = false
        else {
            showViewMenu.value = false
            showActionBar.value = false
            showFileMenu.value = true
        }
    }

    /* ------------------------------------------------------------------
     * Stats / metadata toggles (persisted)
     * ----------------------------------------------------------------*/
    function toggleStats() {
        showStats.value = !showStats.value
        saveSettingsDebounced()
    }
    function toggleMetadata() {
        showMetadata.value = !showMetadata.value
        saveSettingsDebounced()
    }

    /* ------------------------------------------------------------------
     * Misc
     * ----------------------------------------------------------------*/
    function closeAllMenus() {
        showViewMenu.value = false
        showActionBar.value = false
        showFileMenu.value = false
    }

    // Import modal
    function openImportModal() { showImportModal.value = true }
    function closeImportModal() { showImportModal.value = false }

    // Toast helpers
    function addToast(message, duration = 5000) {
        const id = Date.now().toString() + Math.random().toString(36).slice(2)
        toasts.value.push({ id, message })
        setTimeout(() => removeToast(id), duration)
    }
    function removeToast(id) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    /* ------------------------------------------------------------------
     * Public API
     * ----------------------------------------------------------------*/
    return {
        // reactive refs
        showDocuments,
        showEditor,
        showPreview,
        showViewMenu,
        showActionBar,
        showFileMenu,
        showImportModal,
        showStats,
        showMetadata,
        toasts,

        // computed
        isAnyMenuOpen,

        // actions
        toggleDocuments,
        toggleEditor,
        togglePreview,
        toggleViewMenu,
        toggleActionBar,
        toggleFileMenu,
        toggleStats,
        toggleMetadata,
        closeAllMenus,
        openImportModal,
        closeImportModal,
        addToast,
        removeToast
    }
})
