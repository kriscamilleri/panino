<template>
  <StyleCustomizer :config="printStylesConfig">
    <div class="h-full overflow-y-auto ">
      <template v-if="!docStore.selectedFileContent">
        <div class="flex flex-col items-center justify-center h-full text-gray-500">
          <h3 class="text-lg font-semibold mb-2">No Document Selected</h3>
          <p class="mb-4">
            Please select a document from the Documents panel to generate a print
            preview.
          </p>
          <button
            @click="printStylesConfig.onBack()"
            class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900"
          >
            Back to Editor
          </button>
        </div>
      </template>

      <iframe
        v-else-if="pdfUrl"
        :src="pdfUrl"
        class="w-full h-full border-none"
        data-testid="pdf-preview-iframe"
      ></iframe>

      <div v-else class="flex items-center justify-center h-full text-gray-500">
        Generating PDF preview...
      </div>
    </div>
  </StyleCustomizer>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import StyleCustomizer from '@/components/StyleCustomizer.vue';
import { useDocStore } from '@/store/docStore';
import { useMarkdownStore } from '@/store/markdownStore';
import { jsPDF } from 'jspdf';
import { useDebounceFn } from '@vueuse/core';

const router = useRouter();
const docStore = useDocStore();
const markdownStore = useMarkdownStore();

// local copy of print styles
const editableStyleMap = ref({});
// generated PDF blob URL
const pdfUrl = ref('');
// rendered HTML string for jsPDF
const renderedHtmlForPdf = ref('');

// debounce PDF regen
const debouncedRegeneratePdf = useDebounceFn(regeneratePdf, 700);

// config object passed into StyleCustomizer
const printStylesConfig = {
  title: 'Customize Print Styles',
  getStyles: () => ({ ...docStore.printStyles }),
  updateStyleAction: docStore.updatePrintStyle,
  getMarkdownIt: docStore.getPrintMarkdownIt,
  styleCategories: {
    'Element Styles': [
      'h1','h2','h3','h4','p','em','strong','code','blockquote',
      'ul','ol','li','a','img','table','tr','th','td','hr','pre'
    ]
  },
  extraFieldsTitle: 'Print Header & Footer Settings',
  extraFields: [
    {
      id: 'googleFontFamily',
      label: 'Google Font Family (e.g., Roboto, Open Sans)',
      type: 'input',
      inputType: 'text',
      modelKey: 'googleFontFamily',
      placeholder: 'e.g., Roboto:wght@400;700'
    },
    {
      id: 'printHeaderHtml',
      label: 'Page Header Text/HTML',
      type: 'textarea',
      modelKey: 'printHeaderHtml',
      rows: 2,
      placeholder: 'Text for page headers. Basic HTML allowed.'
    },
    {
      id: 'headerFontSize',
      label: 'Header Font Size (pt)',
      type: 'input',
      inputType: 'number',
      modelKey: 'headerFontSize',
      placeholder: 'e.g., 10'
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
      id: 'printFooterHtml',
      label: 'Page Footer Text/HTML',
      type: 'textarea',
      modelKey: 'printFooterHtml',
      rows: 2,
      placeholder:
        'Use %p for current page, %P for total pages (if enabled). Basic HTML allowed.'
    },
    {
      id: 'footerFontSize',
      label: 'Footer Font Size (pt)',
      type: 'input',
      inputType: 'number',
      modelKey: 'footerFontSize',
      placeholder: 'e.g., 10'
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
      id: 'enablePageNumbers',
      label: 'Enable Page Numbers in Footer',
      type: 'checkbox',
      modelKey: 'enablePageNumbers'
    },
    {
      id: 'customCSS',
      label: 'Custom Print CSS',
      type: 'textarea',
      modelKey: 'customCSS',
      rows: 6,
      placeholder:
        '/* Add custom CSS for print styles */\n@media print {\n  body { font-family: Georgia, serif; }\n  .page-break { page-break-before: always; }\n}'
    }
  ],
  resetStyles: () => markdownStore.resetPrintStyles(),
  onBack: () => {
    if (docStore.selectedFileId) {
      router.push(`/?file=${docStore.selectedFileId}`);
    } else {
      router.push('/');
    }
  }
};

// whenever the store’s printStyles change, update our local map & regen HTML
watch(
  () => printStylesConfig.getStyles(),
  async newStyles => {
    editableStyleMap.value = { ...newStyles };
    const md = await printStylesConfig.getMarkdownIt();
    renderedHtmlForPdf.value = docStore.selectedFileContent
      ? md.render(docStore.selectedFileContent)
      : `<div style="color: #6b7280; text-align: center; padding: 2rem;">
           No document selected. Please select a document to print.
         </div>`;
    debouncedRegeneratePdf();
  },
  { deep: true, immediate: true }
);

// regenerate on content change too
watch(() => docStore.selectedFileContent, () => debouncedRegeneratePdf());

// PDF layout constants
const PDF_PAGE_WIDTH_PT = 590.78;
const PDF_PAGE_HEIGHT_PT = 841.89;
const PDF_MARGIN_PT = 36;
const PDF_CONTENT_WIDTH_PT = PDF_PAGE_WIDTH_PT - 116.90 - 2 * PDF_MARGIN_PT;

