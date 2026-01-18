<template>
  <StyleCustomizer :config="printStylesConfig">
    <div class="h-full overflow-y-auto">
      <template v-if="!docStore.selectedFileContent">
        <div class="flex flex-col items-center justify-center h-full text-gray-500">
          <h3 class="text-lg font-semibold mb-2">No Document Selected</h3>
          <p class="mb-4">
            Please select a document from the Documents panel to generate a print
            preview.
          </p>
          <BaseButton @click="printStylesConfig.onBack()">
            Back to Editor
          </BaseButton>
        </div>
      </template>

      <!-- PDF Preview (always shown when content exists) -->
      <iframe v-if="pdfUrl" :src="pdfUrl" class="w-full h-full border-none" data-testid="pdf-preview-iframe"></iframe>

      <div v-else class="flex items-center justify-center h-full text-gray-500">
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none"
          viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
          </path>
        </svg>
        Generating PDF preview...
      </div>
    </div>
  </StyleCustomizer>
</template>

<script setup>
import { ref, watch, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDebounceFn } from '@vueuse/core';
import StyleCustomizer from '@/components/StyleCustomizer.vue';
import { Palette, Edit3 } from 'lucide-vue-next';
import Editor from '@/components/Editor.vue';
import BaseButton from '@/components/BaseButton.vue';
import { useDocStore } from '@/store/docStore';
import { useMarkdownStore } from '@/store/markdownStore';
import { useAuthStore } from '@/store/authStore';
import DOMPurify from 'dompurify';

const router = useRouter();
const docStore = useDocStore();
const markdownStore = useMarkdownStore();
const authStore = useAuthStore();
const isProd = import.meta.env.PROD;
const API_URL = isProd ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');

const pdfUrl = ref('');
const finalHtmlForPdf = ref('');
const showMode = ref('off'); // 'styles', 'editor', or 'off'

const debouncedRegeneratePdf = useDebounceFn(regeneratePdf, 700);

