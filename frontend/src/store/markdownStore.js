// src/store/markdownStore.js
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

    /* ───────────────────────── helpers ───────────────────────── */
    function getLocalDB() {
        if (!authStore.isAuthenticated || authStore.user?.name === 'guest') {
            return new PouchDB('pn-markdown-notes-guest')
        }
        return new PouchDB(`pn-markdown-notes-${authStore.user.name.toLowerCase()}`)
    }
    function debounce(fn, wait = 500) {
        let t
        return (...a) => {
            clearTimeout(t)
            t = setTimeout(() => fn(...a), wait)
        }
    }

    /* ───────────────────────── preview styles ───────────────────────── */
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

    /* ───────────────────────── print styles ───────────────────────── */
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

        /* new paged-media margin-box settings */
        pageHeaderLeftType: 'text',   // 'text' | 'image'
        pageHeaderLeftContent: '',
        pageHeaderRightType: 'text',
        pageHeaderRightContent: '',
        pageFooterLeftType: 'text',
        pageFooterLeftContent: '',
        pageFooterRightType: 'text',
        pageFooterRightContent: ''
    })

    /* ───────────────────────── persistence ───────────────────────── */
    let loaded = false
    async function loadStyles() {
        if (!syncStore.isInitialized) await syncStore.initializeDB()
        try {
            const db = getLocalDB()
            const doc = await db.get('markdownStylesDoc')
            doc.previewStyles && Object.assign(styles.value, doc.previewStyles)
            doc.printStyles && Object.assign(printStyles.value, doc.printStyles)
        } catch (e) {
            if (e.status !== 404) console.error('[markdownStore] load error', e)
        } finally {
            loaded = true
        }
    }
    const saveDebounced = debounce(saveStyles, 500)
    async function saveStyles() {
        if (!loaded) return
        try {
            const db = getLocalDB()
            let doc
            try { doc = await db.get('markdownStylesDoc') }
            catch (e) { doc = { _id: 'markdownStylesDoc' } }
            doc.previewStyles = { ...styles.value }
            doc.printStyles = { ...printStyles.value }
            doc.lastModified = new Date().toISOString()
            await db.put(doc)
        } catch (e) {
            console.error('[markdownStore] save error', e)
        }
    }

    if (syncStore.isInitialized) loadStyles()
    else watch(() => syncStore.isInitialized, v => v && loadStyles())

    /* ───────────────────────── mutators ───────────────────────── */
    function updateStyle(key, val) {
        if (key in styles.value) {
            styles.value[key] = val
            saveDebounced()
        }
    }
    function updatePrintStyle(key, val) {
        if (key in printStyles.value) {
            printStyles.value[key] = val
            saveDebounced()
        }
    }

    /* ───────────────────────── markdown-it renderer helpers ───────────────────────── */
    function addClass(tok, cls) {
        if (!cls) return
        const existing = tok.attrGet('class')
        existing ? tok.attrJoin('class', cls) : tok.attrPush(['class', cls])
    }
    function configureRenderer(md, map) {
        /* headings */
        md.renderer.rules.heading_open = (t, i, o, e, s) => {
            addClass(t[i], map[t[i].tag]); return s.renderToken(t, i, o)
        }
        /* paragraphs */
        const defPara = md.renderer.rules.paragraph_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.paragraph_open = (t, i, o, e, s) => {
            addClass(t[i], map.p); return defPara(t, i, o, e, s)
        }
        /* bullet / ordered list */
        md.renderer.rules.bullet_list_open = (t, i, o, e, s) => { addClass(t[i], map.ul); return s.renderToken(t, i, o) }
        md.renderer.rules.ordered_list_open = (t, i, o, e, s) => { addClass(t[i], map.ol); return s.renderToken(t, i, o) }
        const defLi = md.renderer.rules.list_item_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.list_item_open = (t, i, o, e, s) => {
            addClass(t[i], map.li); return defLi(t, i, o, e, s)
        }
        /* inline code */
        const defCodeInline = md.renderer.rules.code_inline || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_inline = (t, i, o, e, s) => {
            addClass(t[i], map.code); t[i].content = md.utils.escapeHtml(t[i].content); return defCodeInline(t, i, o, e, s)
        }
        /* fenced / indented code */
        const defFence = md.renderer.rules.fence || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.fence = (t, i, o, e, s) => {
            addClass(t[i], map.pre); t[i].content = md.utils.escapeHtml(t[i].content); return defFence(t, i, o, e, s)
        }
        const defCodeBlock = md.renderer.rules.code_block || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_block = (t, i, o, e, s) => {
            addClass(t[i], map.pre); t[i].content = md.utils.escapeHtml(t[i].content); return defCodeBlock(t, i, o, e, s)
        }
        /* blockquote */
        md.renderer.rules.blockquote_open = (t, i, o, e, s) => { addClass(t[i], map.blockquote); return s.renderToken(t, i, o) }
        /* hr */
        md.renderer.rules.hr = (t, i, o, e, s) => { addClass(t[i], map.hr); return s.renderToken(t, i, o) }
        /* em & strong */
        md.renderer.rules.em_open = (t, i, o, e, s) => { addClass(t[i], map.em); return s.renderToken(t, i, o) }
        md.renderer.rules.strong_open = (t, i, o, e, s) => { addClass(t[i], map.strong); return s.renderToken(t, i, o) }
        /* links */
        md.renderer.rules.link_open = (t, i, o, e, s) => {
            addClass(t[i], map.a)
            const href = t[i].attrGet('href')
            if (href && (href.startsWith('http') || href.startsWith('//'))) {
                t[i].attrSet('target', '_blank'); t[i].attrSet('rel', 'noopener noreferrer')
            }
            return s.renderToken(t, i, o)
        }
        /* images */
        md.renderer.rules.image = (t, i, o, e, s) => {
            addClass(t[i], map.img); t[i].attrSet('loading', 'lazy'); return s.renderToken(t, i, o)
        }
        /* tables */
        md.renderer.rules.table_open = (t, i, o, e, s) => { addClass(t[i], map.table); return s.renderToken(t, i, o) }
        md.renderer.rules.tr_open = (t, i, o, e, s) => { addClass(t[i], map.tr); return s.renderToken(t, i, o) }
        md.renderer.rules.th_open = (t, i, o, e, s) => { addClass(t[i], map.th); return s.renderToken(t, i, o) }
        md.renderer.rules.td_open = (t, i, o, e, s) => { addClass(t[i], map.td); return s.renderToken(t, i, o) }
    }
    function baseMd() {
        return new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
            .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true })
    }
    function getMarkdownIt() {
        const md = baseMd(); configureRenderer(md, styles.value); return md
    }
    function getPrintMarkdownIt() {
        const md = baseMd(); configureRenderer(md, printStyles.value); return md
    }

    /* ───────────────────────── exports ───────────────────────── */
    return {
        styles,
        printStyles,
        updateStyle,
        updatePrintStyle,
        getMarkdownIt,
        getPrintMarkdownIt
    }
})
