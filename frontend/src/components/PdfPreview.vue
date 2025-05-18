<template>
    <div class="pdf-preview-root">
        <div v-if="!pdfUrl" class="flex-1 flex flex-col justify-center items-center text-gray-400 w-full h-full">
            <div class="mb-2">
                <svg class="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4zm2 5.29A7.95 7.95 0 014 12H0c0 3.04 1.14 5.82 3 7.94l3-2.65z" />
                </svg>
            </div>
            <span>Generating PDF preview…</span>
        </div>
        <iframe v-else :src="pdfUrl" class="pdf-preview-iframe" ref="iframeRef" title="PDF Preview" />
    </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

const props = defineProps({
    sourceHtml: { type: String, required: true }
})

const pdfUrl = ref('')
const iframeRef = ref(null)

function debounce(fn, delay = 500) {
    let timer
    return (...args) => {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), delay)
    }
}

async function regeneratePdf() {
    if (pdfUrl.value) {
        URL.revokeObjectURL(pdfUrl.value)
        pdfUrl.value = ''
    }
    const container = document.createElement('div')
    container.innerHTML = props.sourceHtml || '<span></span>'
    const A4_WIDTH = 595.28, MARGIN = 10
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    await pdf.html(container, {
        x: MARGIN,
        y: MARGIN,
        width: A4_WIDTH - MARGIN * 2,
        windowWidth: container.scrollWidth,
        autoPaging: 'text',
        html2canvas: { scale: 1.5, backgroundColor: '#fff', useCORS: true }
    })
    const blob = pdf.output('blob')
    const url = URL.createObjectURL(blob)
    pdfUrl.value = url
}

const debouncedRegenerate = debounce(regeneratePdf, 500)
watch(() => props.sourceHtml, () => {
    debouncedRegenerate()
}, { immediate: true })

onUnmounted(() => {
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
})
</script>

<style scoped>
.pdf-preview-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    flex: 1 1 0%;
    /* Container will expand to fill its parent */
}

.pdf-preview-iframe {
    flex: 1 1 0%;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: none;
    background: white;
    display: block;
}
</style>