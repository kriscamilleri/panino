<!-- /Users/kris/Development/MarkdownNotes/pn-markdown-notes/pn-markdown-notes/frontend/src/components/BaseButton.vue -->
<template>
    <!--
            We bind all incoming attributes/events (e.g. @click) via useAttrs().
            That means if you do <BaseButton @click="foo">, the click is passed through.
            Also pass through data-testid if provided.
        -->
    <component :is="elementType" :class="computedClasses" v-bind="buttonAttrs">
        <slot />
    </component>
</template>

<script setup>
import { computed, useAttrs } from 'vue'

const props = defineProps({
    /**
     * When true, visually indicates an active or "pressed" state.
     */
    isActive: { type: Boolean, default: false },
    /**
     * The HTML element type to render (button or a)
     */
    as: { type: String, default: 'button' },
})

/**
 * "useAttrs()" returns an object of all attributes passed to this
 * component, including event listeners like @click. We spread them
 * on the <button> to avoid the old Vue 2 usage of $attrs/$listeners.
 */
const buttonAttrs = useAttrs()

const elementType = computed(() => props.as)

const computedClasses = computed(() => {
    // useAttrs() returns attributes; disabled may be present here.
    const isDisabled = Boolean(buttonAttrs.disabled)
    // Base classes for button
    let base = 'px-3 py-1.5 text-sm font-medium text-gray-700 rounded flex items-center space-x-1 transition'

    // Apply hover only when not disabled
    if (!isDisabled) base += ' hover:bg-gray-200'

    if (props.isActive) {
        base += ' bg-gray-200'
    }

    // Visual affordance for disabled
    if (isDisabled) {
        base += ' opacity-50 cursor-not-allowed'
    }

    return base
})
</script>
