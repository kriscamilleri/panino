<template>
    <BottomSheet
        :open="open && Boolean(picker.request)"
        label="Insert link"
        testid="phone-link-sheet"
        tall
        @close="close"
    >
        <template #header>
            <h2 class="ph-link-title">Insert link</h2>
        </template>
        <LinkPicker
            v-if="picker.request"
            :key="openings"
            layout="sheet"
            mode="link"
            :query="picker.request.query"
            :label="picker.request.label"
            :source-id="picker.request.sourceId"
            :source-db-key="picker.request.sourceDbKey"
            @choose="choose"
            @close="close"
        />
    </BottomSheet>
</template>

<script setup>
// The phone link picker (docs/specs/active/editor-toc-and-internal-links.md §6.4):
// `?sheet=link`, opened by the Link key or by typing `[[`. The sheet is pinned to the
// visual viewport, so it ends above the keyboard, and the search field takes focus.
import { ref, watch } from 'vue'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import LinkPicker from '@/components/LinkPicker.vue'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { useLinkPickerChoice } from '@/composables/useLinkPickerChoice'

const props = defineProps({
    open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const picker = useLinkPickerStore()
const { apply } = useLinkPickerChoice()
const openings = ref(0)

watch(() => props.open, (isOpen) => {
    if (isOpen) openings.value += 1
    // Back or a swipe closed the sheet: nothing is written.
    else if (picker.open) picker.closePicker()
})

function choose(markdown) {
    emit('close')
    // The editor is under the sheet; write once the sheet is on its way out.
    apply(markdown)
}

function close() {
    picker.closePicker()
    emit('close')
}
</script>

<style scoped>
.ph-link-title {
    padding: 0 8px;
    font-size: 20px;
    font-weight: 600;
}
</style>
