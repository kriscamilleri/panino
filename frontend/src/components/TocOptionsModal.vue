<template>
    <BaseModal
        :show="picker.tocOptionsOpen && !isPhone"
        title="Table of contents"
        size="sm"
        @close="picker.closeTocOptions()"
    >
        <TocOptionsForm
            :initial="initial"
            @apply="apply"
            @cancel="picker.closeTocOptions()"
        />
    </BaseModal>
</template>

<script setup>
// The desktop Options dialog for a table of contents; the phone uses ?sheet=toc.
import { computed } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import TocOptionsForm from '@/components/TocOptionsForm.vue'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { useTableOfContentsStore } from '@/store/tableOfContentsStore'
import { useViewport } from '@/composables/useViewport'

const picker = useLinkPickerStore()
const tocStore = useTableOfContentsStore()
const { isPhone } = useViewport()

const initial = computed(() => (picker.tocOptionsOpen ? tocStore.optionsFor(picker.tocOptionsIndex) : null))

async function apply(options) {
    picker.closeTocOptions()
    await tocStore.applyOptions(picker.tocOptionsIndex, options)
}
</script>
