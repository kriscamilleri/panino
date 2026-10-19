<template>
    <BottomSheet
        :open="open && Boolean(file)"
        label="Document options"
        testid="phone-document-menu"
        @close="$emit('close')"
    >
        <template #header>
            <div class="ph-menu-head">
                <h2 class="ph-menu-title">{{ file?.title || 'Untitled' }}</h2>
                <p class="ph-muted ph-menu-meta">
                    {{ folderLabel }} · {{ wordCount }} {{ wordCount === 1 ? 'word' : 'words' }}
                </p>
            </div>
        </template>

        <div class="ph-menu-status ph-card">
            <div class="ph-menu-status-row">
                <span
                    class="ph-sync-dot"
                    :data-state="sync.state"
                    aria-hidden="true"
                ></span>
                <div class="ph-menu-status-text">
                    <p>{{ sync.label }}</p>
                    <p
                        v-if="sync.error"
                        class="ph-muted"
                        data-testid="phone-menu-sync-error"
                    >{{ sync.error }}</p>
                </div>
                <button
                    type="button"
                    class="ph-btn"
                    :disabled="!syncStore.isOnline || !syncStore.syncEnabled || syncStore.isSyncing"
                    data-testid="phone-menu-sync-now"
                    @click="syncNow"
                >Sync now</button>
            </div>
            <div
                v-if="isSpaceDocument"
                class="ph-menu-status-row"
            >
                <Users
                    class="h-5 w-5 ph-muted"
                    aria-hidden="true"
                />
                <div class="ph-menu-status-text">
                    <p data-testid="phone-menu-collab-state">{{ collabLabel }}</p>
                </div>
                <button
                    type="button"
                    class="ph-btn"
                    data-testid="phone-menu-collaborate"
                    @click="openSheet('collaborate')"
                >Collaborate</button>
            </div>
        </div>

        <nav
            class="ph-menu-actions"
            aria-label="Document actions"
        >
            <button
                type="button"
                class="ph-row"
                data-testid="phone-menu-pin"
                @click="togglePin"
            >
                <Pin
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                {{ isPinned ? 'Unpin' : 'Pin to top' }}
            </button>
            <button
                type="button"
                class="ph-row"
                data-testid="phone-menu-move"
                @click="openSheet('move')"
            >
                <FolderInput
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                Move to folder
            </button>
            <button
                type="button"
                class="ph-row"
                data-testid="phone-menu-styles"
                @click="go('/styles')"
            >
                <Palette
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                Styles
            </button>
            <button
                type="button"
                class="ph-row"
                :disabled="!syncStore.isOnline"
                data-testid="phone-menu-export"
                @click="openSheet('export')"
            >
                <FileDown
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                {{ syncStore.isOnline ? 'Export as PDF' : 'Export as PDF (needs a connection)' }}
            </button>
            <button
                type="button"
                class="ph-row"
                :disabled="!syncStore.isOnline"
                data-testid="phone-menu-revisions"
                @click="go('/revisions')"
            >
                <History
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                {{ syncStore.isOnline ? 'Revision history' : 'Revision history (needs a connection)' }}
            </button>
            <div class="ph-menu-appearance">
                <p
                    id="ph-menu-appearance-label"
                    class="ph-section-label"
                >Appearance</p>
                <SegmentedControl
                    :model-value="themeStore.preference"
                    label="Appearance"
                    testid-prefix="phone-menu-appearance"
                    :options="APPEARANCE_OPTIONS"
                    @update:model-value="themeStore.setPreference"
                />
            </div>
            <hr class="ph-menu-divider">
            <button
                type="button"
                class="ph-row ph-row-danger"
                data-testid="phone-menu-delete"
                @click="confirmingDelete = true"
            >
                <Trash2
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                Delete Document
            </button>
        </nav>

        <BaseModal
            :show="confirmingDelete"
            title="Delete this Document?"
            size="sm"
            @close="confirmingDelete = false"
        >
            <p>“{{ file?.title || 'Untitled' }}” is deleted on every device it syncs to. This cannot be undone.</p>
            <template #footer>
                <BaseButton
                    variant="secondary"
                    @click="confirmingDelete = false"
                >Cancel</BaseButton>
                <BaseButton
                    variant="danger"
                    data-testid="phone-menu-delete-confirm"
                    @click="deleteDocument"
                >Delete</BaseButton>
            </template>
        </BaseModal>
    </BottomSheet>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Pin, FolderInput, Palette, FileDown, History, Trash2, Users, Monitor, Sun, Moon } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useSyncStore } from '@/store/syncStore'
