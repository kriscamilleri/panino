<template>
    <BottomSheet
        :open="open && items.length > 0"
        label="Move to"
        tall
        testid="phone-move-sheet"
        @close="$emit('close')"
    >
        <template #header>
            <div class="ph-move-head">
                <h2 class="ph-move-title">Move to</h2>
                <p
                    class="ph-muted"
                    data-testid="phone-move-current"
                >{{ currentLine }}</p>
            </div>
        </template>

        <div class="ph-move-search">
            <label
                class="sr-only"
                for="ph-move-find"
            >Find a folder</label>
            <input
                id="ph-move-find"
                v-model="findText"
                class="ph-input"
                type="search"
                placeholder="Find a folder"
                autocomplete="off"
                data-testid="phone-move-find"
            >
        </div>

        <template v-if="!findText.trim() && parentId === null">
            <p class="ph-section-label ph-move-label">Suggested</p>
            <ul>
                <li
                    v-for="option in suggestions"
                    :key="option.key"
                >
                    <button
                        type="button"
                        class="ph-row"
                        :disabled="option.current"
                        :data-testid="`phone-move-suggested-${option.key}`"
                        @click="moveTo(option.folderId, option.label)"
                    >
                        <component
                            :is="option.folderId ? Folder : FolderMinus"
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span class="ph-move-name">{{ option.label }}</span>
                        <span
                            v-if="option.current"
                            class="ph-folder-chip"
                        >Current</span>
                    </button>
                </li>
            </ul>
        </template>

        <div class="ph-move-label-row">
            <button
                v-if="parentId !== null && !findText.trim()"
                type="button"
                class="ph-icon-btn"
                aria-label="Up one folder"
                data-testid="phone-move-up"
                @click="parentId = parentOf(parentId)"
            >
                <ChevronLeft
                    class="h-5 w-5"
                    aria-hidden="true"
                />
            </button>
            <p class="ph-section-label ph-move-label">{{ listHeading }}</p>
        </div>
        <ul data-testid="phone-move-folders">
            <li
                v-for="folder in listedFolders"
                :key="folder.id"
                class="ph-move-row"
            >
                <button
                    type="button"
                    class="ph-row"
                    :disabled="isCurrent(folder.id)"
                    :data-testid="`phone-move-folder-${folder.id}`"
                    @click="moveTo(folder.id, folder.name)"
                >
                    <Folder
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                    <span class="ph-move-name">{{ findText.trim() ? folder.path : folder.name }}</span>
                    <span
                        v-if="isCurrent(folder.id)"
                        class="ph-folder-chip"
                    >Current</span>
                </button>
                <button
                    v-if="!findText.trim() && hasChildren(folder.id)"
                    type="button"
                    class="ph-icon-btn"
                    :aria-label="`Open ${folder.name}`"
                    :data-testid="`phone-move-into-${folder.id}`"
                    @click="parentId = folder.id"
                >
                    <ChevronRight
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                </button>
            </li>
            <li
                v-if="!listedFolders.length"
                class="ph-move-none ph-muted"
            >{{ findText.trim() ? 'No folder matches.' : 'No folders here yet.' }}</li>
        </ul>

        <button
            type="button"
            class="ph-row ph-move-new"
            data-testid="phone-move-new-folder"
            @click="promptingFolder = true"
        >
            <FolderPlus
                class="h-5 w-5"
                aria-hidden="true"
            />
            New folder here
        </button>

        <PromptModal
            :show="promptingFolder"
            v-model="newFolderName"
            title="New folder"
            label="Folder name"
            @confirm="createAndMove"
            @cancel="promptingFolder = false"
        />
    </BottomSheet>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Folder, FolderPlus, FolderMinus, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import PromptModal from '@/components/PromptModal.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { usePhoneSelection } from '@/composables/usePhoneSelection'

const props = defineProps({
    open: { type: Boolean, default: false },
    /** 'document' moves the open Document; 'selection' moves the multi-selection. */
    target: { type: String, default: 'document' },
})
const emit = defineEmits(['close'])

const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const selection = usePhoneSelection()
const { selectedFile } = storeToRefs(docStore)

const folders = ref([])
const findText = ref('')
const parentId = ref(null)
const promptingFolder = ref(false)
const newFolderName = ref('')

/** `[{ id, dbKey, name, folderId }]` being moved; one database only. */
const items = computed(() => {
    if (props.target === 'selection') return selection.singleDatabase.value ? selection.items.value : []
    const file = selectedFile.value
    return file ? [{ id: file.id, dbKey: file.dbKey, name: file.title || 'Untitled', folderId: file.folder_id ?? null }] : []
})
const dbKey = computed(() => items.value[0]?.dbKey || null)
const isSpace = computed(() => Boolean(dbKey.value?.startsWith('space:')))
const rootLabel = computed(() => (isSpace.value ? `${syncStore.databases.get(dbKey.value)?.name || 'Shared space'} (top level)` : 'No folder'))
/** The folder every item is in, when they share one; undefined when they differ. */
const sharedFolderId = computed(() => {
    const ids = new Set(items.value.map((item) => item.folderId || null))
    return ids.size === 1 ? [...ids][0] : undefined
})

