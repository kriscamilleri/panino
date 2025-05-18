<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">{{ config.title }}</h1>
                <button @click="goBack"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
                    <ArrowLeft class="w-4 h-4" />
                    <span>Back</span>
                </button>
            </div>
        </nav>
        <div class="flex-1 flex overflow-hidden">
            <div class="w-1/2 p-8 overflow-y-auto" style="height: calc(100vh - 56px);">
                <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
                    <div class="space-y-6">
                        <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
                            <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
                            <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                                <label :for="key" class="block text-sm font-medium text-gray-700">{{ key }}</label>
                                <input :id="key" type="text" v-model="editableStyleMap[key]"
                                    @input="handleStyleChange(key, $event.target.value)"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono" />
                            </div>
                        </div>
                        <div v-if="config.extraFields && config.extraFields.length > 0" class="space-y-4 pt-8 border-t">
                            <h2 class="text-lg font-semibold text-gray-700">{{ config.extraFieldsTitle || 'Additional Settings' }}</h2>
                            <div v-for="field in config.extraFields" :key="field.id" class="space-y-2">
                                <label :for="field.id" class="block text-sm font-medium text-gray-700">{{ field.label }}</label>
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
                                    <!-- Removed labelDescription from here as it's part of the main label -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="w-1/2 bg-gray-200 border-l overflow-hidden" style="height: calc(100vh - 56px);">
                <template v-if="previewType === 'html'">
                    <div class="h-full overflow-y-auto p-8 bg-white">
                        <div class="prose max-w-none" v-html="previewHtmlContent"></div>
                    </div>
                </template>
                <template v-else-if="previewType === 'pdf'">
                    <iframe v-if="pdfUrl" :src="pdfUrl" class="w-full h-full border-none" data-testid="pdf-preview-iframe"></iframe>
                    <div v-else class="flex items-center justify-center h-full text-gray-500">
                        Generating PDF preview...
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';
import { jsPDF } from 'jspdf';

const props = defineProps({
    config: { type: Object, required: true },
    previewType: { type: String, default: 'html' }
});

const router = useRouter();
const editableStyleMap = ref({});
const pdfUrl = ref('');

const PDF_PAGE_WIDTH_PT = 590.78
const PDF_PAGE_HEIGHT_PT = 841.89;
const PDF_MARGIN_PT = 36; 
const PDF_CONTENT_WIDTH_PT = PDF_PAGE_WIDTH_PT - 116.90- 2 * PDF_MARGIN_PT ;

const debouncedRegeneratePdf = useDebounceFn(regeneratePdf, 700);

watch(
    () => props.config.getStyles(),
    (newStyles) => {
        // Ensure boolean values from store are correctly set for checkboxes
        const processedStyles = { ...newStyles };
        (props.config.extraFields || []).forEach(field => {
            if (field.type === 'checkbox' && typeof processedStyles[field.modelKey] !== 'boolean') {
                processedStyles[field.modelKey] = String(processedStyles[field.modelKey]).toLowerCase() === 'true';
            }
        });
        editableStyleMap.value = processedStyles;

        if (props.previewType === 'pdf') {
            debouncedRegeneratePdf();
        }
    },
    { deep: true, immediate: true }
);

const debouncedUpdateStore = useDebounceFn((key, value) => {
    props.config.updateStyleAction(key, value);
}, 300);

function handleStyleChange(key, newValue) {
    // For checkboxes, the value from $event.target.checked is already a boolean
    // For other inputs, it's typically a string from $event.target.value
    editableStyleMap.value[key] = newValue;
    debouncedUpdateStore(key, newValue);
}


const categorizedStyles = computed(() => {
    const currentStyles = editableStyleMap.value;
    if (!props.config.styleCategories || !currentStyles) return {};
    const extraFieldKeys = (props.config.extraFields || []).map(f => f.modelKey);
    return Object.entries(props.config.styleCategories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys.filter(key => currentStyles.hasOwnProperty(key) && !extraFieldKeys.includes(key))
                .map(key => [key, currentStyles[key]])
        );
        if (Object.keys(acc[category]).length === 0) {
            delete acc[category];
        }
        return acc;
    }, {});
});

const previewHtmlContent = computed(() => {
    if (!props.config.getMarkdownIt || !props.config.sampleMarkdown) return '';
    const md = props.config.getMarkdownIt();
    return md.render(props.config.sampleMarkdown);
});

