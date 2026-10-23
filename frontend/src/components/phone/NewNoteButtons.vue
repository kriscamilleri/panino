<template>
    <div
        class="ph-new-buttons"
        data-testid="phone-new-buttons"
    >
        <button
            type="button"
            class="ph-new-template"
            aria-label="New note from template"
            data-testid="phone-new-template"
            @click="$emit('template')"
        >
            <LayoutTemplate
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
        <button
            type="button"
            class="ph-new-note"
            aria-label="New note"
            data-testid="phone-new-note"
            @click="$emit('note')"
        >
            <Plus
                class="h-7 w-7"
                aria-hidden="true"
            />
        </button>
    </div>
</template>

<script setup>
import { LayoutTemplate, Plus } from 'lucide-vue-next'

defineEmits(['note', 'template'])
</script>

<style scoped>
.ph-new-buttons {
    position: absolute;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
}

.ph-new-template,
.ph-new-note {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    box-shadow: var(--ph-shadow);
}

.ph-new-template {
    width: 48px;
    height: 48px;
    border: 1px solid var(--ph-line);
    background: var(--ph-surface);
    color: var(--ph-ink);
}

.ph-new-note {
    width: 56px;
    height: 56px;
    border: 0;
    background: var(--ph-accent);
    color: var(--ph-accent-ink);
}
</style>