const folderById = computed(() => new Map(folders.value.map((folder) => [folder.id, folder])))
const nameOf = (folderId) => (folderId ? folderById.value.get(folderId)?.name || 'a folder' : rootLabel.value)
const parentOf = (folderId) => folderById.value.get(folderId)?.parentId ?? null
const hasChildren = (folderId) => folders.value.some((folder) => folder.parentId === folderId)
const isCurrent = (folderId) => sharedFolderId.value !== undefined && (folderId || null) === sharedFolderId.value

const currentLine = computed(() => {
    if (items.value.length > 1) {
        return sharedFolderId.value === undefined
            ? `${items.value.length} notes from different folders`
            : `${items.value.length} notes, now in ${nameOf(sharedFolderId.value)}`
    }
    return `Now in ${nameOf(sharedFolderId.value)}`
})

const suggestions = computed(() => {
    const list = [{ key: 'root', folderId: null, label: rootLabel.value, current: isCurrent(null) }]
    if (sharedFolderId.value) {
        list.push({ key: 'current', folderId: sharedFolderId.value, label: nameOf(sharedFolderId.value), current: true })
    }
    return list
})

const listHeading = computed(() => {
    if (findText.value.trim()) return 'Matching folders'
    return parentId.value ? nameOf(parentId.value) : 'All folders'
})

const listedFolders = computed(() => {
    const needle = findText.value.trim().toLowerCase()
    if (needle) return folders.value.filter((folder) => folder.path.toLowerCase().includes(needle))
    return folders.value.filter((folder) => folder.parentId === parentId.value)
})

watch(() => [props.open, dbKey.value], async ([open, key]) => {
    if (!open || !key) return
    findText.value = ''
    parentId.value = null
    try {
        folders.value = await docStore.listFolders(key)
    } catch (error) {
        console.warn('[MoveSheet] Could not list folders:', error)
        folders.value = []
    }
}, { immediate: true })

/**
 * Move every item, close, and offer Undo for five seconds. Undo puts each
 * item back in the folder it came from.
 */
async function moveTo(folderId, label) {
    const moving = items.value.filter((item) => (item.folderId || null) !== (folderId || null))
    const key = dbKey.value
    if (!moving.length || !key) {
        emit('close')
        return
    }
    const done = []
    try {
        for (const item of moving) {
            const result = await docStore.moveItem(item.id, folderId, 'file', key, key)
            done.push({ id: item.id, from: result?.oldParentId ?? null })
        }
    } catch (error) {
        console.error('[MoveSheet] Move failed:', error)
        ui.addToast('Some notes could not be moved. Try again.', 'error')
    }
    if (props.target === 'selection') selection.clear()
    if (selectedFile.value && done.some((entry) => entry.id === selectedFile.value.id)) {
        await docStore.structureStore.reFetchSelectedFile()
    }
    emit('close')
    if (!done.length) return
    ui.addToast(`Moved to ${label}`, 'success', 5000, {
        action: { label: 'Undo', onSelect: () => undoMove(done, key) },
    })
}

async function undoMove(done, key) {
    try {
        for (const entry of done) await docStore.moveItem(entry.id, entry.from, 'file', key, key)
        if (selectedFile.value && done.some((entry) => entry.id === selectedFile.value.id)) {
            await docStore.structureStore.reFetchSelectedFile()
        }
    } catch (error) {
        console.error('[MoveSheet] Undo failed:', error)
        ui.addToast('The move could not be undone.', 'error')
    }
}

async function createAndMove() {
    const name = newFolderName.value.trim()
    if (!name || !dbKey.value) return
    promptingFolder.value = false
    newFolderName.value = ''
    try {
        const created = await docStore.createFolder(dbKey.value, name, parentId.value)
        await moveTo(created.id, name)
    } catch (error) {
        console.error('[MoveSheet] Folder creation failed:', error)
        ui.addToast('The folder could not be created. Try again.', 'error')
    }
}
</script>

<style scoped>
.ph-move-head {
    padding: 0 8px;
}

.ph-move-title {
    font-family: var(--ph-serif);
    font-size: 24px;
    font-weight: 700;
}

.ph-move-search {
    padding: 4px 16px 8px;
}

.ph-move-label {
    padding: 12px 20px 4px;
}

.ph-move-label-row {
    display: flex;
    align-items: center;
}

.ph-move-label-row .ph-icon-btn {
    margin-left: 8px;
}

.ph-move-label-row .ph-icon-btn + .ph-move-label {
    padding-left: 0;
}

.ph-move-row {
    display: flex;
    align-items: center;
    padding-right: 8px;
}

.ph-move-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-move-none {
    padding: 12px 20px;
    font-size: 15px;
}

.ph-move-new {
    margin-top: 4px;
    border-top: 1px solid var(--ph-line);
    color: var(--ph-accent);
}

.ph-move-new svg {
    color: var(--ph-accent);
}
</style>
