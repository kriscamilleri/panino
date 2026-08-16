<!-- frontend/src/components/DocumentPinButton.vue -->
<template>
    <!--
        A real button, never a click handler on the SVG: pin state has to be
        reachable and announceable on its own. `.stop` keeps activation from
        bubbling into the card/row's open handler.
    -->
    <button
        type="button"
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
        :class="{ 'text-gray-800': isPinned }"
        :aria-pressed="isPinned"
        :aria-label="accessibleName"
        :title="accessibleName"
        :data-testid="`document-pin-toggle-${documentId}`"
        @click.stop="$emit('toggle')"
        @keydown.enter.stop
        @keydown.space.stop
    >
        <!-- Fill, not colour, carries the state. -->
        <Star
            class="h-4 w-4"
            :fill="isPinned ? 'currentColor' : 'none'"
            aria-hidden="true"
        />
    </button>
</template>

<script setup>
import { computed } from 'vue'
import { Star } from 'lucide-vue-next'

const props = defineProps({
    documentId: { type: String, required: true },
    documentName: { type: String, default: '' },
    isPinned: { type: Boolean, default: false },
})

defineEmits(['toggle'])

const accessibleName = computed(
    () => `${props.isPinned ? 'Unpin' : 'Pin'} ${props.documentName || 'document'}`
)
</script>