const printStylesConfig = {
  title: 'Customize Print Styles',
  getStyles: () => ({ ...docStore.printStyles }),
  updateStyleAction: docStore.updatePrintStyle,
  getDebugHtml: () => finalHtmlForPdf.value,
  editorComponent: Editor,

  styleCategories: {
    Headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    Text: ['p', 'em', 'strong', 'code', 'blockquote'],
    Lists: ['ul', 'ol', 'li'],
    'Links & Media': ['a', 'img'],
    Tables: ['table', 'tr', 'th', 'td'],
    Other: ['hr', 'pre']
  },

  extraFieldsTitle: 'Print Header & Footer Settings',
  extraFields: [
    {
      id: 'googleFontFamily',
      label: 'Google Font Family (e.g., Inter, Open Sans)',
      type: 'input',
      inputType: 'text',
      modelKey: 'googleFontFamily',
      placeholder: 'e.g., Inter, Open Sans'
    },
    {
      id: 'printHeaderHtml',
      label: 'Print Header HTML',
      type: 'textarea',
      modelKey: 'printHeaderHtml',
      rows: 3,
      placeholder: 'HTML for page header (e.g., <h3>My Document</h3>)'
    },
    {
      id: 'printFooterHtml',
      label: 'Print Footer HTML',
      type: 'textarea',
      modelKey: 'printFooterHtml',
      rows: 3,
      placeholder: 'HTML for page footer (e.g., Page %p of %P)'
    },
    {
      id: 'headerFontSize',
      label: 'Header Font Size (px)',
      type: 'input',
      inputType: 'number',
      modelKey: 'headerFontSize',
      placeholder: '12'
    },
    {
      id: 'headerFontColor',
      label: 'Header Font Color',
      type: 'input',
      inputType: 'color',
      modelKey: 'headerFontColor'
    },
    {
      id: 'headerAlign',
      label: 'Header Alignment',
      type: 'select',
      modelKey: 'headerAlign',
      options: [
        { value: 'left', text: 'Left' },
        { value: 'center', text: 'Center' },
        { value: 'right', text: 'Right' }
      ]
    },
    {
      id: 'footerFontSize',
      label: 'Footer Font Size (px)',
      type: 'input',
      inputType: 'number',
      modelKey: 'footerFontSize',
      placeholder: '10'
    },
    {
      id: 'footerFontColor',
      label: 'Footer Font Color',
      type: 'input',
      inputType: 'color',
      modelKey: 'footerFontColor'
    },
    {
      id: 'footerAlign',
      label: 'Footer Alignment',
      type: 'select',
      modelKey: 'footerAlign',
      options: [
        { value: 'left', text: 'Left' },
        { value: 'center', text: 'Center' },
        { value: 'right', text: 'Right' }
      ]
    },
    {
      id: 'headerHeight',
      label: 'Header Margin / Height',
      type: 'input',
      inputType: 'text',
      modelKey: 'headerHeight',
      placeholder: '1.5cm'
    },
    {
      id: 'footerHeight',
      label: 'Footer Margin / Height',
      type: 'input',
      inputType: 'text',
      modelKey: 'footerHeight',
      placeholder: '1.5cm'
    },
    {
      id: 'pageMargin',
      label: 'Side Margins',
      type: 'input',
      inputType: 'text',
      modelKey: 'pageMargin',
      placeholder: '2cm'
    },
    {
      id: 'enablePageNumbers',
      label: 'Enable Page Numbers',
      type: 'checkbox',
      modelKey: 'enablePageNumbers'
    },
    {
      id: 'customCSS',
      label: 'Custom Print CSS',
      type: 'textarea',
      modelKey: 'customCSS',
      rows: 8,
      placeholder: '/* Custom CSS for print layout */'
    }
  ],

  // NEW: Custom actions for the button group
  customActions: [
    {
      id: 'show-styles',
      label: 'Styles',
      icon: Palette,
      isActive: () => showMode.value === 'styles',
      onClick: () => { showMode.value = 'styles'; }
    },
    {
      id: 'show-editor',
      label: 'Editor',
      icon: Edit3,
      isActive: () => showMode.value === 'editor',
      onClick: () => { showMode.value = 'editor'; }
    },
    {
      id: 'show-off',
      label: 'Off',
      isActive: () => showMode.value === 'off',
      onClick: () => { showMode.value = 'off'; }
    },
  ],

  // NEW: Function to get editor content
  getEditorContent: () => docStore.selectedFileContent,

  resetStyles: () => markdownStore.resetPrintStyles(),
  onBack: () => {
    if (docStore.selectedFileId) {
      router.push({ name: 'doc', params: { fileId: docStore.selectedFileId } });
    } else {
      router.push('/');
    }
  }
};

async function regeneratePdf() {
  if (!docStore.selectedFileContent || !authStore.token) {
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = '';
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const md = await markdownStore.getPrintMarkdownIt();
    const processedMarkdown = markdownStore.applyMetadataVariables(docStore.selectedFileContent);
    const rawHtmlContent = md.render(processedMarkdown);
    const htmlContent = DOMPurify.sanitize(rawHtmlContent);
    const cssStyles = markdownStore.printStylesCssString;

    finalHtmlForPdf.value = `<style>${cssStyles}</style>
      ${htmlContent}`;

    const sanitizedPrintStyles = {
      ...docStore.printStyles,
      printHeaderHtml: DOMPurify.sanitize(docStore.printStyles.printHeaderHtml || ''),
      printFooterHtml: DOMPurify.sanitize(docStore.printStyles.printFooterHtml || ''),
    };

    const response = await fetch(`${API_URL}/render-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`
      },
      body: JSON.stringify({
        htmlContent,
        cssStyles,
        printStyles: sanitizedPrintStyles
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PDF generation failed: ${errorText}`);
    }

    const blob = await response.blob();
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = URL.createObjectURL(blob);

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('PDF generation timed out');
      alert('PDF generation is taking too long. Please try again.');
    } else {
      console.error('Failed to regenerate PDF:', error);
      alert('Failed to update PDF preview. See console for details.');
    }
  }
}

watch(
  () => [docStore.printStyles, docStore.selectedFileContent],
  () => { debouncedRegeneratePdf() },
  { deep: true, immediate: true }
);

onUnmounted(() => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value);
  }
});
</script>