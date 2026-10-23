<template>
    <BottomSheet
        :open="open && Boolean(file)"
        label="Export as PDF"
        tall
        testid="phone-export-sheet"
        @close="$emit('close')"
    >
        <template #header>
            <div class="ph-export-head">
                <h2 class="ph-export-title">Export as PDF</h2>
                <p class="ph-muted">{{ file?.title || 'Untitled' }}</p>
            </div>
        </template>

        <div class="ph-export-body">
            <div
                ref="frameBoxRef"
                class="ph-export-page"
                :style="{ height: `${previewHeight}px` }"
            >
                <!-- Sandboxed: the preview can never run script. -->
                <iframe
                    v-if="previewDoc"
                    title="First page preview"
                    sandbox=""
                    :srcdoc="previewDoc"
                    :style="frameStyle"
                    tabindex="-1"
                    data-testid="phone-export-preview"
                ></iframe>
            </div>

            <div class="ph-export-row">
                <p class="ph-section-label">Paper</p>
                <SegmentedControl
                    v-model="paper"
                    label="Paper size"
                    testid-prefix="phone-export-paper"
                    :options="PAPER_OPTIONS"
                />
            </div>

            <div class="ph-export-row ph-export-style">
                <div>
                    <p class="ph-section-label">Style</p>
                    <p class="ph-muted">Your print style</p>
                </div>
                <button
                    type="button"
                    class="ph-btn"
                    data-testid="phone-export-edit-style"
                    @click="closeSheetAndGo({ name: 'print-styles' })"
                >Edit style</button>
            </div>
        </div>

        <template #footer>
            <div class="ph-export-actions">
                <button
                    v-if="canShareFiles"
                    type="button"
                    class="ph-btn"
                    :disabled="busy"
                    data-testid="phone-export-share"
                    @click="run('share')"
                >
                    <Share2
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                    Share…
                </button>
                <button
                    type="button"
                    class="ph-btn ph-btn-primary ph-export-download"
                    :disabled="busy || !syncStore.isOnline"
                    :aria-busy="busy"
                    data-testid="phone-export-download"
                    @click="run('download')"
                >
                    <Loader2
                        v-if="busy"
                        class="h-5 w-5 animate-spin"
                        aria-hidden="true"
                    />
                    <Download
                        v-else
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                    {{ busy ? 'Rendering…' : syncStore.isOnline ? 'Download PDF' : 'Needs a connection' }}
                </button>
            </div>
        </template>
    </BottomSheet>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import DOMPurify from 'dompurify'
import { Download, Share2, Loader2 } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import { useAuthStore } from '@/store/authStore'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useEditorStore } from '@/store/editorStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { buildPdfRequest, requestPdf, normalizePaperSize, pdfFileName } from '@/utils/pdfExport'

const PAPER_OPTIONS = [
    { value: 'A4', label: 'A4' },
    { value: 'Letter', label: 'Letter' },
]
// CSS px at 96 dpi.
const PAPER_PX = { A4: { width: 794, height: 1123 }, Letter: { width: 816, height: 1056 } }
const API_URL = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000')

const props = defineProps({
    open: { type: Boolean, default: false },
})
defineEmits(['close'])

const authStore = useAuthStore()
const docStore = useDocStore()
const draftStore = useDraftStore()
const editorStore = useEditorStore()
const markdownStore = useMarkdownStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { closeSheetAndGo } = useSheetRoute()
const { selectedFile: file } = storeToRefs(docStore)

const paper = ref('A4')
const busy = ref(false)
const renderedHtml = ref('')
const frameBoxRef = ref(null)
const boxWidth = ref(320)

const canShareFiles = computed(() => typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }))

const pageSize = computed(() => PAPER_PX[paper.value])
const scale = computed(() => boxWidth.value / pageSize.value.width)
const previewHeight = computed(() => Math.round(pageSize.value.height * scale.value))
const frameStyle = computed(() => ({
    width: `${pageSize.value.width}px`,
    height: `${pageSize.value.height}px`,
    transform: `scale(${scale.value})`,
}))

/** Page 1 as the renderer would lay it out: print CSS, margins, paper width. */
const previewDoc = computed(() => {
    if (!renderedHtml.value) return ''
    const margin = String(docStore.printStyles?.pageMargin || '2cm').replace(/[^0-9a-z.%\s]/gi, '')
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;overflow:hidden}
body{padding:${margin};box-sizing:border-box;width:100%;height:100%}
${markdownStore.printStylesCssString}
</style></head><body>${renderedHtml.value}</body></html>`
})

function currentMarkdown() {
    return (file.value && draftStore.getDraft(file.value.id)) ?? file.value?.content ?? ''
}

async function renderHtml() {
    const md = await markdownStore.getPrintMarkdownIt()
    return DOMPurify.sanitize(md.render(markdownStore.applyMetadataVariables(currentMarkdown())))
}

// Also when the Document arrives: a reload or link can open the sheet before it loads.
watch(() => [props.open, file.value?.id], async ([isOpen]) => {
    if (!isOpen || !file.value) return
    paper.value = normalizePaperSize(docStore.printStyles?.pageSize)
    renderedHtml.value = await renderHtml()
    await nextTick()
    boxWidth.value = frameBoxRef.value?.clientWidth || boxWidth.value
}, { immediate: true })

async function run(action) {
    if (busy.value || !file.value) return
    busy.value = true
    try {
        // The PDF is made from the saved Document, so save what is pending.
        await editorStore.flushPendingSave()
        const body = buildPdfRequest({
            html: await renderHtml(),
            cssStyles: markdownStore.printStylesCssString,
            printStyles: docStore.printStyles,
            sanitize: (html) => DOMPurify.sanitize(html),
            pageSize: paper.value,
        })
        const blob = await requestPdf({ apiUrl: API_URL, token: authStore.token, body })
        const name = pdfFileName(file.value.title)
        if (action === 'share') {
            const shared = new File([blob], name, { type: 'application/pdf' })
            await navigator.share({ files: [shared], title: file.value.title || 'Document' })
        } else {
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = name
            document.body.appendChild(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(url), 10000)
        }
    } catch (error) {
        if (error?.name === 'AbortError' && action === 'share') return // the share sheet was closed
        console.error('[ExportSheet] Export failed:', error)
        ui.addToast(error?.name === 'AbortError'
            ? 'The PDF took too long. Try again.'
            : 'The PDF could not be made. Try again.', 'error')
    } finally {
        busy.value = false
    }
}
</script>

<style scoped>
.ph-export-head {
    padding: 0 8px;
}

.ph-export-title {
    font-size: 20px;
    font-weight: 600;
}

.ph-export-body {
    padding: 8px 20px 16px;
}

.ph-export-page {
    position: relative;
    width: min(100%, 280px);
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--ph-line);
    border-radius: 6px;
    background: #fff;
    box-shadow: var(--ph-shadow);
}

.ph-export-page iframe {
    position: absolute;
    top: 0;
    left: 0;
    border: 0;
    transform-origin: top left;
    pointer-events: none;
}

.ph-export-row {
    margin-top: 18px;
}

.ph-export-row .ph-section-label {
    margin-bottom: 8px;
}

.ph-export-style {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.ph-export-style .ph-section-label {
    margin-bottom: 2px;
}

.ph-export-actions {
    display: flex;
    gap: 10px;
}

.ph-export-download {
    flex: 1;
}
</style>
