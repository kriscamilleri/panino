<template>
    <PhoneShell v-if="isPhone">
        <div
            class="ph-folders"
            data-testid="phone-all-folders"
        >
            <header class="ph-folders-top">
                <button
                    type="button"
                    class="ph-icon-btn"
                    aria-label="Back"
                    data-testid="phone-folders-back"
                    @click="goBack"
                >
                    <ArrowLeft
                        class="h-6 w-6"
                        aria-hidden="true"
                    />
                </button>
                <h1 class="ph-display">Folders</h1>
            </header>
            <div class="ph-folders-tabs">
                <SegmentedControl
                    :model-value="tab"
                    label="Folders to show"
                    testid-prefix="phone-folders-tab"
                    :options="TAB_OPTIONS"
                    @update:model-value="setTab"
                />
            </div>

            <main class="ph-folders-list">
                <template v-if="tab === 'mine'">
                    <SwipeRow
                        v-for="folder in topFolders"
                        :key="folder.id"
                        :actions-label="`Actions for ${folder.name}`"
                        :testid="`phone-folders-row-${folder.id}`"
                    >
                        <button
                            type="button"
                            class="ph-row"
                            @click="openFolder(folder.id, folder.dbKey)"
                        >
                            <Folder
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-folders-name">{{ folder.name }}</span>
                            <span
                                v-if="childCount(folder.id)"
                                class="ph-muted"
                            >{{ childCount(folder.id) }}</span>
                        </button>
                        <template #actions="{ close, tabindex }">
                            <button
                                type="button"
                                class="ph-swipe-btn"
                                :tabindex="tabindex"
                                @click="close(); startRename(folder)"
                            >
                                <Pencil
                                    class="h-5 w-5"
                                    aria-hidden="true"
                                />
                                Rename
                            </button>
                            <button
                                type="button"
                                class="ph-swipe-btn ph-swipe-danger"
                                :tabindex="tabindex"
                                @click="close(); confirmDelete(folder)"
                            >
                                <Trash2
                                    class="h-5 w-5"
                                    aria-hidden="true"
                                />
                                Delete
                            </button>
                        </template>
                    </SwipeRow>
                    <p
                        v-if="loaded && !topFolders.length"
                        class="ph-muted ph-folders-empty"
                    >No folders yet. Notes you take without one are on Home.</p>
                </template>

                <template v-else>
                    <button
                        v-for="space in spaces"
                        :key="space.dbKey"
                        type="button"
                        class="ph-row ph-folders-space"
                        :data-testid="`phone-folders-space-${space.dbKey}`"
                        @click="openFolder(space.dbKey, space.dbKey)"
                    >
                        <Users
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span class="ph-folders-name">{{ space.name }}</span>
                        <span class="ph-muted">{{ space.role === 'owner' ? 'Owner' : 'Can edit' }}</span>
                    </button>
                    <p
                        v-if="!spaces.length"
                        class="ph-muted ph-folders-empty"
                    >Nothing is shared with you yet.</p>
                    <button
                        v-if="syncStore.sharedSpacesAvailable"
                        type="button"
                        class="ph-row ph-folders-manage"
                        @click="router.push({ name: 'spaces' })"
                    >
                        <Settings2
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        Manage spaces
                    </button>
                </template>
            </main>

            <button
                v-if="tab === 'mine'"
                type="button"
                class="ph-folders-fab"
                data-testid="phone-folders-new"
                @click="promptingFolder = true"
            >
                <FolderPlus
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                New
            </button>

            <PromptModal
                :show="promptingFolder"
                v-model="newFolderName"
                title="New folder"
                label="Folder name"
                @confirm="createFolder"
                @cancel="promptingFolder = false"
            />
            <PromptModal
                :show="Boolean(renaming)"
                v-model="renameValue"
                title="Rename folder"
                label="Folder name"
                confirm-label="Rename"
                @confirm="rename"
                @cancel="renaming = null"
            />
            <BaseModal
                :show="Boolean(deleting)"
                title="Delete this folder?"
                size="sm"
                @close="deleting = null"
            >
                <p>“{{ deleting?.name }}”, its subfolders and every Document in them are deleted on every device. This cannot be undone.</p>
                <template #footer>
                    <BaseButton
                        variant="secondary"
                        @click="deleting = null"
                    >Cancel</BaseButton>
                    <BaseButton
                        variant="danger"
                        @click="deleteFolder"
                    >Delete</BaseButton>
                </template>
            </BaseModal>
        </div>
    </PhoneShell>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Folder, FolderPlus, Users, Pencil, Trash2, Settings2 } from 'lucide-vue-next'
