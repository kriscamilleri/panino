<template>
    <button
        type="button"
        class="ph-sort-button"
        :aria-label="`Sort: ${label.field}, ${label.direction}. Change sorting`"
        data-testid="phone-sort-button"
        @click="openSheet('sort')"
    >
        <ArrowDownUp
            class="h-4 w-4"
            aria-hidden="true"
        />
        <span>{{ label.short }}</span>
    </button>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowDownUp } from 'lucide-vue-next'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { describeSort } from '@/utils/homeView'

const ui = useUiStore()
const { openSheet } = useSheetRoute()
const label = computed(() => describeSort(ui.noteSort))
</script>

<style scoped>
.ph-sort-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: 17px;
    background: transparent;
    color: var(--ph-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
}

/* 34px to look at; the tap area still reaches 44px. */
.ph-sort-button::after {
    content: '';
    position: absolute;
    inset: -5px 0;
}
</style>
