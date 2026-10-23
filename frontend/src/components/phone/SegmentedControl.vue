<template>
    <div
        class="ph-segmented"
        role="group"
        :aria-label="label"
    >
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="ph-segment"
            :aria-pressed="modelValue === option.value"
            :data-testid="testidPrefix ? `${testidPrefix}-${option.value}` : undefined"
            @click="$emit('update:modelValue', option.value)"
        >
            <component
                :is="option.icon"
                v-if="option.icon"
                class="h-4 w-4"
                aria-hidden="true"
            />
            {{ option.label }}
        </button>
    </div>
</template>

<script setup>
defineProps({
    modelValue: { type: String, default: '' },
    /** `[{ value, label, icon? }]` */
    options: { type: Array, required: true },
    /** Accessible name of the group. */
    label: { type: String, required: true },
    testidPrefix: { type: String, default: '' },
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.ph-segmented {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: var(--ph-canvas);
    border: 1px solid var(--ph-line);
}

.ph-segment {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ph-muted);
    font-size: 15px;
    font-weight: 600;
}

.ph-segment[aria-pressed='true'] {
    background: var(--ph-surface);
    color: var(--ph-ink);
    box-shadow: var(--ph-shadow);
}
</style>