async function regeneratePdf() {
    if (props.previewType !== 'pdf' || !previewHtmlContent.value) return;

    const currentPrintStyles = editableStyleMap.value;
    const tempRenderContainer = document.createElement('div');
    tempRenderContainer.style.width = `${PDF_CONTENT_WIDTH_PT}pt`;
    tempRenderContainer.style.fontFamily = 'sans-serif'; 
    tempRenderContainer.style.fontSize = '12pt';
    tempRenderContainer.innerHTML = previewHtmlContent.value;
    document.body.appendChild(tempRenderContainer);

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

    try {
        const headerHTML = currentPrintStyles.printHeaderHtml || "";
        const footerHTMLTemplate = currentPrintStyles.printFooterHtml || ""; // Template with placeholders
        const headerFontSize = parseFloat(currentPrintStyles.headerFontSize) || 10;
        const footerFontSize = parseFloat(currentPrintStyles.footerFontSize) || 10;
        
        const effectiveHeaderHeight = headerHTML ? headerFontSize * 1 : 0; 
        const effectiveFooterHeight = footerHTMLTemplate ? footerFontSize * 1: 0;

        await pdf.html(tempRenderContainer, {
            margin: [
                PDF_MARGIN_PT + effectiveHeaderHeight, 
                PDF_MARGIN_PT,                         
                PDF_MARGIN_PT + effectiveFooterHeight, 
                PDF_MARGIN_PT                          
            ],
            width: PDF_CONTENT_WIDTH_PT,      
            windowWidth: PDF_CONTENT_WIDTH_PT,
            autoPaging: 'text', 
            html2canvas: {
                scale: 1.0,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
                
            },
        });

        const pageCount = pdf.getNumberOfPages();
        const headerFontColor = currentPrintStyles.headerFontColor || "#000000";
        const headerAlign = currentPrintStyles.headerAlign || "center";
        const footerFontColor = currentPrintStyles.footerFontColor || "#000000";
        const footerAlign = currentPrintStyles.footerAlign || "center";
        const enablePageNumbers = currentPrintStyles.enablePageNumbers === true;


        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFont("helvetica", "normal");

            if (headerHTML) {
                pdf.setFontSize(headerFontSize);
                pdf.setTextColor(headerFontColor);
                let headerX = PDF_MARGIN_PT; 
                if (headerAlign === 'center') headerX = PDF_PAGE_WIDTH_PT / 2;
                else if (headerAlign === 'right') headerX = PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT;
                
                pdf.text(headerHTML, headerX, PDF_MARGIN_PT, { 
                    align: headerAlign,
                    maxWidth: PDF_CONTENT_WIDTH_PT 
                });
            }

            let actualFooterText = "";
            if (enablePageNumbers && footerHTMLTemplate) {
                actualFooterText = footerHTMLTemplate
                    .replace(/%p/g, i.toString())
                    .replace(/%P/g, pageCount.toString());
            } else if (footerHTMLTemplate) {
                // If page numbers are disabled, but there's a footer template, 
                // use it but remove page number placeholders.
                actualFooterText = footerHTMLTemplate.replace(/%p/g, "").replace(/%P/g, "").trim();
            }


            if (actualFooterText) { // Only draw footer if there's text to draw
                pdf.setFontSize(footerFontSize);
                pdf.setTextColor(footerFontColor);
                let footerX = PDF_MARGIN_PT; 
                if (footerAlign === 'center') footerX = PDF_PAGE_WIDTH_PT / 2;
                else if (footerAlign === 'right') footerX = PDF_PAGE_WIDTH_PT - PDF_MARGIN_PT;

                pdf.text(actualFooterText, footerX, PDF_PAGE_HEIGHT_PT - PDF_MARGIN_PT, { 
                    align: footerAlign,
                    maxWidth: PDF_CONTENT_WIDTH_PT 
                });
            }
        }

        const blob = pdf.output('blob');
        if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
        pdfUrl.value = URL.createObjectURL(blob);

    } catch (error) {
        console.error("PDF generation failed:", error);
        if (pdfUrl.value) {
             URL.revokeObjectURL(pdfUrl.value);
             pdfUrl.value = '';
        }
        alert(`PDF generation failed: ${error.message}. Check console for details.`);
    } finally {
       if (tempRenderContainer.parentNode === document.body) { // Ensure it's still a child before removing
            document.body.removeChild(tempRenderContainer);
       }
    }
}

onMounted(() => { /* Initial generation handled by watcher */ });
onUnmounted(() => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); });
function goBack() { router.push('/'); }
</script>