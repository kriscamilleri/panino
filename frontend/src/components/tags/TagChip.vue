<template>
    <component
        :is="clickable ? 'button' : 'span'"
        :type="clickable ? 'button' : undefined"
        class="pn-tag-chip"
        :class="[`pn-tag-chip-${size}`, { 'pn-tag-chip-button': clickable }]"
        :style="colors"
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
 * One tag: a rounded rectangle (never a circle — people are circles) with a
 * pastel fill, a soft border and a `#` glyph in the tag's ink, and the name in
 * the normal text colour, as text only. Colours come from the palette by
 * `colorKey` (`tagColorStyle`, unknown keys draw neutral), in both themes.
 */
import { computed } from 'vue'
import { tagColorStyle } from '@/utils/tagPalette'

const props = defineProps({
    name: { type: String, required: true },
    label: { type: String, required: true },
    // Kept for callers that pass it; the colours come from colorKey.
    hex: { type: String, default: '' },
    colorKey: { type: String, default: 'neutral' },
    size: { type: String, default: 'sm', validator: (value) => ['xs', 'sm'].includes(value) },
    clickable: { type: Boolean, default: false },
    title: { type: String, default: '' },
})

const colors = computed(() => tagColorStyle(props.colorKey))
</script>

<style scoped>
.pn-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    max-width: 8rem;
    --chip-fill: var(--tag-fill);
    --chip-ink: var(--tag-ink);
    border: 1px solid color-mix(in srgb, var(--chip-ink) 55%, var(--chip-fill));
    border-radius: 0.375rem;
    background: var(--chip-fill);
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
    color: var(--chip-ink);
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
    background: color-mix(in srgb, var(--chip-ink) 18%, var(--chip-fill));
}

.pn-tag-chip-button:focus-visible {
    outline: 2px solid #6b7280;
    outline-offset: 1px;
}

/* Dark mode: the rule lives in main.css (`html[data-theme='dark'] .pn-tag-chip`);
   Vue's scoped :global() would drop the `.pn-tag-chip` part of the selector. */
</style>
