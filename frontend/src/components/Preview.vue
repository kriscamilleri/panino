<template>
    <div v-if="file || source !== null">
        <!-- `renderedHtml` is sanitized with DOMPurify below. -->
        <div
            ref="contentRef"
            class="mt-2"
            v-html="renderedHtml"
            data-testid="preview-content"
            @click="handleClick"
        ></div>
    </div>
    <div
        v-else
        data-testid="preview-no-file"
    >
        <p class="text-gray-500">No file selected</p>
    </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { useStylePresetStore } from '@/store/stylePresetStore'
import DOMPurify from 'dompurify'

const props = defineProps({
    // Phones tick checklist items straight from the Preview.
    interactiveTasks: { type: Boolean, default: false },
    // Markdown to show instead of the selected Document, such as an unsaved draft.
    source: { type: String, default: null },
})
const emit = defineEmits(['toggle-task'])

const docStore = useDocStore()
const draftStore = useDraftStore()
const contentRef = ref(null)
const markdownStore = useMarkdownStore()
const stylePresetStore = useStylePresetStore()

// pull the ref directly
const { selectedFile: file, selectedFileContent } = storeToRefs(docStore)

// preview text = draft if present, else DB content
const text = computed(() => {
    if (props.source !== null) return props.source
    if (!file.value) return ''
    const draft = draftStore.getDraft(file.value.id)
    return draft || selectedFileContent.value
})

const renderedHtml = computed(() => {
    // The Document's named style, if its front matter or folder chooses one.
    // Other text, such as a capture draft, belongs to no folder yet.
    const md = docStore.getMarkdownIt(props.source === null
        ? stylePresetStore.resolveForSelected('preview', text.value || '').values
        : undefined)
    const source = markdownStore.applyMetadataVariables(text.value || '')
    const withPageBreaks = source
        .replace(/\\pagebreak/g, '\n<div class="pagebreak-banner" data-pagebreak="true">Page break</div>\n')
        .replace(/<!--\s*pagebreak\s*-->/g, '\n<div class="pagebreak-banner" data-pagebreak="true">Page break</div>\n')
        .replace(/---\s*pagebreak\s*---/gi, '\n<div class="pagebreak-banner" data-pagebreak="true">Page break</div>\n')
    const raw = md.render(withPageBreaks)
    return DOMPurify.sanitize(raw)
})

function taskCheckboxes() {
    return [...(contentRef.value?.querySelectorAll('input.task-list-item-checkbox') ?? [])]
}

/**
 * The renderer emits disabled boxes, which swallow taps. Enable only those,
 * after sanitizing, and name each one after its item for screen readers.
 */
function enableTaskCheckboxes() {
    if (!props.interactiveTasks) return
    for (const box of taskCheckboxes()) {
        box.disabled = false
        // The item's own line; nested items follow on later lines.
        const label = (box.parentElement?.textContent || '').trim().split('\n')[0].trim()
        box.setAttribute('aria-label', `${box.checked ? 'Mark not done' : 'Mark done'}: ${label}`)
    }
}

watch([renderedHtml, () => props.interactiveTasks], () => nextTick(enableTaskCheckboxes), { immediate: true })

function handleClick(event) {
    if (!props.interactiveTasks) return
    const box = event.target
    if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-list-item-checkbox')) return
    // The source is the truth: undo the browser's own toggle and let the
    // re-render show the new state once the source has changed.
    event.preventDefault()
    const boxes = taskCheckboxes()
    emit('toggle-task', { index: boxes.indexOf(box), count: boxes.length })
}
</script>

<style scoped>
:deep(.pagebreak-banner) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 2rem 0;
    width: 100%;
    color: #6b7280;
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    user-select: none;
    background: #f9fafb;
    padding: 0.35rem 0.85rem;
}

:deep(.pagebreak-banner)::before,
:deep(.pagebreak-banner)::after {
    content: '';
    flex: 1 1 auto;
    height: 1px;
    background-color: rgba(156, 163, 175, 0.6);
}
</style>
