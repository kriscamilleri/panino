// /frontend/src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
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

  function normalizeVariableName(name) {
    return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function extractDocumentMetadata(markdown) {
    return parseFrontMatter(markdown).metadata;
  }

  function applyMetadataVariables(markdown) {
    if (!markdown) return '';
    const { metadata, body } = parseFrontMatter(markdown);
    const variableMap = new Map();

    const now = new Date();
    variableMap.set(normalizeVariableName('GLOBAL_DATE'), now.toLocaleDateString());
    variableMap.set(normalizeVariableName('GLOBAL_TIME'), now.toLocaleTimeString());

    globalVariablesStore.globalsMap.forEach((value, key) => {
      if (key) variableMap.set(key, value);
    });

    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = normalizeVariableName(key);
      if (normalizedKey) variableMap.set(normalizedKey, value);
    });

    return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, name) => {
      const normalizedName = normalizeVariableName(name);
      if (!normalizedName) return match;
      const value = variableMap.get(normalizedName);
      return value !== undefined ? value : match;
    });
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

  // Create a base instance of MarkdownIt with common plugins
  const baseMd = () => {
    return new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
    }).use(markdownItTaskLists);
  };

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

    // Helper to safely get and wrap the original renderer rule
    const wrapRule = (ruleName, styleKey) => {
      const originalRule = md.renderer.rules[ruleName] || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
      md.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
        const css = styleMap[styleKey];
        if (css) tokens[idx].attrSet('style', css);
        return originalRule(tokens, idx, options, env, self);
      };
    };

    // Headings - special handling to get tag name (h1, h2, etc.)
    const originalHeadingOpen = md.renderer.rules.heading_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const css = styleMap[token.tag];
      if (css) token.attrSet('style', css);
      return originalHeadingOpen(tokens, idx, opts, env, self);
    };

    // Basic rules
    wrapRule('paragraph_open', 'p');
    wrapRule('bullet_list_open', 'ul');
    wrapRule('ordered_list_open', 'ol');
    wrapRule('list_item_open', 'li');
    wrapRule('blockquote_open', 'blockquote');
    wrapRule('em_open', 'em');
    wrapRule('strong_open', 'strong');
    wrapRule('code_inline', 'code');
    wrapRule('hr', 'hr');

    // Code blocks (fence for ```, code_block for indented)
    const originalFence = md.renderer.rules.fence || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const css = styleMap.pre;
      if (css) tokens[idx].attrSet('style', css);
      return originalFence(tokens, idx, options, env, self);
    };
    const originalCodeBlock = md.renderer.rules.code_block || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.code_block = (tokens, idx, options, env, self) => {
      const css = styleMap.pre;
      if (css) tokens[idx].attrSet('style', css);
      return originalCodeBlock(tokens, idx, options, env, self);
    };


    // Links
    const originalLinkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const css = styleMap.a;
      if (css) tokens[idx].attrSet('style', css);
      const href = tokens[idx].attrGet('href');
      if (href && (href.startsWith('http') || href.startsWith('//'))) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
      }
      return originalLinkOpen(tokens, idx, options, env, self);
    };

    // Image
    const originalImage = md.renderer.rules.image || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const srcIndex = token.attrIndex('src');

      if (srcIndex >= 0) {
        let src = token.attrs[srcIndex][1];
        const apiUrl = import.meta.env.VITE_API_SERVICE_URL || '';

        const isInternalImage = (apiUrl && src.startsWith(apiUrl) && src.includes('/images/')) ||
          (!src.startsWith('http') && (src.startsWith('/images/') || src.startsWith('/api/images/')));

        if (isInternalImage && authStore.token) {
          try {
            token.attrs[srcIndex][1] = withImageAuthToken(src, authStore.token, {
              origin: apiUrl || window.location.origin,
              absolute: Boolean(apiUrl),
            });
          } catch (e) {
            console.error("Failed to parse image URL for token injection:", src, e);
          }
        }
      }

      const css = styleMap.img;
      if (css) token.attrSet('style', css);

      return originalImage(tokens, idx, options, env, self);
    };

    // Table styles
    wrapRule('table_open', 'table');
    wrapRule('tr_open', 'tr');
    wrapRule('th_open', 'th');
    wrapRule('td_open', 'td');
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
