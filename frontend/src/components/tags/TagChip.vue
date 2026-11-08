<template>
    <component
        :is="clickable ? 'button' : 'span'"
        :type="clickable ? 'button' : undefined"
        class="pn-tag-chip"
        :class="[`pn-tag-chip-${size}`, { 'pn-tag-chip-button': clickable }]"
        :style="{ '--tag-color': hex }"
        :title="title || undefined"
        :data-tag="name"
        :data-tag-color="colorKey"
    >
        <span
            class="pn-tag-chip-glyph"
            aria-hidden="true"
        >#</span>
        <span class="pn-tag-chip-label">{{ label }}</span>
        <slot />
    </component>
</template>

<script setup>
/**
 * One tag: a rounded rectangle (never a circle — people are circles), a 1 px
 * border and a faint tint in the tag's colour, a `#` glyph in that colour and
 * the name in the normal text colour, as text only. `hex` must come from the
 * palette (`tagColorHex`), never from stored data.
 */
defineProps({
    name: { type: String, required: true },
    label: { type: String, required: true },
    hex: { type: String, required: true },
    colorKey: { type: String, default: 'neutral' },
    size: { type: String, default: 'sm', validator: (value) => ['xs', 'sm'].includes(value) },
    clickable: { type: Boolean, default: false },
    title: { type: String, default: '' },
})
</script>

<style scoped>
.pn-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    max-width: 8rem;
    border: 1px solid var(--tag-color);
    border-radius: 0.375rem;
    background: color-mix(in srgb, var(--tag-color) 12%, transparent);
    color: inherit;
    line-height: 1.2;
    white-space: nowrap;
    flex-shrink: 0;
}

.pn-tag-chip-xs {
    padding: 0 4px;
    font-size: 11px;
}

.pn-tag-chip-sm {
    padding: 1px 6px;
    font-size: 12px;
}

.pn-tag-chip-glyph {
    color: var(--tag-color);
    font-weight: 700;
}

.pn-tag-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.pn-tag-chip-button {
    cursor: pointer;
}

.pn-tag-chip-button:hover {
    background: color-mix(in srgb, var(--tag-color) 22%, transparent);
}

.pn-tag-chip-button:focus-visible {
    outline: 2px solid #6b7280;
    outline-offset: 1px;
}
</style>
