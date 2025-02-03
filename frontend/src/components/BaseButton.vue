<!-- /Users/kris/Development/MarkdownNotes/pn-markdown-notes/pn-markdown-notes/frontend/src/components/BaseButton.vue -->
<template>
    <!-- 
      We bind all incoming attributes/events (e.g. @click) via useAttrs().
      That means if you do <BaseButton @click="foo">, the click is passed through.
    -->
    <button :class="computedClasses" v-bind="buttonAttrs">
        <slot />
    </button>
</template>

<script setup>
import { computed, useAttrs } from 'vue'

const props = defineProps({
    /**
     * When true, visually indicates an active or "pressed" state.
     */
    isActive: { type: Boolean, default: false },
})

/**
 * "useAttrs()" returns an object of all attributes passed to this
 * component, including event listeners like @click. We spread them
 * on the <button> to avoid the old Vue 2 usage of $attrs/$listeners.
 */
const buttonAttrs = useAttrs()

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