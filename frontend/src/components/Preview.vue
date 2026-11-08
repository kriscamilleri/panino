<template>
    <div v-if="file || source !== null">
        <TocStaleNotice
            v-if="source === null"
            testid="preview-toc"
        />
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
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { useStylePresetStore } from '@/store/stylePresetStore'
import { useUiStore } from '@/store/uiStore'
import { useDocumentLinkStore } from '@/store/documentLinkStore'
import { useDocumentLinks } from '@/composables/useDocumentLinks'
import { classifyPreviewLink, findHeadingElement, scrollToHeading } from '@/utils/previewLinks'
import TocStaleNotice from '@/components/TocStaleNotice.vue'
import DOMPurify from 'dompurify'

const props = defineProps({
    // Phones tick checklist items straight from the Preview.
    interactiveTasks: { type: Boolean, default: false },
    // Markdown to show instead of the selected Document, such as an unsaved draft.
    // Links are inert then, so a capture is never left by accident.
    source: { type: String, default: null },
})
const emit = defineEmits(['toggle-task'])

const route = useRoute()
const docStore = useDocStore()
const draftStore = useDraftStore()
const contentRef = ref(null)
const markdownStore = useMarkdownStore()
const stylePresetStore = useStylePresetStore()
const ui = useUiStore()
const linkStore = useDocumentLinkStore()
const { followDocument, decorate } = useDocumentLinks()

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
    // A link to a heading of this Document, written as a Document link, stays here.
    const raw = md.render(withPageBreaks, { documentId: props.source === null ? file.value?.id ?? null : null })
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

/** Titles and broken styles on links, set through DOM APIs after sanitizing. */
async function decorateLinks() {
    if (!contentRef.value) return
    try {
        await decorate(contentRef.value)
    } catch (error) {
        console.error('[Preview] Decorating links failed:', error)
    }
}
watch([renderedHtml, () => linkStore.version], () => nextTick(decorateLinks), { immediate: true })

function scrollHere(slug) {
    if (!contentRef.value) return false
    return scrollToHeading(contentRef.value, slug)
}

function handleTaskClick(event) {
    if (!props.interactiveTasks) return false
    const box = event.target
    if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-list-item-checkbox')) return false
    // The source is the truth: undo the browser's own toggle and let the
    // re-render show the new state once the source has changed.
    event.preventDefault()
    const boxes = taskCheckboxes()
    emit('toggle-task', { index: boxes.indexOf(box), count: boxes.length })
    return true
}

/**
 * Links (docs/specs/active/editor-toc-and-internal-links.md §6.5). Every `#…` link is
 * handled here: the app uses hash routing, so a fragment left to the browser would
 * navigate the app. A heading scrolls the Preview; a Document link opens through the
 * router after resolving locally; anything else starting with `#` does nothing.
 */
function handleClick(event) {
    if (handleTaskClick(event)) return
    const link = classifyPreviewLink(event.target, contentRef.value)
    if (!link) return
    if (props.source !== null) {
        if (link.kind !== 'external') event.preventDefault()
        return
    }
    switch (link.kind) {
        case 'heading':
            event.preventDefault()
            scrollHere(link.slug)
            return
        case 'document': {
            const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1
            // A resolved link opens in a new tab the usual way.
            if (modified && !link.element.classList.contains('pn-link-broken')) return
            event.preventDefault()
            void followDocument({ id: link.id, heading: link.heading }, { onSameDocument: (slug) => scrollHere(slug) })
            return
        }
        case 'inert':
            event.preventDefault()
            return
        default:
    }
}

// A heading link followed in the editor scrolls the Preview.
watch(() => linkStore.headingRequest, (request) => {
    if (!request || props.source !== null) return
    nextTick(() => scrollHere(request.slug))
})

/**
 * Arriving at a heading (`#/doc/<id>?heading=<slug>`): scroll to it once, after the
 * first render of that Document; a heading that is gone opens at the top with a notice.
 */
let arrivalHandled = ''
function handleArrival() {
    if (props.source !== null || !file.value || !contentRef.value) return
    const heading = typeof route?.query?.heading === 'string' ? route.query.heading : ''
    if (!heading) {
        arrivalHandled = ''
        return
    }
    if (route?.params?.fileId !== file.value.id || !text.value) return
    const key = `${file.value.id}|${heading}|${window.history.state?.position ?? ''}`
    if (arrivalHandled === key) return
    arrivalHandled = key
    if (findHeadingElement(contentRef.value, heading)) scrollHere(heading)
    else ui.addToast('Heading not found', 'info')
}
watch([renderedHtml, () => route?.query?.heading, () => file.value?.id], () => nextTick(handleArrival), { immediate: true })
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

/*
 * A numbered table of contents carries its outline numbers as text, so its bullets
 * are hidden, and nested levels lose the named style's 1rem list margins. The same
 * rules are in every PDF (pdf.js TOC_PRINT_CSS). `!important` beats the inline style.
 */
:deep(.pn-toc-numbered) {
    font-variant-numeric: tabular-nums;
}

:deep(.pn-toc-numbered ul) {
    list-style-type: none !important;
}

:deep(.pn-toc ul ul) {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
}

/* A link that goes nowhere for this reader: not found, not shared, or not supported. */
:deep(.pn-link-broken) {
    color: #9ca3af !important;
    text-decoration: line-through dotted !important;
    cursor: not-allowed;
}

:deep([id^='pn-']:focus) {
    outline: none;
}
</style>