import { useThemeStore } from '@/store/themeStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { usePhoneStatus } from '@/composables/usePhoneStatus'
import { normalizePinned } from '@/utils/recentDocuments'

const APPEARANCE_OPTIONS = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
]

defineProps({
    open: { type: Boolean, default: false },
    folderLabel: { type: String, default: '' },
})
defineEmits(['close'])

const router = useRouter()
const docStore = useDocStore()
const draftStore = useDraftStore()
const syncStore = useSyncStore()
const themeStore = useThemeStore()
const ui = useUiStore()
const { openSheet, closeSheetAndGo } = useSheetRoute()
const { sync, liveParticipants, syncNow } = usePhoneStatus()
const { selectedFile: file } = storeToRefs(docStore)

const confirmingDelete = ref(false)

const isSpaceDocument = computed(() => Boolean(file.value?.dbKey?.startsWith('space:')))
const isPinned = computed(() => normalizePinned(file.value?.pinned))
const wordCount = computed(() => {
    const text = (file.value && draftStore.getDraft(file.value.id)) ?? file.value?.content ?? ''
    return (String(text).trim().match(/\S+/g) || []).length
})
const collabLabel = computed(() => {
    const count = liveParticipants(file.value?.id).length
    return count ? `Live · ${count} editing` : 'Solo editing'
})

async function togglePin() {
    if (!file.value) return
    const next = !isPinned.value
    try {
        await docStore.setDocumentPinned(file.value.id, next, file.value.dbKey)
        ui.addToast(next ? 'Pinned to the top of Home.' : 'Unpinned.', 'success', 2500)
    } catch (error) {
        console.error('[DocumentMenuSheet] Pin failed:', error)
        ui.addToast('The pin could not be changed. Try again.', 'error')
    }
}

/** Leave the sheet for a full screen in one history step. */
function go(path) {
    closeSheetAndGo(path)
}

async function deleteDocument() {
    const target = file.value
    if (!target) return
    confirmingDelete.value = false
    try {
        await docStore.deleteItem(target.id, 'file', target.dbKey)
        ui.addToast('Document deleted.', 'success', 2500)
        await router.replace(target.folder_id
            ? { name: 'folder', params: { folderId: target.folder_id }, query: { dbKey: target.dbKey } }
            : { name: 'home' })
    } catch (error) {
        console.error('[DocumentMenuSheet] Delete failed:', error)
        ui.addToast('The Document could not be deleted. Try again.', 'error')
    }
}
</script>

<style scoped>
.ph-menu-head {
    padding: 0 8px;
}

.ph-menu-title {
    font-family: var(--ph-serif);
    font-size: 22px;
    font-weight: 700;
    line-height: 1.25;
}

.ph-menu-meta {
    font-size: 14px;
    margin-top: 2px;
}

.ph-menu-status {
    margin: 4px 16px 8px;
    padding: 4px 0;
}

.ph-menu-status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
}

.ph-menu-status-row + .ph-menu-status-row {
    border-top: 1px solid var(--ph-line);
}

.ph-menu-status-text {
    flex: 1;
    min-width: 0;
    font-size: 15px;
}

.ph-menu-status-text .ph-muted {
    font-size: 13px;
}

.ph-menu-actions {
    padding-bottom: 12px;
}

.ph-menu-appearance {
    padding: 12px 20px 8px;
}

.ph-menu-appearance .ph-section-label {
    margin-bottom: 8px;
}

.ph-menu-divider {
    margin: 8px 20px;
    border: 0;
    border-top: 1px solid var(--ph-line);
}
</style>
