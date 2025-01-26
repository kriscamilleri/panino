<template>
    <button :class="computedClasses" v-bind="$attrs" v-on="$listeners">
        <slot />
    </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
    /**
     * When true, visually indicates an active or "pressed" state.
     */
    isActive: { type: Boolean, default: false }
})

/**
 * We set a base style. If isActive is true, we add a background
 * so that it appears toggled on.
 */
const computedClasses = computed(() => {
    let base =
        'px-2 py-1 text-gray-700 hover:bg-gray-200 rounded ' +
        'flex items-center space-x-1 transition'

    if (props.isActive) {
        base += ' bg-gray-200'
    }

    return base
})
</script>