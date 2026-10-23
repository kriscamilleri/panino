<template>
    <div
        class="ph-selection-bar"
        role="toolbar"
        aria-label="Selected notes"
        data-testid="phone-selection-bar"
    >
        <button
            type="button"
            class="ph-icon-btn"
            aria-label="Clear selection"
            data-testid="phone-selection-clear"
            @click="selection.clear()"
        >
            <X
                class="h-6 w-6"
                aria-hidden="true"
            />
        </button>
        <p
            class="ph-selection-count"
            aria-live="polite"
        >{{ selection.count.value }} selected</p>
        <button
            type="button"
            class="ph-icon-btn"
            :aria-label="allPinned ? 'Unpin selected' : 'Pin selected'"
            data-testid="phone-selection-pin"
            @click="togglePin"
        >
            <component
                :is="allPinned ? PinOff : Pin"
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
        <button
            type="button"
            class="ph-icon-btn"
            :disabled="!selection.singleDatabase.value"
            :aria-label="selection.singleDatabase.value ? 'Move selected' : 'Move selected (notes from different spaces cannot move together)'"
            data-testid="phone-selection-move"
            @click="$emit('move')"
        >
            <FolderInput
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
        <button
            type="button"
            class="ph-icon-btn ph-danger-text"
            aria-label="Delete selected"
            data-testid="phone-selection-delete"
            @click="confirming = true"
        >
            <Trash2
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>

        <BaseModal
            :show="confirming"
            :title="`Delete ${selection.count.value} ${selection.count.value === 1 ? 'Document' : 'Documents'}?`"
            size="sm"
            @close="confirming = false"
        >
            <p>They are deleted on every device they sync to. This cannot be undone.</p>
            <template #footer>
                <BaseButton
                    variant="secondary"
                    @click="confirming = false"
                >Cancel</BaseButton>
                <BaseButton
                    variant="danger"
                    data-testid="phone-selection-delete-confirm"
                    @click="deleteSelected"
                >Delete</BaseButton>
            </template>
        </BaseModal>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { X, Pin, PinOff, FolderInput, Trash2 } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { usePhoneSelection } from '@/composables/usePhoneSelection'

defineEmits(['move'])

const docStore = useDocStore()
const ui = useUiStore()
const selection = usePhoneSelection()
const confirming = ref(false)

const allPinned = computed(() => selection.items.value.every((doc) => doc.isPinned))

async function togglePin() {
    const pinned = !allPinned.value
    try {
        for (const doc of selection.items.value) {
            if (doc.isPinned !== pinned) await docStore.setDocumentPinned(doc.id, pinned, doc.dbKey)
        }
        selection.clear()
    } catch (error) {
        console.error('[SelectionBar] Pin failed:', error)
        ui.addToast('Some notes could not be pinned. Try again.', 'error')
    }
}

async function deleteSelected() {
    confirming.value = false
    const targets = selection.items.value
    let failed = 0
    for (const doc of targets) {
        try {
            await docStore.deleteItem(doc.id, 'file', doc.dbKey)
        } catch (error) {
            failed += 1
            console.error('[SelectionBar] Delete failed:', error)
        }
    }
    selection.clear()
    if (failed) ui.addToast(`${failed} could not be deleted. Try again.`, 'error')
    else ui.addToast(`${targets.length} deleted.`, 'success', 2500)
}
</script>

<style scoped>
.ph-selection-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 52px;
    padding: 0 4px;
    border-radius: 9999px;
    background: var(--ph-accent-soft);
    color: var(--ph-ink);
}

.ph-selection-count {
    flex: 1;
    font-size: 16px;
    font-weight: 600;
}
</style>
