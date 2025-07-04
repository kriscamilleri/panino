<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <div class="flex items-center space-x-4">
                    <h1 class="text-xl font-semibold text-gray-800">Print</h1>
                    <div v-if="docStore.selectedFile" class="text-sm text-gray-600">
                        {{ docStore.selectedFile.name }}
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button @click="toggleStylesCustomization"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2"
                        :class="{ 'bg-gray-200': showStylesCustomization }">
                        <Settings class="w-4 h-4" />
                        <span>{{ showStylesCustomization ? 'Hide' : 'Show' }} Styles</span>
                    </button>
                    <button @click="goBack"
                        class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
                        <ArrowLeft class="w-4 h-4" />
                        <span>Back</span>
                    </button>
                </div>
            </div>
        </nav>
        <div class="flex-1 flex overflow-hidden">
            <div v-if="showStylesCustomization" class="w-1/2 p-8 overflow-y-auto" style="height: calc(100vh - 56px);">
                <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
                    <div class="space-y-6">
                        <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
                            <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
                            <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                                <label :for="key" class="block text-sm font-medium text-gray-700">{{ key }}</label>
                                <textarea :id="key"
                                    v-model="editableStyleMap[key]"
                                    @input="handleStyleChange(key, $event.target.value)"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                                    rows="3"
                                    :placeholder="`CSS styles for ${key} element`" />
                            </div>
                        </div>
                        <div v-if="printStylesConfig.extraFields && printStylesConfig.extraFields.length > 0" class="space-y-4 pt-8 border-t">
                            <h2 class="text-lg font-semibold text-gray-700">{{ printStylesConfig.extraFieldsTitle || 'Additional Settings' }}</h2>
                            <div v-for="field in printStylesConfig.extraFields" :key="field.id" class="space-y-2">
                                <label :for="field.id" class="block text-sm font-medium text-gray-700">{{ field.label }}</label>
                                <!-- Field types -->
                                <textarea v-if="field.type === 'textarea'" :id="field.id" :rows="field.rows || 4"
                                    v-model="editableStyleMap[field.modelKey]"
                                    @input="handleStyleChange(field.modelKey, $event.target.value)"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                                    :placeholder="field.placeholder"></textarea>
                                <input v-else-if="field.type === 'input'" :id="field.id" :type="field.inputType || 'text'"
                                    v-model="editableStyleMap[field.modelKey]"
                                    @input="handleStyleChange(field.modelKey, $event.target.value)"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                    :class="field.inputType === 'color' ? 'h-10' : ''"
                                    :placeholder="field.placeholder" />
                                <select v-else-if="field.type === 'select'" :id="field.id"
                                    v-model="editableStyleMap[field.modelKey]"
                                    @change="handleStyleChange(field.modelKey, $event.target.value)"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm">
                                    <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.text }}</option>
                                </select>
                                <div v-else-if="field.type === 'checkbox'" class="flex items-center">
                                    <input :id="field.id" type="checkbox"
                                        :checked="editableStyleMap[field.modelKey] === true || editableStyleMap[field.modelKey] === 'true'"
                                        @change="handleStyleChange(field.modelKey, $event.target.checked)"
                                        class="h-4 w-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div :class="showStylesCustomization ? 'w-1/2' : 'w-full'" class="bg-gray-200 border-l overflow-hidden" style="height: calc(100vh - 56px);">
                <div v-if="!docStore.selectedFileContent" class="flex flex-col items-center justify-center h-full text-gray-500 p-8">
                    <div class="text-center">
                        <h3 class="text-lg font-semibold mb-2">No Document Selected</h3>
                        <p class="mb-4">Please select a document from the Documents panel to generate a print preview.</p>
                        <button @click="goBack" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900">
                            Back to Editor
                        </button>
                    </div>
                </div>
                <iframe v-else-if="pdfUrl" :src="pdfUrl" class="w-full h-full border-none" data-testid="pdf-preview-iframe"></iframe>
                <div v-else class="flex items-center justify-center h-full text-gray-500">
                    Generating PDF preview...
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
/* eslint-disable max-lines */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Settings } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';
import { jsPDF } from 'jspdf';
import { useDocStore } from '@/store/docStore';
import { useMarkdownStore } from '@/store/markdownStore';

const router = useRouter();
const docStore = useDocStore();
const markdownStore = useMarkdownStore();