import PhoneShell from '@/components/phone/PhoneShell.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import SwipeRow from '@/components/phone/SwipeRow.vue'
import PromptModal from '@/components/PromptModal.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useViewport } from '@/composables/useViewport'

const TAB_OPTIONS = [
    { value: 'mine', label: 'My folders' },
    { value: 'shared', label: 'Shared with me' },
]

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { isPhone } = useViewport()

const folders = ref([])
const loaded = ref(false)
const promptingFolder = ref(false)
const newFolderName = ref('')
const renaming = ref(null)
const renameValue = ref('')
const deleting = ref(null)

const tab = computed(() => (route.query.tab === 'shared' ? 'shared' : 'mine'))
const topFolders = computed(() => folders.value
    .filter((folder) => !folder.parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
const spaces = computed(() => [...syncStore.databases.values()]
    .filter((entry) => entry.kind === 'space')
    .sort((a, b) => String(a.name).localeCompare(String(b.name))))

const childCount = (folderId) => folders.value.filter((folder) => folder.parentId === folderId).length

watch(isPhone, (phone) => { if (!phone) router.replace({ name: 'home' }) }, { immediate: true })

watch(() => [syncStore.isInitialized, docStore.contentVersion], async () => {
    if (!syncStore.isInitialized || !syncStore.personalDbKey) return
    try {
        folders.value = await docStore.listFolders(syncStore.personalDbKey)
    } catch (error) {
        console.warn('[PhoneAllFolders] Could not load folders:', error)
    } finally {
        loaded.value = true
    }
}, { immediate: true })

function setTab(value) {
    router.replace({ query: { ...route.query, tab: value === 'shared' ? 'shared' : undefined } })
}

function openFolder(folderId, dbKey) {
    router.push({ name: 'folder', params: { folderId }, query: { dbKey } })
}

function goBack() {
    if (window.history.state?.back) router.back()
    else router.replace({ name: 'home', query: { sheet: 'drawer' } })
}

async function createFolder() {
    const name = newFolderName.value.trim()
    if (!name) return
    promptingFolder.value = false
    newFolderName.value = ''
    try {
        const created = await docStore.createFolder(syncStore.personalDbKey, name, null)
        openFolder(created.id, created.dbKey)
    } catch (error) {
        console.error('[PhoneAllFolders] Folder creation failed:', error)
        ui.addToast('The folder could not be created. Try again.', 'error')
    }
}

function startRename(folder) {
    renaming.value = folder
    renameValue.value = folder.name
}

async function rename() {
    const folder = renaming.value
    const name = renameValue.value.trim()
    renaming.value = null
    if (!folder || !name || name === folder.name) return
    try {
        await docStore.renameItem(folder.id, name, 'folder', folder.dbKey)
    } catch (error) {
        console.error('[PhoneAllFolders] Rename failed:', error)
        ui.addToast('The folder could not be renamed. Try again.', 'error')
    }
}

function confirmDelete(folder) {
    deleting.value = folder
}

async function deleteFolder() {
    const folder = deleting.value
    deleting.value = null
    if (!folder) return
    try {
        await docStore.deleteItem(folder.id, 'folder', folder.dbKey)
        ui.addToast('Folder deleted.', 'success', 2500)
    } catch (error) {
        console.error('[PhoneAllFolders] Delete failed:', error)
        ui.addToast('The folder could not be deleted. Try again.', 'error')
    }
}
</script>

<style scoped>
.ph-folders {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-surface);
}

.ph-folders-top {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(8px + env(safe-area-inset-top)) 8px 0;
}

.ph-folders-tabs {
    padding: 8px 16px;
}

.ph-folders-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 96px;
}

.ph-folders-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-folders-space {
    border-bottom: 1px solid var(--ph-line);
}

.ph-folders-empty {
    padding: 32px 24px;
    text-align: center;
}

.ph-folders-manage {
    color: var(--ph-accent);
}

.ph-swipe-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 84px;
    border: 0;
    background: var(--ph-ink-2);
    color: var(--ph-surface);
    font-size: 12px;
    font-weight: 600;
}

.ph-swipe-danger {
    background: var(--ph-danger);
}

.ph-folders-fab {
    position: absolute;
    right: 16px;
    bottom: calc(20px + var(--ph-safe-bottom));
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 0 22px;
    border: 0;
    border-radius: var(--ph-fab-radius);
    background: var(--ph-accent);
    color: var(--ph-accent-ink);
    font-size: 16px;
    font-weight: 600;
    box-shadow: var(--ph-shadow);
}
</style>
