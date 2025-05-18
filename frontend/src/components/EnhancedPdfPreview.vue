<template>
    <div class="h-full flex flex-col">
        <!-- Loading State -->
        <div v-if="isGenerating" class="flex-1 flex items-center justify-center">
            <div class="text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-gray-900 mb-4"></div>
                <p class="text-gray-600">Generating PDF preview...</p>
            </div>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="flex-1 flex items-center justify-center">
            <div class="text-center bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-red-500 mb-4" fill="none"
                    viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 class="text-lg font-semibold text-red-700 mb-2">PDF Generation Failed</h3>
                <p class="text-red-600 mb-4">{{ error }}</p>
                <button @click="retryGeneration" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900">
                    Try Again
                </button>
            </div>
        </div>

        <!-- PDF Preview -->
        <iframe v-else-if="pdfObjectUrl" :src="pdfObjectUrl" class="flex-1 w-full border-none"></iframe>

        <!-- Empty State -->
        <div v-else class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-500">
                <p>No content to preview</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { createPdfExporter } from '@/utils/PdfExporter';

const props = defineProps({
    // HTML content to render in the PDF
    content: {
        type: String,
        required: true
    },

    // Document title
    title: {
        type: String,
        default: 'Document'
    },

    // Header content - can be a string or object with left/right properties
    headerContent: {
        type: [String, Object],
        default: null
    },

    // Footer content - can be a string or object with left/right properties
    footerContent: {
        type: [String, Object],
        default: null
    },

    // If true, generates preview automatically when component mounts
    autoGenerate: {
        type: Boolean,
        default: true
    },

    // PDF options
    options: {
        type: Object,
        default: () => ({})
    }
});

const isGenerating = ref(false);
const error = ref(null);
const pdfObjectUrl = ref(null);
const pdfExporter = ref(null);

// Initialize PDF exporter
onMounted(async () => {
    try {
        pdfExporter.value = createPdfExporter(props.options);

        if (props.autoGenerate && props.content) {
            await nextTick();
            generatePreview();
        }
    } catch (err) {
        console.error('Failed to initialize PDF exporter:', err);
        error.value = 'Failed to initialize PDF preview.';
    }
});

// Clean up object URL when component is unmounted
onUnmounted(() => {
    cleanupObjectUrl();
});

// Watch for content changes to regenerate PDF
watch(() => props.content, () => {
    if (props.content && pdfExporter.value) {
        generatePreview();
    }
});

// Clean up existing object URL
function cleanupObjectUrl() {
    if (pdfObjectUrl.value) {
        URL.revokeObjectURL(pdfObjectUrl.value);
        pdfObjectUrl.value = null;
    }
}

// Generate PDF preview
async function generatePreview() {
    if (isGenerating.value) return;

    cleanupObjectUrl();
    isGenerating.value = true;
    error.value = null;

    try {
        // Validate content
        if (!props.content || props.content.trim() === '') {
            throw new Error('No content provided for PDF generation');
        }

        // Prepare metadata
        const metadata = {
            title: props.title,
            headerContent: props.headerContent,
            footerContent: props.footerContent
        };

        // Generate PDF
        const pdf = await pdfExporter.value.generatePDF(props.content, metadata);

        // Convert to object URL
        const blob = pdf.output('blob');
        pdfObjectUrl.value = URL.createObjectURL(blob);
    } catch (err) {
        console.error('PDF generation failed:', err);
        error.value = err.message || 'Failed to generate PDF preview';
    } finally {
        isGenerating.value = false;
    }
}

// Retry PDF generation
function retryGeneration() {
    if (pdfExporter.value && props.content) {
        generatePreview();
    }
}

// Expose methods
defineExpose({
    generatePreview,
    cleanupObjectUrl
});
</script>