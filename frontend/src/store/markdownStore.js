// frontend/src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from './authStore'
import { useSyncStore } from './syncStore'

export const useMarkdownStore = defineStore('markdownStore', () => {
    const authStore = useAuthStore()
    const syncStore = useSyncStore()

    /* ------------------------------------------------------------------
     * Helpers for local DB access & debounce
     * ----------------------------------------------------------------*/
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
     * 1) Preview styles
     * ----------------------------------------------------------------*/
    const styles = ref({
        h1: 'text-3xl font-bold mt-4 mb-2 block',
        h2: 'text-2xl font-semibold mt-3 mb-2 block',
        h3: 'text-xl font-semibold mt-2 mb-1 block',
        h4: 'text-lg font-semibold mt-2 mb-1 block text-gray-600',
        p: 'mb-2 leading-relaxed',
        ul: 'list-disc list-inside mb-2',
        ol: 'list-decimal list-inside mb-2',
        li: 'ml-5 mb-1',
        code: 'bg-gray-100 text-sm px-1 py-0.5 rounded',
        pre: 'bg-gray-100 p-2 rounded my-2 overflow-x-auto text-sm',
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'text-blue-600 underline',
        img: 'max-w-full h-auto my-2',
        table: 'border-collapse border border-gray-300 my-2 w-full',
        tr: 'border-t border-gray-200',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold',
        td: 'border border-gray-300 px-2 py-1'
    })

    /* ------------------------------------------------------------------
     * 2) Print styles
     * ----------------------------------------------------------------*/
    const printStyles = ref({
        h1: 'font-bold text-2xl my-2 block',
        h2: 'font-bold text-xl my-2 block',
        h3: 'font-bold text-lg my-1 block',
        h4: 'font-semibold text-base my-1 block text-gray-700',
        p: 'mb-2 leading-relaxed',
        ul: 'list-disc mb-2 ml-8',
        ol: 'list-decimal mb-2 ml-8',
        li: 'mb-1',
        code: 'bg-gray-200 px-1 py-0.5 rounded text-sm font-mono',
        pre: 'bg-gray-200 p-2 rounded my-2 overflow-x-auto text-sm font-mono',
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'underline text-blue-700',
        img: 'max-w-full h-auto my-2',
        table: 'border-collapse border border-gray-300 my-2 w-full',
        tr: 'border-t border-gray-200',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold',
        td: 'border border-gray-300 px-2 py-1',

        printHeaderHtml: 'My Document Header',
        printFooterHtml: 'Page %p of %P',
        
        // New properties for header/footer styling
        headerFontSize: "10", // Store as string, convert to number in component
        headerFontColor: "#808080", // Gray
        headerAlign: "center", // 'left', 'center', 'right'
        footerFontSize: "10",
        footerFontColor: "#808080",
        footerAlign: "center",
        enablePageNumbers: true // New property

    })

    /* ------------------------------------------------------------------
     * 3) Persistence: load & save styles
     * ----------------------------------------------------------------*/
    let stylesLoaded = false

    async function loadStylesFromDB() {
        if (!syncStore.isInitialized) {
            // wait until DB is ready (LoadingPage ensures this normally)
            await syncStore.initializeDB()
        }
        try {
            const db = getLocalDB()
            const doc = await db.get('markdownStylesDoc')
            if (doc.previewStyles) {
                Object.assign(styles.value, doc.previewStyles)
            }
            if (doc.printStyles) {
                 // Merge carefully to include new default fields if not present in DB
                const loadedPrintStyles = doc.printStyles;
                for (const key in printStyles.value) {
                    if (loadedPrintStyles.hasOwnProperty(key)) {
                        printStyles.value[key] = loadedPrintStyles[key];
                    }
                }
            }
            stylesLoaded = true
        } catch (err) {
            if (err.status === 404) {
                stylesLoaded = true // no saved doc, keep defaults
            } else {
                console.error('[markdownStore] Failed to load styles', err)
            }
        }
    }

    const saveStylesDebounced = debounce(saveStylesToDB, 500)

    async function saveStylesToDB() {
        if (!stylesLoaded) return
        try {
            const db = getLocalDB()
            let doc
            try {
                doc = await db.get('markdownStylesDoc')
            } catch (err) {
                if (err.status === 404) {
                    doc = { _id: 'markdownStylesDoc' }
                } else {
                    throw err
                }
            }
            doc.previewStyles = { ...styles.value }
            doc.printStyles = { ...printStyles.value }
            doc.lastModified = new Date().toISOString()
            await db.put(doc)
        } catch (err) {
            console.error('[markdownStore] Failed to save styles', err)
        }
    }

    // Kick‑off load once syncStore is ready
    if (syncStore.isInitialized) {
        loadStylesFromDB()
    } else {
        watch(() => syncStore.isInitialized, (v) => {
            if (v) loadStylesFromDB()
        })
    }

    /* ------------------------------------------------------------------
     * 4) Mutators that also persist
     * ----------------------------------------------------------------*/
    function updateStyle(key, newVal) {
        if (styles.value[key] !== undefined) {
            styles.value[key] = newVal
            saveStylesDebounced()
        }
    }

    function updatePrintStyle(key, newVal) {
        if (printStyles.value[key] !== undefined) {
            printStyles.value[key] = newVal
            saveStylesDebounced()
        }
    }

    /* ------------------------------------------------------------------
     * 5) Markdown‑it helper & rule overrides
     * ----------------------------------------------------------------*/
    function addClassToToken(token, className) {
        if (!className) return
        const existing = token.attrGet('class')
        if (existing) {
            const parts = existing.split(' ')
            if (!parts.includes(className)) token.attrJoin('class', className)
        } else {
            token.attrPush(['class', className])
        }
    }

    function configureRenderer(md, styleMap) {
        // Headings
        md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
            addClassToToken(tokens[idx], styleMap[tokens[idx].tag])
            return self.renderToken(tokens, idx, opts)
        }

        // Paragraphs
        const defPara = md.renderer.rules.paragraph_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.paragraph_open = (tokens, idx, opts, env, self) => {
            addClassToToken(tokens[idx], styleMap.p)
            return defPara(tokens, idx, opts, env, self)
        }

        // Lists
        md.renderer.rules.bullet_list_open = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.ul); return s.renderToken(t, i, o)
        }
        md.renderer.rules.ordered_list_open = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.ol); return s.renderToken(t, i, o)
        }
        const defLi = md.renderer.rules.list_item_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.list_item_open = (tokens, idx, opts, env, self) => {
            addClassToToken(tokens[idx], styleMap.li); return defLi(tokens, idx, opts, env, self)
        }

        // Inline code
        const defCodeInline = md.renderer.rules.code_inline || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_inline = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.code); t[i].content = md.utils.escapeHtml(t[i].content); return defCodeInline(t, i, o, e, s)
        }

        // Fenced/indented code blocks
        const defFence = md.renderer.rules.fence || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.fence = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.pre); t[i].content = md.utils.escapeHtml(t[i].content); return defFence(t, i, o, e, s)
        }
        const defCodeBlock = md.renderer.rules.code_block || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_block = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.pre); t[i].content = md.utils.escapeHtml(t[i].content); return defCodeBlock(t, i, o, e, s)
        }

        // Blockquote
        md.renderer.rules.blockquote_open = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.blockquote); return s.renderToken(t, i, o)
        }

        // HR
        md.renderer.rules.hr = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.hr); return s.renderToken(t, i, o)
        }

        // Em / strong
        md.renderer.rules.em_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.em); return s.renderToken(t, i, o) }
        md.renderer.rules.strong_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.strong); return s.renderToken(t, i, o) }

        // Links
        md.renderer.rules.link_open = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.a)
            const href = t[i].attrGet('href')
            if (href && (href.startsWith('http') || href.startsWith('//'))) {
                t[i].attrSet('target', '_blank'); t[i].attrSet('rel', 'noopener noreferrer')
            }
            return s.renderToken(t, i, o)
        }

        // Images
        md.renderer.rules.image = (t, i, o, e, s) => {
            addClassToToken(t[i], styleMap.img); t[i].attrSet('loading', 'lazy'); return s.renderToken(t, i, o)
        }

        // Tables
        md.renderer.rules.table_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.table); return s.renderToken(t, i, o) }
        md.renderer.rules.tr_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.tr); return s.renderToken(t, i, o) }
        md.renderer.rules.th_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.th); return s.renderToken(t, i, o) }
        md.renderer.rules.td_open = (t, i, o, e, s) => { addClassToToken(t[i], styleMap.td); return s.renderToken(t, i, o) }
    }

    function baseMd() {
        return new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
            .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
    }

    function getMarkdownIt() {
        const md = baseMd()
        configureRenderer(md, styles.value)
        return md
    }

    function getPrintMarkdownIt() {
        const md = baseMd()
        configureRenderer(md, printStyles.value)
        return md
    }

    /* ------------------------------------------------------------------
     * Expose store API
     * ----------------------------------------------------------------*/
    return {
        // Reactive maps
        styles,
        printStyles,

        // Mutators
        updateStyle,
        updatePrintStyle,

        // Renderers
        getMarkdownIt,
        getPrintMarkdownIt
    }
})