const editableStyleMap = ref({});
const pdfUrl = ref('');
const showStylesCustomization = ref(false);
const renderedHtmlForPdf = ref('');

const PDF_PAGE_WIDTH_PT = 590.78;
const PDF_PAGE_HEIGHT_PT = 841.89;
const PDF_MARGIN_PT = 36;
const PDF_CONTENT_WIDTH_PT = PDF_PAGE_WIDTH_PT - 116.90 - 2 * PDF_MARGIN_PT;


const debouncedRegeneratePdf = useDebounceFn(regeneratePdf, 700);

/* --------------------------- Config definition -------------------------- */
const printStylesConfig = {
    title: 'Customize Print Styles',
    getStyles: () => ({ ...docStore.printStyles }),
    updateStyleAction: docStore.updatePrintStyle,
    getMarkdownIt: docStore.getPrintMarkdownIt,
    styleCategories: {
        'Element Styles': ['h1', 'h2', 'h3', 'h4', 'p', 'em', 'strong', 'code', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'tr', 'th', 'td', 'hr', 'pre'],
    },
    extraFieldsTitle: 'Print Header & Footer Settings',
    extraFields: [
        { id: 'googleFontFamily', label: 'Google Font Family (e.g., Roboto, Open Sans)', type: 'input', inputType: 'text', modelKey: 'googleFontFamily', placeholder: 'e.g., Roboto:wght@400;700' },
        { id: 'printHeaderHtml', label: 'Page Header Text/HTML', type: 'textarea', modelKey: 'printHeaderHtml', rows: 2, placeholder: 'Text for page headers. Basic HTML allowed.' },
        { id: 'headerFontSize', label: 'Header Font Size (pt)', type: 'input', inputType: 'number', modelKey: 'headerFontSize', placeholder: 'e.g., 10' },
        { id: 'headerFontColor', label: 'Header Font Color', type: 'input', inputType: 'color', modelKey: 'headerFontColor' },
        {
            id: 'headerAlign', label: 'Header Alignment', type: 'select', modelKey: 'headerAlign',
            options: [{ value: 'left', text: 'Left' }, { value: 'center', text: 'Center' }, { value: 'right', text: 'Right' }]
        },
        { id: 'printFooterHtml', label: 'Page Footer Text/HTML', type: 'textarea', modelKey: 'printFooterHtml', rows: 2, placeholder: 'Use %p for current page, %P for total pages (if enabled). Basic HTML allowed.' },
        { id: 'footerFontSize', label: 'Footer Font Size (pt)', type: 'input', inputType: 'number', modelKey: 'footerFontSize', placeholder: 'e.g., 10' },
        { id: 'footerFontColor', label: 'Footer Font Color', type: 'input', inputType: 'color', modelKey: 'footerFontColor' },
        {
            id: 'footerAlign', label: 'Footer Alignment', type: 'select', modelKey: 'footerAlign',
            options: [{ value: 'left', text: 'Left' }, { value: 'center', text: 'Center' }, { value: 'right', text: 'Right' }]
        },
        { id: 'enablePageNumbers', label: 'Enable Page Numbers in Footer', type: 'checkbox', modelKey: 'enablePageNumbers' },
        {
            id: 'customCSS',
            label: 'Custom Print CSS',
            type: 'textarea',
            modelKey: 'customCSS',
            rows: 6,
            placeholder: '/* Add custom CSS for print styles */\n@media print {\n  body { font-family: Georgia, serif; }\n  .page-break { page-break-before: always; }\n}'
        }
    ]
};

/* --------------------------- Style watchers ----------------------------- */
watch(
    () => printStylesConfig.getStyles(),
    async (newStyles) => {
        const processedStyles = { ...newStyles };
        (printStylesConfig.extraFields || []).forEach(field => {
            if (field.type === 'checkbox' && typeof processedStyles[field.modelKey] !== 'boolean') {
                processedStyles[field.modelKey] = String(processedStyles[field.modelKey]).toLowerCase() === 'true';
            }
        });
        editableStyleMap.value = processedStyles;

        const mdInstance = await docStore.getPrintMarkdownIt();
        const contentToRender = docStore.selectedFileContent || '';
        renderedHtmlForPdf.value = contentToRender ? mdInstance.render(contentToRender) : '<div style="color: #6b7280; text-align: center; padding: 2rem;">No document selected. Please select a document to print.</div>';

        debouncedRegeneratePdf();
    },
    { deep: true, immediate: true }
);

