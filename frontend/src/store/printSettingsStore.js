import { defineStore } from 'pinia'
import { ref } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from './authStore'
import { useSyncStore } from './syncStore'

/**
 * This store manages "Print Settings" with the ability to:
 *  - Define sets of Tailwind classes or HTML markup for leading/trailing pages, header, footer
 *  - Save multiple named templates
 *  - Sync with CouchDB so they persist across sessions
 */

export const usePrintSettingsStore = defineStore('printSettingsStore', () => {
    const authStore = useAuthStore()
    const syncStore = useSyncStore()

    // Whether we've loaded from DB at least once
    const isLoaded = ref(false)

    // The currently active template ID
    const activeTemplateId = ref(null)

    /**
     * Each template can have:
     *  {
     *    id: string,
     *    name: string,
     *    tailwindClasses: string,
     *    leadingPageHtml: string,
     *    trailingPageHtml: string,
     *    headerHtml: string,
     *    footerHtml: string,
     *
     *    enableLeadingPage: boolean,
     *    enableTrailingPage: boolean,
     *    enableHeader: boolean,
     *    enableFooter: boolean
     *  }
     */
    const templates = ref([])

    // Two sample templates (for first-time users)
    const sampleTemplates = [
        {
            id: 'classic-template',
            name: 'Classic Layout',
            tailwindClasses: 'text-base leading-relaxed mx-auto mt-10 mb-10 max-w-2xl',

            leadingPageHtml: '<h1 class="text-4xl font-bold mb-4">My Document Title</h1><p>Written by You.</p>',
            trailingPageHtml: '<p class="mt-8">Endnotes or references here.</p>',
            headerHtml: '<div class="border-b pb-2 mb-4 text-sm text-gray-700">Header: Classic Layout</div>',
            footerHtml: '<div class="border-t pt-2 mt-4 text-sm text-gray-700">Footer: Page <span class="pageNumber"></span></div>',

            enableLeadingPage: true,
            enableTrailingPage: true,
            enableHeader: true,
            enableFooter: true
        },
        {
            id: 'minimal-template',
            name: 'Minimal Layout',
            tailwindClasses: 'prose mx-auto p-4',

            leadingPageHtml: '<h1 class="font-serif text-3xl mb-2">Minimal Title</h1><p class="text-gray-500">Just the basics.</p>',
            trailingPageHtml: '<p>No fancy details—just the essentials.</p>',
            headerHtml: '<div class="text-sm text-gray-600 mb-2 italic">Minimal Header</div>',
            footerHtml: '<div class="text-xs text-gray-500 mt-2 border-t pt-1">Minimal Footer</div>',

            enableLeadingPage: true,
            enableTrailingPage: true,
            enableHeader: true,
            enableFooter: true
        }
    ]

    /**
     * Loads our printSettingsDoc from local DB. If none found, create a default doc with sample templates.
     */
    async function loadPrintSettings() {
        if (!syncStore.isInitialized) {
            await syncStore.initializeDB() // ensure DB is ready
        }
        try {
            const db = getLocalDB()
            let doc
            try {
                doc = await db.get('printSettingsDoc')
            } catch (err) {
                if (err.status !== 404) {
                    throw err
                }
                // Not found => create doc with sample templates
                doc = {
                    _id: 'printSettingsDoc',
                    templates: sampleTemplates,
                    activeTemplateId: sampleTemplates[0].id,
                    lastModified: new Date().toISOString()
                }
                await db.put(doc)
            }

            // Migrate older keys (if any)
            migrateTemplates(doc.templates)

            templates.value = doc.templates
            activeTemplateId.value = doc.activeTemplateId || (templates.value[0]?.id ?? null)
            isLoaded.value = true
        } catch (error) {
            console.error('Error loading print settings:', error)
        }
    }

    /**
     * Save the current templates & active template ID to the DB
     */
    async function savePrintSettings() {
        try {
            const db = getLocalDB()
            const doc = await fetchOrCreatePrintSettingsDoc(db)

            // Make sure we call migrate (in case new booleans or rename happened)
            migrateTemplates(templates.value)

            doc.templates = templates.value
            doc.activeTemplateId = activeTemplateId.value
            doc.lastModified = new Date().toISOString()
            await db.put(doc)
        } catch (err) {
            console.error('Error saving print settings:', err)
        }
    }

    /**
     * Add or update a template in memory, then persist
     */
    async function upsertTemplate(template) {
        // Ensure booleans exist
        if (typeof template.enableLeadingPage !== 'boolean') {
            template.enableLeadingPage = true
        }
        if (typeof template.enableTrailingPage !== 'boolean') {
            template.enableTrailingPage = true
        }
        if (typeof template.enableHeader !== 'boolean') {
            template.enableHeader = true
        }
        if (typeof template.enableFooter !== 'boolean') {
            template.enableFooter = true
        }

        const existingIndex = templates.value.findIndex(t => t.id === template.id)
        if (existingIndex >= 0) {
            templates.value[existingIndex] = { ...template }
        } else {
            templates.value.push({ ...template })
        }
        await savePrintSettings()
    }

    /**
     * Remove a template by ID
     */
    async function removeTemplate(templateId) {
        const idx = templates.value.findIndex(t => t.id === templateId)
        if (idx !== -1) {
            templates.value.splice(idx, 1)
            if (activeTemplateId.value === templateId) {
                activeTemplateId.value = templates.value.length > 0 ? templates.value[0].id : null
            }
            await savePrintSettings()
        }
    }

    /**
     * Return the currently active template object
     */
    function currentTemplate() {
        return templates.value.find(t => t.id === activeTemplateId.value) || null
    }

    /**
     * Switch the active template
     */
    async function setActiveTemplate(templateId) {
        activeTemplateId.value = templateId
        await savePrintSettings()
    }

    // Migrate older fields from `coverPageHtml` => `leadingPageHtml`,
    // and `addendumHtml` => `trailingPageHtml`, plus add booleans if missing
    function migrateTemplates(list) {
        for (const tmpl of list) {
            if (typeof tmpl.enableLeadingPage !== 'boolean') {
                tmpl.enableLeadingPage = true
            }
            if (typeof tmpl.enableTrailingPage !== 'boolean') {
                tmpl.enableTrailingPage = true
            }
            if (typeof tmpl.enableHeader !== 'boolean') {
                tmpl.enableHeader = true
            }
            if (typeof tmpl.enableFooter !== 'boolean') {
                tmpl.enableFooter = true
            }

            if (tmpl.coverPageHtml && !tmpl.leadingPageHtml) {
                tmpl.leadingPageHtml = tmpl.coverPageHtml
                delete tmpl.coverPageHtml
            }
            if (tmpl.addendumHtml && !tmpl.trailingPageHtml) {
                tmpl.trailingPageHtml = tmpl.addendumHtml
                delete tmpl.addendumHtml
            }
        }
    }

    // Internal helpers:
    function getLocalDB() {
        // Keep local name consistent with syncStore
        if (!authStore.isAuthenticated) {
            return new PouchDB('pn-markdown-notes-guest')
        }
        return new PouchDB(`pn-markdown-notes-${authStore.user.name.toLowerCase()}`)
    }

    async function fetchOrCreatePrintSettingsDoc(db) {
        let doc
        try {
            doc = await db.get('printSettingsDoc')
        } catch (err) {
            if (err.status === 404) {
                doc = {
                    _id: 'printSettingsDoc',
                    templates: sampleTemplates,
                    activeTemplateId: sampleTemplates[0].id,
                    lastModified: new Date().toISOString()
                }
                await db.put(doc)
                return doc
            }
            throw err
        }
        return doc
    }

    return {
        isLoaded,
        templates,
        activeTemplateId,

        loadPrintSettings,
        savePrintSettings,
        upsertTemplate,
        removeTemplate,
        currentTemplate,
        setActiveTemplate
    }
})