async function regeneratePdf() {
  if (!docStore.selectedFileContent) {
    if (pdfUrl.value) {
      URL.revokeObjectURL(pdfUrl.value);
      pdfUrl.value = '';
    }
    return;
  }

  const styles = editableStyleMap.value;

  // 1) hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.width = `${PDF_CONTENT_WIDTH_PT}pt`;
  iframe.style.height = '0px';
  iframe.style.visibility = 'hidden';
  iframe.style.position = 'absolute';
  iframe.style.left = '-9999px';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;

  // 2) get Google-Font CSS + TTF blobs
  const { css: gfCss, fonts } = await markdownStore.getGoogleFontData(
    styles.googleFontFamily
  );

  const html = `
    <html><head><style>
      html, body { margin:0; padding:0; box-sizing:border-box; }
      font-family: ${
        styles.googleFontFamily
          ? `'${styles.googleFontFamily
              .split(':')[0]
              .trim()
              .replace(/\+/g, ' ')}'`
          : ''
      } sans-serif;
      ${styles.customCSS || ''}
      ${gfCss || ''}
    </style></head>
    <body>
      <div class="document-container" style="padding: ${PDF_MARGIN_PT}pt;">
        ${renderedHtmlForPdf.value}
      </div>
    </body></html>
  `;
  doc.open();
  doc.write(html);
  doc.close();

  // 3) build PDF
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const registered = {};

  // embed each fetched TTF
  for (const f of fonts) {
    try {
      if (f.format?.includes('woff')) continue;
      const name = f.name.replace(/ /g, '_') + `_${f.weight}_${f.style}.ttf`;
      const b64 = f.data.split(',')[1];
      let jsStyle = 'normal';
      if (f.style.includes('italic')) jsStyle = 'italic';
      if (['bold', '700', '800', '900'].includes(`${f.weight}`)) {
        jsStyle = jsStyle === 'italic' ? 'bolditalic' : 'bold';
      }
      pdf.addFileToVFS(name, b64);
      pdf.addFont(name, f.name, jsStyle);
      registered[f.name] = registered[f.name] || {};
      registered[f.name][jsStyle] = f.name;
    } catch (e) {
      console.error(`Failed to register font ${f.name}:`, e);
    }
  }

  try {
    const hdr = styles.printHeaderHtml || '';
    const ftrTpl = styles.printFooterHtml || '';
    const hdrSz = parseFloat(styles.headerFontSize) || 10;
    const ftrSz = parseFloat(styles.footerFontSize) || 10;
    const hdrHt = hdr ? hdrSz * 1.5 : 0;
    const ftrHt = ftrTpl ? ftrSz * 1.5 : 0;

    await pdf.html(doc.body, {
      margin: [PDF_MARGIN_PT + hdrHt, PDF_MARGIN_PT, PDF_MARGIN_PT + ftrHt, PDF_MARGIN_PT],
      width: PDF_CONTENT_WIDTH_PT,
      windowWidth: iframe.contentWindow.innerWidth,
      autoPaging: 'text',
      html2canvas: {
        scale: 1.0,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      }
    });

    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);

      // choose embedded font if available
      const primary = styles.googleFontFamily
        ? styles.googleFontFamily.split(':')[0].trim().replace(/\+/g, ' ')
        : '';
      const useFont = registered[primary]?.normal ? primary : 'Helvetica';
      pdf.setFont(useFont, 'normal');

      // header
      if (hdr) {
        pdf.setFontSize(hdrSz);
        pdf.setTextColor(styles.headerFontColor || '#000000');
        let x =
          styles.headerAlign === 'center'
            ? PDF_PAGE_WIDTH_PT / 2
            : styles.headerAlign === 'right'
            ? PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT
            : PDF_MARGIN_PT;
        pdf.text(hdr, x, PDF_MARGIN_PT, {
          align: styles.headerAlign || 'center',
          maxWidth: PDF_CONTENT_WIDTH_PT
        });
      }

      // footer
      let ftext = '';
      if (styles.enablePageNumbers && ftrTpl) {
        ftext = ftrTpl
          .replace(/%p/g, `${i}`)
          .replace(/%P/g, `${pageCount}`);
      } else if (ftrTpl) {
        ftext = ftrTpl.replace(/%p/g, '').replace(/%P/g, '').trim();
      }
      if (ftext) {
        pdf.setFontSize(ftrSz);
        pdf.setTextColor(styles.footerFontColor || '#000000');
        let x =
          styles.footerAlign === 'center'
            ? PDF_PAGE_WIDTH_PT / 2
            : styles.footerAlign === 'right'
            ? PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT
            : PDF_MARGIN_PT;
        pdf.text(ftext, x, PDF_PAGE_HEIGHT_PT - PDF_MARGIN_PT, {
          align: styles.footerAlign || 'center',
          maxWidth: PDF_CONTENT_WIDTH_PT
        });
      }
    }

    const blob = pdf.output('blob');
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = URL.createObjectURL(blob);
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (pdfUrl.value) {
      URL.revokeObjectURL(pdfUrl.value);
      pdfUrl.value = '';
    }
    alert(`PDF generation failed: ${err.message}. Check console for details.`);
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

onUnmounted(() => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value);
  }
});
</script>

<style scoped>
/* everything else inherited from StyleCustomizer */
</style>