/* -------------------- Utility: update store on change ------------------- */
const debouncedUpdateStore = useDebounceFn((key, value) => {
    printStylesConfig.updateStyleAction(key, value);
}, 300);
function handleStyleChange(key, newValue) {
    editableStyleMap.value[key] = newValue;
    debouncedUpdateStore(key, newValue);
}
function toggleStylesCustomization() { showStylesCustomization.value = !showStylesCustomization.value; }

/* ----------------------- Categorisation for UI -------------------------- */
const categorizedStyles = computed(() => {
    const currentStyles = editableStyleMap.value;
    if (!printStylesConfig.styleCategories || !currentStyles) return {};
    const extraFieldKeys = (printStylesConfig.extraFields || []).map(f => f.modelKey);
    return Object.entries(printStylesConfig.styleCategories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys.filter(key => currentStyles.hasOwnProperty(key) && !extraFieldKeys.includes(key))
                .map(key => [key, currentStyles[key]])
        );
        if (Object.keys(acc[category]).length === 0) delete acc[category];
        return acc;
    }, {});
});

/* --------------------------- PDF generation ----------------------------- */
async function regeneratePdf() {
    if (!docStore.selectedFileContent) {
        if (pdfUrl.value) { URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = ''; }
        return;
    }

    const currentPrintStyles = editableStyleMap.value;

    /* ------------------ 1) Setup temporary iframe ---------------------- */
    const iframe = document.createElement('iframe');
    iframe.style.width = `${PDF_CONTENT_WIDTH_PT}pt`;
    iframe.style.height = '0px';
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

    /* ----------- 2) Google Fonts: fetch + embed as Base64 -------------- */
    const { css: googleFontCss, fonts: fetchedFonts } = await markdownStore.getGoogleFontData(currentPrintStyles.googleFontFamily);

    let fullHtmlContent = `
        <html>
        <head>
            <style>
                html, body { margin: 0; padding: 0; box-sizing: border-box; }
                font-family: ${currentPrintStyles.googleFontFamily ? `'${currentPrintStyles.googleFontFamily.split(':')[0].trim().replace(/\+/g, ' ')}',` : ''} sans-serif;
                ${currentPrintStyles.customCSS || ''}
                ${googleFontCss || ''}
            </style>
        </head>
        <body>
            <div class="document-container" style="padding: ${PDF_MARGIN_PT}pt;">
                ${renderedHtmlForPdf.value}
            </div>
        </body>
        </html>
    `;

    iframeDoc.open();
    iframeDoc.write(fullHtmlContent);
    iframeDoc.close();

    /* ------------------ 3) Build PDF with jsPDF ------------------------ */
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const registeredJsPdfFonts = {};

    for (const font of fetchedFonts) {
        const { name, data: base64Data, format, style, weight } = font;
        try {
            /* -------------------------------------------------------------------
             * CRITICAL FIX
             * -------------------------------------------------------------------
             * jsPDF cannot embed WOFF2 (or WOFF) directly. Attempting to do so
             * leads to a "Cannot read properties of undefined (reading 'Unicode')"
             * error because the TTF parser fails.
             *
             * We now **skip** any font whose format is not TrueType‑compatible.
             * The print will still look correct because the text is rasterised by
             * html2canvas, and headers/footers will gracefully fall back to
             * built‑in fonts (Helvetica, Times, etc.).
             * ------------------------------------------------------------------- */
            if (format.includes('woff2') || format.includes('woff')) {
                console.warn(`Skipping font "${name}" because jsPDF cannot embed the unsupported format "${format}". Falling back to built‑in fonts.`);
                continue; // <- prevents the jsPDF Unicode cmap error
            }

            const uniqueFontFileName = `${name.replace(/ /g, '_')}_${weight || 'normal'}_${style || 'normal'}.ttf`;
            let jsPdfStyle = 'normal';
            if (style.includes('italic')) jsPdfStyle = 'italic';
            if (['bold', '700', '800', '900'].includes(String(weight))) {
                jsPdfStyle = jsPdfStyle === 'italic' ? 'bolditalic' : 'bold';
            }

            const base64String = base64Data.split(',')[1];
            pdf.addFileToVFS(uniqueFontFileName, base64String);
            pdf.addFont(uniqueFontFileName, name, jsPdfStyle);

            if (!registeredJsPdfFonts[name]) registeredJsPdfFonts[name] = {};
            registeredJsPdfFonts[name][jsPdfStyle] = name;
        } catch (e) {
            console.error(`Failed to register font ${name}:`, e);
        }
    }

    try {
        /* ---------- 3a) Render main body via html2canvas --------------- */
        const headerHTML = currentPrintStyles.printHeaderHtml || "";
        const footerHTMLTemplate = currentPrintStyles.printFooterHtml || "";
        const headerFontSize = parseFloat(currentPrintStyles.headerFontSize) || 10;
        const footerFontSize = parseFloat(currentPrintStyles.footerFontSize) || 10;

        const effectiveHeaderHeight = headerHTML ? headerFontSize * 1.5 : 0;
        const effectiveFooterHeight = footerHTMLTemplate ? footerFontSize * 1.5 : 0;

        await pdf.html(iframeDoc.body, {
            margin: [PDF_MARGIN_PT + effectiveHeaderHeight, PDF_MARGIN_PT, PDF_MARGIN_PT + effectiveFooterHeight, PDF_MARGIN_PT],
            width: PDF_CONTENT_WIDTH_PT,
            windowWidth: iframe.contentWindow.innerWidth,
            autoPaging: 'text',
            html2canvas: {
                scale: 1.0,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
            },
        });

        /* ---------------- 3b) Headers / Footers ------------------------ */
        const pageCount = pdf.getNumberOfPages();
        const headerFontColor = currentPrintStyles.headerFontColor || "#000000";
        const headerAlign = currentPrintStyles.headerAlign || "center";
        const footerFontColor = currentPrintStyles.footerFontColor || "#000000";
        const footerAlign = currentPrintStyles.footerAlign || "center";
        const enablePageNumbers = currentPrintStyles.enablePageNumbers === true;

        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);

            const primaryFontFamily = currentPrintStyles.googleFontFamily ? currentPrintStyles.googleFontFamily.split(':')[0].trim().replace(/\+/g, ' ') : '';
            let fontToUse = registeredJsPdfFonts[primaryFontFamily]?.normal ? primaryFontFamily : 'Helvetica';
            pdf.setFont(fontToUse, 'normal');

            if (headerHTML) {
                pdf.setFontSize(headerFontSize);
                pdf.setTextColor(headerFontColor);
                let headerX = PDF_MARGIN_PT;
                if (headerAlign === 'center') headerX = PDF_PAGE_WIDTH_PT / 2;
                else if (headerAlign === 'right') headerX = PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT;
                pdf.text(headerHTML, headerX, PDF_MARGIN_PT, { align: headerAlign, maxWidth: PDF_CONTENT_WIDTH_PT });
            }

            let actualFooterText = "";
            if (enablePageNumbers && footerHTMLTemplate) {
                actualFooterText = footerHTMLTemplate.replace(/%p/g, i.toString()).replace(/%P/g, pageCount.toString());
            } else if (footerHTMLTemplate) {
                actualFooterText = footerHTMLTemplate.replace(/%p/g, '').replace(/%P/g, '').trim();
            }

            if (actualFooterText) {
                pdf.setFontSize(footerFontSize);
                pdf.setTextColor(footerFontColor);
                let footerX = PDF_MARGIN_PT;
                if (footerAlign === 'center') footerX = PDF_PAGE_WIDTH_PT / 2;
                else if (footerAlign === 'right') footerX = PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT;
                pdf.text(actualFooterText, footerX, PDF_PAGE_HEIGHT_PT - PDF_MARGIN_PT, { align: footerAlign, maxWidth: PDF_CONTENT_WIDTH_PT });
            }
        }

        /* -------------------- 3c) Export blob -------------------------- */
        const blob = pdf.output('blob');
        if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
        pdfUrl.value = URL.createObjectURL(blob);
    } catch (error) {
        console.error('PDF generation failed:', error);
        if (pdfUrl.value) { URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = ''; }
        alert(`PDF generation failed: ${error.message}. Check console for details.`);
    } finally {
        if (iframe && iframe.parentNode === document.body) {
            document.body.removeChild(iframe);
        }
    }
}

/* --------------------------- Additional watchers ----------------------- */
watch(() => docStore.selectedFileContent, () => {
    // Content change triggers the styles watcher via markdown re‑render
});

onMounted(() => {});
onUnmounted(() => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); });

function goBack() { router.push('/'); }
</script>

<style scoped>
/* Optional scoped styles */
</style>
