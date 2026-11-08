<template>
    <Teleport to="body">
        <div
            v-if="visible"
            ref="rootRef"
            class="pn-link-popover"
            :style="position"
            data-testid="link-picker-popover"
        >
            <LinkPicker
                :key="pickerKey"
                :mode="picker.request.mode"
                :query="picker.request.mode === 'wikilink' ? picker.query : picker.request.query"
                :label="picker.request.label"
                :source-id="picker.request.sourceId"
                :source-db-key="picker.request.sourceDbKey"
                :forwarded-key="picker.forwardedKey"
                @choose="onChoose"
                @close="onClose"
            />
        </div>
    </Teleport>
</template>

<script setup>
// The desktop link picker: a popover at the caret, or at the editor's top edge when the
// caret cannot be measured (docs/specs/active/editor-toc-and-internal-links.md §6.4).
// The phone opens the same picker as a sheet (phone/LinkSheet.vue).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinkPicker from '@/components/LinkPicker.vue'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { useEditorStore } from '@/store/editorStore'
import { useLinkPickerChoice } from '@/composables/useLinkPickerChoice'
import { useViewport } from '@/composables/useViewport'

const picker = useLinkPickerStore()
const editorStore = useEditorStore()
const { apply } = useLinkPickerChoice()
const { isPhone } = useViewport()
const rootRef = ref(null)

const visible = computed(() => picker.open && Boolean(picker.request) && !isPhone.value)
// A fresh picker for each opening.
const pickerKey = ref(0)
watch(() => picker.request, (next, previous) => {
    if (next && next !== previous && (!previous || next.mode !== 'wikilink' || previous.mode !== 'wikilink')) pickerKey.value += 1
})

const WIDTH = 448
const HEIGHT = 352

const position = computed(() => {
    const anchor = picker.request?.anchor
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768
    let left
    if (anchor) {
        left = anchor.left
    } else {
        const editor = document.querySelector('[data-testid="editor-container"]')?.getBoundingClientRect()
        left = (editor?.left ?? 16) + 8
        const top = (editor?.top ?? 80) + 8
        return { top: `${Math.max(8, top)}px`, left: `${Math.max(8, left)}px` }
    }
    left = Math.max(8, Math.min(left, viewportWidth - Math.min(WIDTH, viewportWidth - 16) - 8))
    // Below the caret line; above it, hugging the line, when there is no room below.
    if (anchor.bottom + 4 + HEIGHT > viewportHeight - 8 && anchor.top - HEIGHT - 4 > 8) {
        return { bottom: `${Math.max(8, viewportHeight - anchor.top + 4)}px`, left: `${left}px` }
    }
    return { top: `${Math.max(8, Math.min(anchor.bottom + 4, viewportHeight - 120))}px`, left: `${left}px` }
})

function onChoose(markdown) {
    apply(markdown)
}

function onClose() {
    const wikilink = picker.request?.mode === 'wikilink'
    picker.closePicker()
    // Esc leaves the typed `[[text`; the caret goes back to the editor.
    if (!wikilink) editorStore.focus()
}

function onPointerDown(event) {
    if (!visible.value || rootRef.value?.contains(event.target)) return
    picker.closePicker()
}

watch(visible, (open) => {
    if (open) document.addEventListener('mousedown', onPointerDown, true)
    else document.removeEventListener('mousedown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onPointerDown, true))
</script>

<style scoped>
.pn-link-popover {
    position: fixed;
    z-index: 60;
}
</style>
