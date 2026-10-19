<template>
    <div class="ph-sort-controls">
        <p class="ph-section-label">Sort by</p>
        <SegmentedControl
            :model-value="sort.field"
            label="Sort by"
            testid-prefix="phone-sort-field"
            :options="FIELD_OPTIONS"
            @update:model-value="(field) => choose({ field, direction: sort.direction })"
        />
        <p class="ph-section-label">Order</p>
        <SegmentedControl
            :model-value="sort.direction"
            label="Order"
            testid-prefix="phone-sort-direction"
            :options="directionOptions"
            @update:model-value="(direction) => choose({ field: sort.field, direction })"
        />
    </div>
</template>

<script setup>
import { computed } from 'vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import { useUiStore } from '@/store/uiStore'
import { normalizeSort } from '@/utils/homeView'

const FIELD_OPTIONS = [
    { value: 'modified', label: 'Modified' },
    { value: 'created', label: 'Created' },
    { value: 'title', label: 'Title' },
]

const ui = useUiStore()
const sort = computed(() => normalizeSort(ui.noteSort))

/** The order's words follow the field: dates are newest/oldest, titles A–Z/Z–A. */
const directionOptions = computed(() => (sort.value.field === 'title'
    ? [{ value: 'asc', label: 'A to Z' }, { value: 'desc', label: 'Z to A' }]
    : [{ value: 'desc', label: 'Newest first' }, { value: 'asc', label: 'Oldest first' }]))

function choose(next) {
    // A new field starts at its natural order: Title A to Z, dates newest first.
    const fieldChanged = next.field !== sort.value.field
    const direction = fieldChanged ? (next.field === 'title' ? 'asc' : 'desc') : next.direction
    ui.setNoteSort({ field: next.field, direction })
}
</script>

<style scoped>
.ph-sort-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ph-sort-controls .ph-section-label + * {
    margin-bottom: 6px;
}
</style>
