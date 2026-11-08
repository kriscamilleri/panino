<template>
    <BottomSheet
        :open="open && Boolean(file)"
        label="Contents options"
        testid="phone-toc-sheet"
        @close="$emit('close')"
    >
        <template #header>
            <h2 class="ph-toc-title">Contents options</h2>
        </template>
        <div class="ph-toc-body">
            <TocOptionsForm
                :initial="initial"
                @apply="apply"
                @cancel="$emit('close')"
            />
        </div>
    </BottomSheet>
</template>

<script setup>
// Table of contents options on the phone: `?sheet=toc`, from the Document menu.
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import TocOptionsForm from '@/components/TocOptionsForm.vue'
import { useDocStore } from '@/store/docStore'
import { useTableOfContentsStore } from '@/store/tableOfContentsStore'

const props = defineProps({
    open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const docStore = useDocStore()
const tocStore = useTableOfContentsStore()
const { selectedFile: file } = storeToRefs(docStore)

const initial = computed(() => (props.open ? tocStore.optionsFor(0) : null))

async function apply(options) {
    emit('close')
    await tocStore.applyOptions(0, options)
}
</script>

<style scoped>
.ph-toc-title {
    padding: 0 8px;
    font-size: 20px;
    font-weight: 600;
}

.ph-toc-body {
    padding: 4px 20px 20px;
}
</style>
