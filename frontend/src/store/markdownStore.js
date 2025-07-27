// /frontend/src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { useSyncStore } from './syncStore'
import { fetchGoogleFontTtf } from '@/utils/googleFontTtf.js'

export const useMarkdownStore = defineStore('markdownStore', () => {
    const syncStore = useSyncStore();


    /* ------------------------------------------------------------------
     * 1) Preview styles (improved defaults)
     * ----------------------------------------------------------------*/
    const defaultStyles = {
        h1: 'font-family: Arial, Helvetica, sans-serif; font-size: 1.875rem; font-weight: bold; margin-top: 1.5rem; margin-bottom: 1rem; display: block; color: #2c3e50;',
        h2: 'font-family: Arial, Helvetica, sans-serif; font-size: 1.5rem; font-weight: bold; margin-top: 1.2rem; margin-bottom: 0.8rem; display: block; color: #34495e;',
        h3: 'font-family: Arial, Helvetica, sans-serif; font-size: 1.25rem; font-weight: bold; margin-top: 1rem; margin-bottom: 0.6rem; display: block; color: #34495e;',
        h4: 'font-family: Arial, Helvetica, sans-serif; font-size: 1.125rem; font-weight: 600; margin-top: 0.8rem; margin-bottom: 0.5rem; display: block; color: #5d6d7e;',
        p: 'font-family: Georgia, "Times New Roman", serif; font-size: 1rem; line-height: 1.6; margin-bottom: 0.8rem; text-align: justify;',
        ul: 'font-family: Georgia, "Times New Roman", serif; list-style-type: disc; margin: 0.8rem 0; padding-left: 1.5rem;',
        ol: 'font-family: Georgia, "Times New Roman", serif; list-style-type: decimal; margin: 0.8rem 0; padding-left: 1.5rem;',
        li: 'margin-bottom: 0.4rem; padding-left: 0.3rem;',
        code: 'font-family: "Courier New", Monaco, monospace; background-color: #f8f9fa; border: 1px solid #e9ecef; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.9rem;',
        pre: 'font-family: "Courier New", Monaco, monospace; background-color: #f8f9fa; border: 1px solid #e9ecef; padding: 0.8rem; border-radius: 3px; margin: 0.8rem 0; overflow-x: auto; font-size: 0.9rem;',
        blockquote: 'font-family: Georgia, "Times New Roman", serif; border-left: 4px solid #3498db; padding: 0.8rem 1rem; margin: 1rem 0; font-style: italic; color: #5d6d7e; background-color: #f8f9fa;',
        hr: 'border: none; border-top: 2px solid #bdc3c7; margin: 1.5rem 0;',
        em: 'font-style: italic;',
        strong: 'font-weight: bold; color: #2c3e50;',
        a: 'color: #3498db; text-decoration: underline; font-weight: 500;',
        img: 'max-width: 100%; height: auto; margin: 1rem 0;',
        table: 'font-family: Arial, Helvetica, sans-serif; border-collapse: collapse; border: 2px solid #34495e; margin: 1rem 0; width: 100%;',
        tr: 'border-bottom: 1px solid #bdc3c7;',
        th: 'border: 1px solid #34495e; background-color: #ecf0f1; padding: 0.8rem; text-align: left; font-weight: bold; color: #2c3e50;',
        td: 'border: 1px solid #bdc3c7; padding: 0.8rem;',
        customCSS: `/* Custom styles for enhanced preview */
.document-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    background: white;
}

/* Additional typography improvements */
h1:first-child {
    margin-top: 0;
}

/* Better spacing for nested lists */
ul ul, ol ol, ul ol, ol ul {
    margin: 0.3rem 0;
}

/* Enhanced code block styling */
pre code {
    background: none;
    border: none;
    padding: 0;
}`,
        googleFontFamily: 'Inter', // New field for Google Fonts
    };
    const defaultPrintStyles = {
        /* --- Headings (serif) --- */
        h1: "font-family: 'Manufacturing Consent', system-ui; font-size: 2.4rem; font-weight: 700; line-height: 1.1; word-spacing: 0.02em; margin-top: 2.6rem; margin-bottom: 1.2rem; color: #242A49; page-break-after: avoid;",
        h2: "font-family: 'Roboto', serif; font-size: 1.1rem; font-weight: 700; line-height: 1.4; word-spacing: 0.02em; margin-top: 2rem; margin-bottom: 1rem; color: #242A49; page-break-after: avoid;",
        h3: "font-family: 'Roboto', serif; font-size: 1.35rem; font-weight: 600; line-height: 1.3; word-spacing: 0.02em; margin-top: 1.4rem; margin-bottom: 0.8rem; color: #2F3B62; page-break-after: avoid;",
        h4: "font-family: 'Roboto', serif; font-size: 1.0rem; font-weight: 600; line-height: 1.3; word-spacing: 0.02em; margin-top: 1.2rem; margin-bottom: 0.6rem; color: #334066; page-break-after: avoid;",

        /* --- Body & Lists (sans-serif) --- */
        p: "font-family: 'Roboto', sans-serif; font-size: 1rem; line-height: 1.7; margin-bottom: 1.05rem; color: #242A49; orphans: 3; widows: 3; page-break-inside: avoid;",
        ul: "font-family: 'Messina Sans', 'Inter', Arial, sans-serif; font-size: 1rem; line-height: 1.6; list-style-type: disc; list-style-position: outside; margin: 1rem 0 1rem 1.4rem; padding-inline-start: 0; page-break-inside: avoid;",
        ol: "font-family: 'Messina Sans', 'Inter', Arial, sans-serif; font-size: 1rem; line-height: 1.6; list-style-type: decimal; list-style-position: outside; margin: 1rem 0 1rem 1.4rem; padding-inline-start: 0; page-break-inside: avoid;",
        li: "margin: 0 0 0.35rem; padding-left: 0.25rem; page-break-inside: avoid;",

        /* --- Code & Preformatted --- */
        code: "font-family: 'JetBrains Mono', monospace; background: #23272e; color: #f6f8fa; padding: 0.18em 0.5em; border-radius: 5px; font-size: 0.97em; line-height: 1.5;",
        pre: "font-family: 'JetBrains Mono', monospace; background: #23272e; color: #f6f8fa; border: none; padding: 1em 1.5em; border-radius: 8px; margin: 1.5rem 0; overflow-x: auto; font-size: 0.97em; line-height: 1.6; page-break-inside: avoid;",

        /* --- Blockquote, Divider & Accents --- */
        blockquote: "border-left: 4px solid #FF335F; background: #F6F8FC; color: #334066; padding: 1rem 1.5rem; margin: 1.5rem 0; font-family: 'Messina Sans', 'Inter', Arial, sans-serif; font-style: italic; font-size: 1.07rem; line-height: 1.7; page-break-inside: avoid;",
        hr: "border: none; border-top: 3px dotted #242A49; margin: 2.2rem 0; page-break-after: avoid;",
        strong: "font-weight: 700; color: #FF335F;",
        em: "font-style: italic;",
        a: "color: #FF335F; text-decoration: underline; font-weight: 500;",

        /* --- Imagery --- */
        img: "max-width: 100%; height: auto; margin: 1.2rem 0; border-radius: 7px; box-shadow: 0 3px 6px rgba(36,42,73,0.1); page-break-inside: avoid;",

        /* --- Tables (sans-serif) --- */
        table: "font-family: 'Messina Sans', 'Inter', Arial, sans-serif; border-collapse: separate; border-spacing: 0; width: 100%; margin: 1.3rem 0; background: #F8FAFC; page-break-inside: avoid; break-inside: avoid;",
        tr: "border-bottom: 1px solid #E5E7EB; page-break-inside: avoid; break-inside: avoid;",
        th: "background: #E5ECF6; padding: 1em 0.7em; text-align: left; font-weight: 600; color: #242A49; font-size: 10pt; page-break-inside: avoid; break-inside: avoid;",
        td: "padding: 0.85em 0.7em; color: #2F3B62; font-size: 10pt; line-height: 1.4; page-break-inside: avoid; break-inside: avoid;",

        /* --- Header / Footer meta --- */
        printHeaderHtml: "Professional Document",
        printFooterHtml: "Page %p of %P",
        headerFontSize: "10",
        headerFontColor: "#666666",
        headerAlign: "center",
        footerFontSize: "10",
        footerFontColor: "#666666",
        footerAlign: "center",
        enablePageNumbers: true,
        googleFontFamily: 'Manufacturing Consent', // New field for Google Fonts

        /* --- Global print overrides --- */
        customCSS: `    @page { margin: 2.5cm; size: A4; }

    body {
        font-size: 11pt;
        line-height: 1.7;
        color: red !important;
        background: red !important;
    }

    h1, h2, h3, h4, h5, h6 { page-break-after: avoid; page-break-inside: avoid; }

    ul, ol, li,
    table, figure, img, blockquote, pre { page-break-inside: avoid !important; break-inside: avoid !important; }

    ul, ol { list-style-position: outside; margin-left: 1.4rem; padding-inline-start: 0; }
    li { margin: 0 0 0.35rem; }

    blockquote { border-left: 4px solid #FF335F; background: #F6F8FC; color: #334066; }

    hr { border: none; border-top: 3px dotted #242A49; }

    table { font-family: 'Messina Sans', 'Inter', Arial, sans-serif; }

    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
    .page-break-after { page-break-after: always; }`,
    };

    const styles = ref({ ...defaultStyles });
    const printStyles = ref({ ...defaultPrintStyles });
    const fontCache = ref(new Map());
    let settingsLoaded = false;

    // Debounce DB writes
    const debounce = (fn, wait) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    };

    const saveStylesToDB = debounce(async () => {
        if (!settingsLoaded || !syncStore.isInitialized) return;
        try {
            // Use a transaction for atomicity
            await syncStore.powerSync.writeTransaction(async (tx) => {
                await tx.execute(
                    'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
                    ['previewStyles', JSON.stringify(styles.value)]
                );
                await tx.execute(
                    'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
                    ['printStyles', JSON.stringify(printStyles.value)]
                );
            });
        } catch (err) {
            console.error('[markdownStore] Failed to save styles', err);
        }
    }, 500);

    async function loadStylesFromDB() {
        if (!syncStore.isInitialized) return;
        try {
            const result = await syncStore.execute(`SELECT id, value FROM settings WHERE id IN ('previewStyles', 'printStyles')`);
            const loadedSettings = result.rows?._array || [];

            const preview = loadedSettings.find(s => s.id === 'previewStyles');
            if (preview) Object.assign(styles.value, JSON.parse(preview.value));

            const print = loadedSettings.find(s => s.id === 'printStyles');
            if (print) Object.assign(printStyles.value, JSON.parse(print.value));

            settingsLoaded = true;
        } catch (err) {
            console.error('[markdownStore] Failed to load styles', err);
            settingsLoaded = true; // Avoid getting stuck
        }
    }

    // Watch for DB initialization to load settings
    watch(() => syncStore.isInitialized, (ready) => {
        if (ready) loadStylesFromDB();
    }, { immediate: true });

    // Actions
    function updateStyle(key, value) {
        if (styles.value[key] !== undefined) {
            styles.value[key] = value;
            saveStylesToDB();
        }
    }

    function updatePrintStyle(key, value) {
        if (printStyles.value[key] !== undefined) {
            printStyles.value[key] = value;
            saveStylesToDB();
        }
    }

    function resetStyles() {
        styles.value = { ...defaultStyles };
        saveStylesToDB();
    }

    function resetPrintStyles() {
        printStyles.value = { ...defaultPrintStyles };
        saveStylesToDB();
    }

    /**
     * Fetch Google Font CSS (for the live HTML preview) **and**
     * Base-64-encoded TTF binaries (for jsPDF embedding).
     *
     * @param {string} fontFamily – "Roboto" or "Inter, Open Sans" (comma-separated list)
     * @return {Promise<{css:string, fonts:Array<{name,data,format,style,weight}>}>}
     */
    async function getGoogleFontData(fontFamily) {
        if (!fontFamily || !fontFamily.trim()) {
            return { css: '', fonts: [] }
        }

        if (fontCache.value.has(fontFamily)) {
            return fontCache.value.get(fontFamily)
        }

        try {
            // Split comma-separated font families and process each
            const fontFamilies = fontFamily.split(',').map(f => f.trim()).filter(f => f)
            const allFonts = []
            const fontImports = []

            for (const singleFamily of fontFamilies) {
                // Skip generic font families
                if (['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'].includes(singleFamily.toLowerCase())) {
                    continue
                }

                // Remove quotes if present
                const cleanFamily = singleFamily.replace(/['"]/g, '')

                /* ---------- 1. Grab TTF URLs from your server ---------- */
                const variants = await fetchGoogleFontTtf(cleanFamily)

                for (const v of variants) {
                    const key = `${v.family}-${v.weight}-${v.style}`
                    if (fontCache.value.has(key)) {
                        allFonts.push(fontCache.value.get(key))
                        continue
                    }

                    const blob = await fetch(v.url).then(r => r.blob())
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onloadend = () => resolve(reader.result)
                        reader.onerror = reject
                        reader.readAsDataURL(blob)
                    })

                    const fontObj = {
                        name: v.family,
                        data: base64,          // data:…;base64,
                        format: 'truetype',
                        style: v.style,
                        weight: v.weight,
                    }

                    fontCache.value.set(key, fontObj) // cache each variant
                    allFonts.push(fontObj)
                }

                // Add to CSS imports (encode font name for Google Fonts URL)
                const encodedFamily = encodeURIComponent(cleanFamily)
                fontImports.push(`family=${encodedFamily}:wght@400;700`)
            }

            /* ---------- 2. CSS import for the live preview iframe ------------- */
            const css = fontImports.length > 0
                ? `@import url('https://fonts.googleapis.com/css2?${fontImports.join('&')}&display=swap');`
                : ''

            const result = { css, fonts: allFonts }
            fontCache.value.set(fontFamily, result)
            return result
        } catch (err) {
            console.error('[markdownStore] Google-Font fetch failed', err)
            return { css: '', fonts: [] }
        }
    }

    /**
     * ✅ ADDED: Helper function to create a base instance of MarkdownIt with common plugins.
     */
    const baseMd = () => {
        return new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
        }).use(markdownItTaskLists);
    };

    /**
     * ✅ ADDED: Injects a string of CSS into a <style> tag in the document's <head>.
     * This is used for applying custom user styles for the preview.
     * @param {string} cssContent The CSS rules to inject.
     * @param {Document} targetDoc The document to inject into (defaults to window.document).
     */
    function addCustomCSSToDocument(cssContent, targetDoc = document) {
        const styleId = 'markdown-custom-styles';
        let styleElement = targetDoc.getElementById(styleId);
        if (!styleElement) {
            styleElement = targetDoc.createElement('style');
            styleElement.id = styleId;
            targetDoc.head.appendChild(styleElement);
        }
        // This will overwrite previous custom styles, which is intended
        // as this is part of a full re-render cycle.
        styleElement.textContent = cssContent;
    }


    function configureRenderer(md, styleMap) {
        let combinedCSS = '';
        // Apply custom CSS to document if provided
        if (styleMap.customCSS) {
            combinedCSS += styleMap.customCSS;
        }
        // Inject Google Font CSS if available
        if (styleMap.googleFontData && styleMap.googleFontData.css) {
            combinedCSS += styleMap.googleFontData.css;
        }

        if (combinedCSS) {
            addCustomCSSToDocument(combinedCSS);
        }

        // Headings
        md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
            const token = tokens[idx]
            const css = styleMap[token.tag]
            if (css) {
                token.attrSet('style', css)
            }
            return self.renderToken(tokens, idx, opts)
        }

        // Paragraphs
        const defPara = md.renderer.rules.paragraph_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.paragraph_open = (tokens, idx, opts, env, self) => {
            const css = styleMap.p
            if (css) {
                tokens[idx].attrSet('style', css)
            }
            return defPara(tokens, idx, opts, env, self)
        }

        // Lists
        md.renderer.rules.bullet_list_open = (t, i, o, e, s) => {
            const css = styleMap.ul
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        md.renderer.rules.ordered_list_open = (t, i, o, e, s) => {
            const css = styleMap.ol
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        const defLi = md.renderer.rules.list_item_open || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.list_item_open = (tokens, idx, opts, env, self) => {
            const css = styleMap.li
            if (css) tokens[idx].attrSet('style', css)
            return defLi(tokens, idx, opts, env, self)
        }

        // Inline code
        const defCodeInline = md.renderer.rules.code_inline || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_inline = (t, i, o, e, s) => {
            const css = styleMap.code
            if (css) t[i].attrSet('style', css)
            t[i].content = md.utils.escapeHtml(t[i].content)
            return defCodeInline(t, i, o, e, s)
        }

        // Code blocks
        const defFence = md.renderer.rules.fence || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.fence = (t, i, o, e, s) => {
            const css = styleMap.pre
            if (css) t[i].attrSet('style', css)
            t[i].content = md.utils.escapeHtml(t[i].content)
            return defFence(t, i, o, e, s)
        }
        const defCodeBlock = md.renderer.rules.code_block || ((t, i, o, e, s) => s.renderToken(t, i, o))
        md.renderer.rules.code_block = (t, i, o, e, s) => {
            const css = styleMap.pre
            if (css) t[i].attrSet('style', css)
            t[i].content = md.utils.escapeHtml(t[i].content)
            return defCodeBlock(t, i, o, e, s)
        }

        // Blockquote
        md.renderer.rules.blockquote_open = (t, i, o, e, s) => {
            const css = styleMap.blockquote
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }

        // HR
        md.renderer.rules.hr = (t, i, o, e, s) => {
            const css = styleMap.hr
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }

        // Em / strong
        md.renderer.rules.em_open = (t, i, o, e, s) => {
            const css = styleMap.em
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        md.renderer.rules.strong_open = (t, i, o, e, s) => {
            const css = styleMap.strong
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }

        // Links
        md.renderer.rules.link_open = (t, i, o, e, s) => {
            const css = styleMap.a
            if (css) t[i].attrSet('style', css)
            const href = t[i].attrGet('href')
            if (href && (href.startsWith('http') || href.startsWith('//'))) {
                t[i].attrSet('target', '_blank')
                t[i].attrSet('rel', 'noopener noreferrer')
            }
            return s.renderToken(t, i, o)
        }

        // Images
        md.renderer.rules.image = (t, i, o, e, s) => {
            const css = styleMap.img
            if (css) t[i].attrSet('style', css)
            t[i].attrSet('loading', 'lazy')
            return s.renderToken(t, i, o)
        }

        // Tables
        md.renderer.rules.table_open = (t, i, o, e, s) => {
            const css = styleMap.table
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        md.renderer.rules.tr_open = (t, i, o, e, s) => {
            const css = styleMap.tr
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        md.renderer.rules.th_open = (t, i, o, e, s) => {
            const css = styleMap.th
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
        md.renderer.rules.td_open = (t, i, o, e, s) => {
            const css = styleMap.td
            if (css) t[i].attrSet('style', css)
            return s.renderToken(t, i, o)
        }
    }

    function getMarkdownIt() {
        const md = baseMd()
        configureRenderer(md, styles.value)
        return md
    }

    async function getPrintMarkdownIt() {
        const md = baseMd()
        // Fetch and embed Google Fonts for print if specified
        const googleFontData = await getGoogleFontData(printStyles.value.googleFontFamily);
        const printStyleMap = { ...printStyles.value, googleFontData };
        configureRenderer(md, printStyleMap);
        return md
    }
    return {
        styles, printStyles,
        updateStyle, updatePrintStyle,
        resetStyles, resetPrintStyles,
        getMarkdownIt, getPrintMarkdownIt,
        getGoogleFontData
    };
});