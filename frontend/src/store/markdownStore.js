// /frontend/src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import { useSyncStore } from './syncStore'
import { useAuthStore } from './authStore'
import { fetchGoogleFontTtf } from '@/utils/googleFontTtf.js'

export const useMarkdownStore = defineStore('markdownStore', () => {
  const syncStore = useSyncStore();


  /* ------------------------------------------------------------------
   * 1) Preview styles (improved defaults)
   * ----------------------------------------------------------------*/
  const defaultStyles = {
    h1: 'font-family: "Playfair Display", "Source Sans 3", Georgia, serif; font-size: 2.25rem; line-height: 1.15; color: #111827; margin-top: 2.5rem; margin-bottom: 1rem; font-weight: 600;',
    h2: 'font-family: "Playfair Display", "Source Sans 3", Georgia, serif; font-size: 1.75rem; line-height: 1.2; color: #1f2937; margin-top: 2rem; margin-bottom: .75rem; font-weight: 600;',
    h3: 'font-size: 1.5rem; line-height: 1.25; color: #1f2937; margin-top: 1.5rem; margin-bottom: .5rem; font-weight: 600;',
    h4: 'font-size: 1.25rem; line-height: 1.3; color: #374151; margin-top: 1.25rem; margin-bottom: .5rem; font-weight: 600;',
    h5: 'font-size: 1rem; line-height: 1.4; margin-top: 1rem; margin-bottom: .25rem; font-weight: 600; color: #374151;',
    h6: 'font-size: .875rem; line-height: 1.4; margin-top: 1rem; margin-bottom: .25rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: #4b5563;',
    p: 'margin: 0 0 1rem 0; line-height: 1.55;',
    ul: 'list-style-type: disc; margin: 0 0 1rem 1.5rem; padding: 0;',
    ol: 'list-style-type: decimal; margin: 0 0 1rem 1.5rem; padding: 0;',
    li: 'margin: .25rem 0;',
    code: 'font-family: "JetBrains Mono", ui-monospace, monospace; background-color: #f3f4f6; color: #111827; padding: .1rem .35rem; border-radius: 4px; font-size: .875em; font-variant-ligatures: none;',
    pre: 'display: block; width: 100%; box-sizing: border-box; font-family: "JetBrains Mono", ui-monospace, monospace; background-color: #f3f4f6; color: #111827; padding: 1rem 1.25rem; border-radius: 8px; overflow: auto; font-size: .875rem; line-height: 1.5; margin: 1.5rem 0; font-variant-ligatures: none;',
    blockquote: 'margin: 1.5rem 0; padding: .5rem 1rem; border-left: 4px solid #d1d5db; background-color: rgba(209, 213, 219, 0.08);',
    hr: 'border: 0; border-top: 1px solid #d1d5db; margin: 2rem 0;',
    em: 'font-style: italic;',
    strong: 'font-weight: 600;',
    a: 'color: #2563eb; text-decoration: underline; text-underline-offset: 2px;',
    img: 'max-width: 100%; height: auto; border-radius: 4px; margin: 1rem 0;',
    table: 'width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: .875rem;',
    tr: 'border-bottom: 1px solid #e5e7eb;',
    th: 'border: 1px solid #d1d5db; background-color: #f3f4f6; padding: .5rem .75rem; text-align: left; font-weight: 600;',
    td: 'border: 1px solid #d1d5db; padding: .5rem .75rem;',
    customCSS: `
#preview-content, [data-testid="preview-content"] {
    max-width: 72ch;
    margin-left: auto;
    margin-right: auto;
    font-variant-numeric: proportional-nums;
}
/* Un-style code blocks inside <pre> so they inherit the parent's style */
pre > code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: 1em;
}
`,
    googleFontFamily: 'Source Sans 3, JetBrains Mono, Playfair Display',
  };
  const defaultPrintStyles = {
    printHeaderHtml: 'Professional Document',
    printFooterHtml: 'Page %p of %P',
    headerFontSize: '10',
    headerFontColor: '#666666',
    headerAlign: 'center',
    footerFontSize: '10',
    footerFontColor: '#666666',
    footerAlign: 'center',
    enablePageNumbers: true,
    googleFontFamily: 'Source Sans 3, JetBrains Mono, Playfair Display',

    customCSS: `

/* ------------------------------
   Element Styles
   ------------------------------ */
h1 {
  font-family: "Playfair Display";
  font-size: 2.5rem;
  line-height: 1.15;
  color: #111827;
  font-weight: 600;
  letter-spacing: 0.025rem;
}
h2 {
  font-family: "Playfair Display";
  font-size: 2rem;
  line-height: 1.15;
  color: #111827;
  font-weight: 600;
  letter-spacing: 0.025rem;
  margin-top: 1.5rem;
}
h3 {
  font-family: "Playfair Display";
  font-size: 1.5rem;
  line-height: 1.15;
  color: #1f2937;
  margin-top: 1rem;
  margin-bottom: .5rem;
  font-weight: 600;
}
h4 {
  font-size: 1.25rem;
  line-height: 1.3;
  color: #374151;
  margin-top: 1.25rem;
  margin-bottom: .5rem;
  font-weight: 600;
}

/* ------------------------------
   Shared base rules (apply for screen AND print so html2canvas sees them)
   ------------------------------ */
:root {
  --li-gap: .5rem;          /* space between marker box and text */
  --marker-w: 2.2em;        /* reserved width for marker column */
  --line-h: 1.45;           /* consistent line-height for print */
  --ol-suffix: ".";         /* suffix for ordered markers */
  --indent-step: 1.25rem;   /* extra indent per nesting level */
}

body {
  font-size: 11pt;
  line-height: 1.6;
  font-variant-ligatures: no-common-ligatures; /* prevent clipping */
}

h1, h2, h3, h4, h5, h6 {
  page-break-after: avoid;
  page-break-inside: avoid;
}

table, figure, img, blockquote, pre {
  page-break-inside: avoid;
}

.page-break {
  page-break-before: always;
}/* ==============================
   LISTS — stable, print-safe markers for html2canvas/jsPDF
   (no list-style, fixed px, no transforms)
   ============================== */

:root{
  --li-gap: 0rem;        /* space between marker box and text */
  --marker-w: 2.2em;      /* reserved width for marker column */
  --line-h: 1.45;         /* keep li line-height consistent */
  --indent-step: 0rem; /* extra indent per nesting level */
  --ol-suffix: ".";       /* separator for ordered lists */

  /* fixed px sizes so rasterizers keep crisp shapes */
  --b1: 6px;   /* level-1 filled circle */
  --b2: 7px;   /* level-2 ring size */
  --b3: 7px;   /* level-3 square */
  --dash-w: 14px; /* level-4 dash width */
  --dash-h: 2px;  /* level-4 dash height */
}

/* Reset native markers and spacing */
ul, ol{
  list-style: none;
  padding-left: 0;
  margin: .5rem 0;
  line-height: var(--line-h);
  counter-reset: none; /* will set for OL below */
}

/* Each li reserves a marker column via padding-left */
li{
  position: relative;
  padding-left: calc(var(--marker-w) + var(--li-gap));
  break-inside: avoid; /* helps avoid marker splitting across pages */
}

/* The marker box (numbers or shapes) */
li::before{
  position: absolute;
  left: 0;
  top: 0;                 /* align to first line box */
  width: var(--marker-w);
  /* keep number/shape vertically near baseline of first line */
  line-height: 1.2;
  text-align: right;
  /* do NOT use transform (blurs in html2canvas) */
  /* Ensure shapes render dark enough when printed */
  color: #111;
  content: "";           /* set by UL/OL rules below */
}

/* ---------- Ordered lists (multi-level “1.1.1.”) ---------- */
ol{ counter-reset: item; }
ol > li{ counter-increment: item; }

/* Show full hierarchical index using counters() */
ol > li::before{
  content: counters(item, ".") var(--ol-suffix);
  font-variant-numeric: tabular-nums; /* stable width in PDF */
  white-space: nowrap;
}

/* Nested OL keep working automatically */
li > ol{
  margin-top: 0em;
  margin-left: calc(var(--marker-w) + var(--li-gap) + var(--indent-step)) !important;
  padding-left: 0;
}

/* ---------- Unordered lists (level-based shapes) ---------- */

/* UL level 1 — filled circle */
ul > li::before{
  content: "";
  display: inline-block;
  vertical-align: baseline;
  height: var(--b1);
  width: var(--b1);
  border-radius: 9999px;
  background: currentColor;
  /* place shape at right edge of marker column */
  float: right; /* avoids text collision in some renderers */
  margin-top: 1rem; /* nudge toward text baseline */
}

/* UL level 2 — ring */
ul ul > li::before{
  content: "";
  display: inline-block;
  height: var(--b2);
  width: var(--b2);
  border: 2px solid currentColor;
  border-radius: 9999px;
  background: transparent;
  float: right;
}

/* UL level 3 — square */
ul ul ul > li::before{
  content: "";
  display: inline-block;
  height: var(--b3);
  width: var(--b3);
  background: currentColor;
  float: right;
}

/* UL level 4+ — dash */
ul ul ul ul > li::before{
  content: "";
  display: inline-block;
  height: var(--dash-h);
  width: var(--dash-w);
  background: currentColor;
  float: right;
  margin-top: .55em;
}

/* Nested UL alignment (keeps text column straight) */
li > ul{
  margin-top: .25rem;
  margin-left: calc(var(--marker-w) + var(--li-gap) + var(--indent-step)) !important;
  padding-left: 0;
}

/* Normalize any inline styles injected by converters */
ul[style], ol[style]{
  margin-top: 0 !important;
  margin-bottom: .5rem !important;
  padding-left: 0 !important;
}

/* Keep headings/blocks from splitting markers awkwardly */
h1, h2, h3, h4, h5, h6{ page-break-after: avoid; page-break-inside: avoid; }
table, figure, img, blockquote, pre{ page-break-inside: avoid; }

/* Print-specific nudge for marker darkness */
@media print{
  li::before{ color:#000; }
}

/* ------------------------------
   Duplicate inside @media print for real print engines
   ------------------------------ */
@media print {
  body {
    font-size: 11pt;
    line-height: 1.6;
    font-variant-ligatures: no-common-ligatures;
  }

  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    page-break-inside: avoid;
  }

  table, figure, img, blockquote, pre {
    page-break-inside: avoid;
  }

  .page-break {
    page-break-before: always;
  }

  /* Ensure markers print dark in some engines */
  li::before { color: #000; }
}

`,
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
      await syncStore.db.value.exec('BEGIN TRANSACTION;');
      await syncStore.db.value.exec(
        'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
        ['previewStyles', JSON.stringify(styles.value)]
      );
      await syncStore.db.value.exec(
        'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
        ['printStyles', JSON.stringify(printStyles.value)]
      );
      await syncStore.db.value.exec('COMMIT;');
    } catch (err) {
      await syncStore.db.value.exec('ROLLBACK;');
      console.error('[markdownStore] Failed to save styles', err);
    }
  }, 500);

  async function loadStylesFromDB() {
    if (!syncStore.isInitialized) return;
    try {
      const result = await syncStore.execute(`SELECT id, value FROM settings WHERE id IN ('previewStyles', 'printStyles')`);
      const loadedSettings = result || [];

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
            data: base64,          // data:…;base64,
            format: 'truetype',
            style: v.style,
            weight: v.weight,
          }

          fontCache.value.set(key, fontObj) // cache each variant
          allFonts.push(fontObj)
        }

        // Add to CSS imports (encode font name for Google Fonts URL)
        const encodedFamily = encodeURIComponent(cleanFamily)
        fontImports.push(`family=${encodedFamily}:wght@400;600;700`)
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
    if (styleMap.customCSS) {
      combinedCSS += styleMap.customCSS;
    }
    // ✅ FIXED: Also apply Google Fonts for the main preview, not just print.
    if (styleMap.googleFontFamily) {
      const families = styleMap.googleFontFamily.split(',')
        .map(f => `family=${encodeURIComponent(f.trim())}:wght@400;600;700`)
        .join('&');
      if (families) {
        combinedCSS += `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n`;
        const primaryFont = styleMap.googleFontFamily.split(',')[0].trim().replace(/['"]/g, '');
        // This font-family rule will apply to the preview containers
        combinedCSS += `
            		#preview-content, [data-testid="preview-content"] {
            			font-family: "${primaryFont}", system-ui, sans-serif;
            		}
            	`;
      }
    } else if (styleMap.googleFontData && styleMap.googleFontData.css) {
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
      return defCodeInline(t, i, o, e, s)
    }

    // Code blocks
    const defFence = md.renderer.rules.fence || ((t, i, o, e, s) => s.renderToken(t, i, o))
    md.renderer.rules.fence = (t, i, o, e, s) => {
      const css = styleMap.pre
      if (css) t[i].attrSet('style', css)
      return defFence(t, i, o, e, s)
    }
    const defCodeBlock = md.renderer.rules.code_block || ((t, i, o, e, s) => s.renderToken(t, i, o))
    md.renderer.rules.code_block = (t, i, o, e, s) => {
      const css = styleMap.pre
      if (css) t[i].attrSet('style', css)
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

    // ✅ FIX: Intercept image rendering to add auth tokens
    const defaultImageRenderer = md.renderer.rules.image || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const srcIndex = token.attrIndex('src');

      if (srcIndex >= 0) {
        let src = token.attrs[srcIndex][1];
        const apiUrl = import.meta.env.VITE_API_SERVICE_URL || '';

        // Check if it's an internal API image URL and we are authenticated.
        // This handles both absolute URLs (e.g., http://localhost:8000/images/...)
        // and relative URLs (e.g., /images/...).
        const isInternalImage = (apiUrl && src.startsWith(apiUrl) && src.includes('/images/')) ||
          (!src.startsWith('http') && src.startsWith('/images/'));

        if (isInternalImage && authStore.token) {
          try {
            // Use a base URL for parsing, even for relative paths
            const url = new URL(src, window.location.origin);
            url.searchParams.set('token', authStore.token);
            token.attrs[srcIndex][1] = apiUrl ? url.href : url.pathname + url.search;
          } catch (e) {
            console.error("Failed to parse image URL for token injection:", src, e);
          }
        }
      }

      // Apply inline styles from settings
      const css = styleMap.img;
      if (css) token.attrSet('style', css);
      token.attrSet('loading', 'lazy');

      // Call the original/default renderer to finish the job
      return defaultImageRenderer(tokens, idx, options, env, self);
    };

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