<template>
    <BottomSheet
        :open="open"
        label="Sort notes"
        testid="phone-sort-sheet"
        @close="$emit('close')"
    >
        <template #header>
            <h2 class="ph-sort-title">Sort notes</h2>
        </template>
        <div class="ph-sort-body">
            <SortControls />
            <p class="ph-muted ph-sort-note">Applies to Home and to every folder. Pinned notes stay at the top.</p>
        </div>
    </BottomSheet>
</template>

<script setup>
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SortControls from '@/components/phone/SortControls.vue'

defineProps({
    open: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<style scoped>
.ph-sort-title {
    padding: 0 8px;
    font-family: var(--ph-serif);
    font-size: 22px;
    font-weight: 700;
}

.ph-sort-body {
    padding: 4px 20px 24px;
}

.ph-sort-note {
    margin-top: 8px;
    font-size: 13px;
}
</style>
