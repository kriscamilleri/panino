// /frontend/src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { applyDocumentVariables, createDocumentRenderer } from '@panino/content-merge/markdown-render'
import { applyStyleMap } from '@panino/content-merge/styled-renderer'
import { useSyncStore } from './syncStore'
import { useAuthStore } from './authStore'
import { useGlobalVariablesStore } from './globalVariablesStore'
import { withImageAuthToken } from '@/utils/imageUrl'
import { parseFrontMatter } from '@/utils/frontMatter'
import { DEFAULT_PREVIEW_STYLES, DEFAULT_PRINT_STYLES, buildPrintCss } from '@/utils/styleDefaults'

export const useMarkdownStore = defineStore('markdownStore', () => {
  const syncStore = useSyncStore();
  const authStore = useAuthStore();
  const globalVariablesStore = useGlobalVariablesStore();

  function extractDocumentMetadata(markdown) {
    return parseFrontMatter(markdown).metadata;
  }

  // The shared renderer does the substitution, so the API renders the same way.
  function applyMetadataVariables(markdown) {
    return applyDocumentVariables(markdown, { globals: globalVariablesStore.globalsMap });
  }

  const printStylesCssString = computed(() => buildPrintCss(printStyles.value));

  const defaultStyles = DEFAULT_PREVIEW_STYLES;
  const defaultPrintStyles = DEFAULT_PRINT_STYLES;

  const styles = ref({ ...defaultStyles });
  const printStyles = ref({ ...defaultPrintStyles });
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
      await syncStore.personalRepository().transaction(async (repo) => {
        await repo.exec(
          'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
          ['previewStyles', JSON.stringify(styles.value)]
        );
        await repo.exec(
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
      const result = await syncStore.personalRepository().execute(`SELECT id, value FROM settings WHERE id IN ('previewStyles', 'printStyles')`);
      const loadedSettings = result || [];

      const preview = loadedSettings.find(s => s.id === 'previewStyles');
      if (preview) Object.assign(styles.value, JSON.parse(preview.value));

      const print = loadedSettings.find(s => s.id === 'printStyles');
      if (print) Object.assign(printStyles.value, JSON.parse(print.value));

      settingsLoaded = true;
    } catch (err) {
      console.error('[markdownStore] Failed to load styles', err);
      settingsLoaded = true;
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

  // The shared MarkdownIt setup (shared/markdownRender.js); the styles below are layered on.
  const baseMd = () => createDocumentRenderer();

  // Inject CSS into document head
  function addCustomCSSToDocument(cssContent, targetDoc = document) {
    const styleId = 'markdown-custom-styles';
    let styleElement = targetDoc.getElementById(styleId);
    if (!styleElement) {
      styleElement = targetDoc.createElement('style');
      styleElement.id = styleId;
      targetDoc.head.appendChild(styleElement);
    }
    styleElement.textContent = cssContent;
  }

  // Configure renderer with styles
  function configureRenderer(md, styleMap, { injectGlobalStyles = true } = {}) {
    let combinedCSS = '';
    if (styleMap.customCSS) {
      combinedCSS += styleMap.customCSS;
    }

    if (styleMap.googleFontFamily) {
      const families = styleMap.googleFontFamily.split(',')
        .map(f => `family=${encodeURIComponent(f.trim())}:wght@400;600;700`)
        .join('&');
      if (families) {
        combinedCSS += `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n`;
        const primaryFont = styleMap.googleFontFamily.split(',')[0].trim().replace(/['"]/g, '');
        combinedCSS += `
     #preview-content, [data-testid="preview-content"] {
      font-family: "${primaryFont}", system-ui, sans-serif;
     }
    `;
      }
    }

    if (combinedCSS && injectGlobalStyles) {
      addCustomCSSToDocument(combinedCSS);
    }

    // The inline styles and external-link attributes come from the shared renderer
    // (shared/styledRenderer.js), the same code the API uses for PDFs; the browser only
    // adds the auth token Panino's own image URLs need.
    const apiUrl = import.meta.env.VITE_API_SERVICE_URL || '';
    applyStyleMap(md, styleMap, {
      rewriteImageSrc: (src) => {
        const isInternalImage = (apiUrl && src.startsWith(apiUrl) && src.includes('/images/')) ||
          (!src.startsWith('http') && (src.startsWith('/images/') || src.startsWith('/api/images/')));
        if (!isInternalImage || !authStore.token) return src;
        try {
          return withImageAuthToken(src, authStore.token, {
            origin: apiUrl || window.location.origin,
            absolute: Boolean(apiUrl),
          });
        } catch (e) {
          console.error("Failed to parse image URL for token injection:", src, e);
          return src;
        }
      },
    });
  }

  /**
   * A renderer for the on-screen preview. Pass a named style's values to render
   * with them instead of the library Default.
   * @param {object} [styleMap]
   */
  function getMarkdownIt(styleMap = styles.value) {
    const md = baseMd();
    configureRenderer(md, styleMap, { injectGlobalStyles: true });
    return md;
  }

  /**
   * A renderer for print. Pass a named style's values to render with them
   * instead of the library Default.
   * @param {object} [styleMap]
   */
  async function getPrintMarkdownIt(styleMap = printStyles.value) {
    const md = baseMd();
    configureRenderer(md, styleMap, { injectGlobalStyles: false });
    return md;
  }

  return {
    styles, printStyles,
    updateStyle, updatePrintStyle,
    resetStyles, resetPrintStyles,
    loadStylesFromDB,
    getMarkdownIt, getPrintMarkdownIt, printStylesCssString, buildPrintCss,
    extractDocumentMetadata, applyMetadataVariables
  };
});
