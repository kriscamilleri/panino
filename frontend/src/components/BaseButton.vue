<template>
    <!--
        Every button in the app funnels through here so size, radius, gap and
        focus treatment stay identical. Icons are laid out by `gap`, so slot
        content should be a bare icon plus a <span> — never an icon carrying
        its own margin.
    -->
    <component
        :is="elementType"
        :class="computedClasses"
        v-bind="buttonAttrs"
    >
        <slot />
    </component>
</template>

<script setup>
import { computed, useAttrs } from 'vue'

const props = defineProps({
    /**
     * Visual weight.
     *  - primary   one per view: the action the user came to perform
     *  - secondary the paired escape hatch (Cancel / Back / Done)
     *  - ghost     toolbar and table-row actions; no chrome until hover
     *  - danger    destructive, still reversible-looking
     */
    variant: {
        type: String,
        default: 'ghost',
        validator: (v) => ['primary', 'secondary', 'ghost', 'danger'].includes(v),
    },
    /** `md` for dialog and form actions, `sm` for toolbars and table rows. */
    size: {
        type: String,
        default: 'sm',
        validator: (v) => ['sm', 'md'].includes(v),
    },
    /** Visually indicates an active or "pressed" state (toolbar toggles). */
    isActive: { type: Boolean, default: false },
    /** Square padding for buttons whose only child is an icon. */
    iconOnly: { type: Boolean, default: false },
    /** The HTML element type to render (button or a). */
    as: { type: String, default: 'button' },
})

const buttonAttrs = useAttrs()

const elementType = computed(() => props.as)

const SIZES = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
}

const ICON_SIZES = {
    sm: 'p-1.5',
    md: 'p-2',
}

const VARIANTS = {
    primary: 'border border-transparent bg-gray-800 text-white hover:bg-gray-900',
    secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    ghost: 'border border-transparent text-gray-700 hover:bg-gray-200',
    // Deliberately the same weight as `ghost`: destructive actions sit beside
    // neutral ones in table rows, and a bordered box would out-shout them.
    danger: 'border border-transparent text-red-600 hover:bg-red-50 hover:text-red-700',
}

const ACTIVE = {
    primary: 'bg-gray-900',
    secondary: 'bg-gray-100',
    ghost: 'bg-gray-200',
    danger: 'bg-red-50',
}

const computedClasses = computed(() => {
    const variant = VARIANTS[props.variant] ? props.variant : 'ghost'
    const classes = [
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
        props.iconOnly ? ICON_SIZES[props.size] : SIZES[props.size],
        VARIANTS[variant],
    ]

    if (props.isActive) classes.push(ACTIVE[variant])

    return classes.join(' ')
})
</script>
