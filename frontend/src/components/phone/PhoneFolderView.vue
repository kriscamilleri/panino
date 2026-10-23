<template>
    <div
        class="ph-folder"
        data-testid="phone-folder-view"
    >
        <header class="ph-folder-top">
            <SelectionBar
                v-if="selection.selecting.value"
                @move="openSheet('move', 'selection')"
            />
            <div
                v-else
                class="ph-folder-bar"
            >
                <button
                    type="button"
                    class="ph-icon-btn"
                    aria-label="Back"
                    data-testid="phone-folder-back"
                    @click="goBack"
                >
                    <ArrowLeft
                        class="h-6 w-6"
                        aria-hidden="true"
                    />
                </button>
                <nav
                    class="ph-crumbs"
                    aria-label="Folder path"
                >
                    <template
                        v-for="crumb in crumbs"
                        :key="crumb.key"
                    >
                        <button
                            type="button"
                            class="ph-crumb"
                            @click="router.push(crumb.to)"
                        >{{ crumb.label }}</button>
                        <ChevronRight
                            class="h-3 w-3 ph-muted"
                            aria-hidden="true"
                        />
                    </template>
                </nav>
                <button
                    type="button"
                    class="ph-icon-btn"
                    :aria-label="`Search in ${title}`"
                    data-testid="phone-folder-search"
                    @click="router.push({ name: 'search', query: { scope: 'folder', folder: folderParam, dbKey } })"
                >
                    <Search
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                </button>
                <button
                    v-if="!isSpaceRoot"
                    type="button"
                    class="ph-icon-btn"
                    aria-label="Folder options"
                    data-testid="phone-folder-options"
                    @click="showOptions = true"
                >
                    <MoreHorizontal
                        class="h-6 w-6"
                        aria-hidden="true"
                    />
                </button>
            </div>
        </header>

        <main class="ph-folder-scroll">
            <h1
                class="ph-display ph-folder-title"
                data-testid="phone-folder-title"
            >{{ title }}</h1>
            <p
                v-if="isSpace"
                class="ph-muted ph-folder-shared"
            >
                <Users
                    class="h-4 w-4"
                    aria-hidden="true"
                /> Shared folder
            </p>

            <section
                v-if="subfolders.length"
                class="ph-folder-section"
                aria-label="Folders"
            >
                <div class="ph-tiles">
                    <button
                        v-for="folder in subfolders"
                        :key="folder.id"
                        type="button"
                        class="ph-tile"
                        :data-testid="`phone-subfolder-${folder.id}`"
                        @click="openFolder(folder)"
                    >
                        <Folder
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span>{{ folder.name }}</span>
                    </button>
                </div>
            </section>

            <section
                v-if="notes.length"
                class="ph-folder-section"
                aria-label="Notes"
            >
                <div class="ph-folder-notes-head">
                    <p class="ph-section-label">Notes</p>
                    <SortButton />
                </div>
                <div
                    v-if="ui.homeLayout === 'grid'"
                    class="ph-grid"
                >
                    <div
                        v-for="(column, index) in columns"
                        :key="index"
                        class="ph-grid-column"
                    >
                        <NoteCard
                            v-for="doc in column"
                            :key="doc.id"
                            :doc="doc"
                            :selecting="selection.selecting.value"
                            :selected="selection.isSelected(doc)"
                            @open="openDocument"
                            @select="selection.toggle"
                        />
                    </div>
                </div>
                <div
                    v-else
                    class="ph-list"
                >
                    <NoteCard
                        v-for="doc in notes"
                        :key="doc.id"
                        :doc="doc"
                        variant="list"
                        :selecting="selection.selecting.value"
                        :selected="selection.isSelected(doc)"
                        @open="openDocument"
                        @select="selection.toggle"
                    />
                </div>
            </section>

            <p
                v-if="loaded && !notes.length && !subfolders.length"
                class="ph-muted ph-folder-empty"
                data-testid="phone-folder-empty"
            >This folder is empty. Notes you take here are saved in it.</p>
        </main>

        <NewNoteButtons
            @note="openSheet('capture')"
            @template="showTemplates = true"
        />

        <QuickCaptureSheet
            :open="activeSheet === 'capture'"
            :initial-kind="sheetArg === 'checklist' ? 'checklist' : 'note'"
            :default-destination="destination"
            @close="closeSheet"
        />

        <TemplatePickerModal
            v-if="showTemplates"
            :database-key="dbKey"
            :current-folder-id="folderParam"
            @close="showTemplates = false"
            @created="openCreated"
        />

        <BottomSheet
            :open="showOptions"
            label="Folder options"
            testid="phone-folder-options-sheet"
            @close="showOptions = false"
        >
            <template #header>
                <h2 class="ph-folder-options-title">{{ title }}</h2>
            </template>
            <button
                type="button"
                class="ph-row"
                data-testid="phone-folder-rename"
                @click="startRename"
            >
                <Pencil
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                Rename
            </button>
            <button
                type="button"
                class="ph-row"
                @click="showOptions = false; promptingFolder = true"
            >
                <FolderPlus
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                New subfolder
            </button>
            <button
                type="button"
                class="ph-row ph-row-danger"
                data-testid="phone-folder-delete"
                @click="showOptions = false; confirmingDelete = true"
            >
                <Trash2
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                Delete folder
            </button>
        </BottomSheet>

        <PromptModal
            :show="promptingFolder"
            v-model="newFolderName"
            title="New subfolder"
            label="Folder name"
            @confirm="createSubfolder"
            @cancel="promptingFolder = false"
        />
        <PromptModal
            :show="renaming"
            v-model="renameValue"
            title="Rename folder"
            label="Folder name"
            confirm-label="Rename"
            @confirm="rename"
            @cancel="renaming = false"
        />
        <BaseModal
            :show="confirmingDelete"
            title="Delete this folder?"
            size="sm"
            @close="confirmingDelete = false"
        >
            <p>“{{ title }}”, its subfolders and every Document in them are deleted on every device. This cannot be undone.</p>
            <template #footer>
                <BaseButton
                    variant="secondary"
                    @click="confirmingDelete = false"
                >Cancel</BaseButton>
                <BaseButton
                    variant="danger"
                    data-testid="phone-folder-delete-confirm"
                    @click="deleteFolder"
                >Delete</BaseButton>
            </template>
        </BaseModal>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronRight, Search, MoreHorizontal, Folder, FolderPlus, Users, Pencil, Trash2 } from 'lucide-vue-next'
import NoteCard from '@/components/phone/NoteCard.vue'
import NewNoteButtons from '@/components/phone/NewNoteButtons.vue'
import QuickCaptureSheet from '@/components/phone/QuickCaptureSheet.vue'
import SelectionBar from '@/components/phone/SelectionBar.vue'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SortButton from '@/components/phone/SortButton.vue'
import PromptModal from '@/components/PromptModal.vue'
import TemplatePickerModal from '@/components/TemplatePickerModal.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { usePhoneSelection } from '@/composables/usePhoneSelection'
import { splitIntoColumns } from '@/utils/homeView'
import { toSnippetLines } from '@/utils/markdownSnippet'
import { goUp } from '@/utils/phoneNavigation'

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { activeSheet, sheetArg, openSheet, closeSheet } = useSheetRoute()
const selection = usePhoneSelection()

const trail = ref([])
const subfolders = ref([])
const notes = ref([])
const loaded = ref(false)
const showOptions = ref(false)
const showTemplates = ref(false)
const promptingFolder = ref(false)
const newFolderName = ref('')
const renaming = ref(false)
const renameValue = ref('')
const confirmingDelete = ref(false)

const folderParam = computed(() => String(route.params.folderId || ''))
const dbKey = computed(() => (typeof route.query.dbKey === 'string' ? route.query.dbKey : syncStore.personalDbKey))
const isSpace = computed(() => Boolean(dbKey.value?.startsWith('space:')))
const isSpaceRoot = computed(() => folderParam.value === dbKey.value)
/** The folder id in the database; null for a space's top level. */
const folderId = computed(() => (isSpaceRoot.value ? null : folderParam.value))
const spaceName = computed(() => syncStore.databases.get(dbKey.value)?.name || 'Shared space')

const title = computed(() => {
    if (isSpaceRoot.value) return spaceName.value
    return trail.value[trail.value.length - 1]?.name || 'Folder'
})

/** Tappable path above the title: the library root, then each ancestor. */
const crumbs = computed(() => {
    const list = []
    if (isSpace.value) {
        list.push({ key: 'shared', label: 'Shared', to: { name: 'folders', query: { tab: 'shared' } } })
        if (!isSpaceRoot.value) {
            list.push({ key: 'space', label: spaceName.value, to: { name: 'folder', params: { folderId: dbKey.value }, query: { dbKey: dbKey.value } } })
        }
    } else {
        list.push({ key: 'folders', label: 'Folders', to: { name: 'folders' } })
    }
    for (const folder of trail.value.slice(0, -1)) {
        list.push({ key: folder.id, label: folder.name, to: { name: 'folder', params: { folderId: folder.id }, query: { dbKey: dbKey.value } } })
    }
    return list
})

/** Capture from a folder saves into it. */
const destination = computed(() => ({ dbKey: dbKey.value, folderId: folderId.value, label: title.value }))

const columns = computed(() => splitIntoColumns(
    notes.value,
    (doc) => 3 + toSnippetLines(doc.content, { title: doc.name, maxLines: 8 }).length,
))

async function load() {
    if (!syncStore.isInitialized || !dbKey.value || !syncStore.databases.get(dbKey.value)?.db) return
    try {
        const [path, children, docs] = await Promise.all([
            folderId.value ? docStore.getFolderTrail(folderId.value, dbKey.value) : Promise.resolve([]),
            docStore.getChildren(folderParam.value, dbKey.value),
            docStore.getFolderDocuments(folderId.value, dbKey.value, 200, { sort: ui.noteSort }),
        ])
        trail.value = path
        subfolders.value = children
            .filter((child) => child.type === 'folder')
            .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))
        // Pinned first; Array.sort is stable, so the chosen order holds within each group.
        notes.value = docs.slice().sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
    } catch (error) {
        console.error('[PhoneFolderView] Could not load the folder:', error)
        ui.addToast('This folder could not be opened.', 'error')
    } finally {
        loaded.value = true
    }
}

watch(
    () => [folderParam.value, dbKey.value, ui.noteSort, syncStore.isInitialized, docStore.contentVersion],
    () => { void load() },
    { immediate: true },
)

/** Up to the list this folder was opened from, or else its parent. */
function goBack() {
    const parent = trail.value[trail.value.length - 2]
    let fallback = { name: 'folders' }
    if (parent) fallback = { name: 'folder', params: { folderId: parent.id }, query: { dbKey: dbKey.value } }
    else if (isSpace.value && !isSpaceRoot.value) fallback = { name: 'folder', params: { folderId: dbKey.value }, query: { dbKey: dbKey.value } }
    else if (isSpace.value) fallback = { name: 'folders', query: { tab: 'shared' } }
    goUp(router, fallback)
}

function openFolder(folder) {
    router.push({ name: 'folder', params: { folderId: folder.id }, query: { dbKey: dbKey.value } })
}

function openDocument(doc) {
    router.push({ name: 'doc', params: { fileId: doc.id }, query: { dbKey: doc.dbKey } })
}

function openCreated(result) {
    showTemplates.value = false
    router.push({ name: 'doc', params: { fileId: result.id }, query: { dbKey: result.dbKey, mode: 'write' } })
}

async function createSubfolder() {
    const name = newFolderName.value.trim()
    if (!name) return
    promptingFolder.value = false
    newFolderName.value = ''
    try {
        await docStore.createFolder(dbKey.value, name, folderParam.value)
    } catch (error) {
        console.error('[PhoneFolderView] Folder creation failed:', error)
        ui.addToast('The folder could not be created. Try again.', 'error')
    }
}

function startRename() {
    showOptions.value = false
    renameValue.value = title.value
    renaming.value = true
}

async function rename() {
    const name = renameValue.value.trim()
    renaming.value = false
    if (!name || name === title.value) return
    try {
        await docStore.renameItem(folderId.value, name, 'folder', dbKey.value)
        await load()
    } catch (error) {
        console.error('[PhoneFolderView] Rename failed:', error)
        ui.addToast('The folder could not be renamed. Try again.', 'error')
    }
}

async function deleteFolder() {
    confirmingDelete.value = false
    const parent = trail.value[trail.value.length - 2]
    try {
        await docStore.deleteItem(folderId.value, 'folder', dbKey.value)
        ui.addToast('Folder deleted.', 'success', 2500)
        router.replace(parent
            ? { name: 'folder', params: { folderId: parent.id }, query: { dbKey: dbKey.value } }
            : { name: 'folders' })
    } catch (error) {
        console.error('[PhoneFolderView] Delete failed:', error)
        ui.addToast('The folder could not be deleted. Try again.', 'error')
    }
}
</script>

<style scoped>
.ph-folder {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-canvas);
}

.ph-folder-top {
    padding: calc(8px + env(safe-area-inset-top)) 8px 0;
    flex-shrink: 0;
}

.ph-folder-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 52px;
}

.ph-crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
}

.ph-crumb {
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ph-muted);
    font-size: 14px;
}

.ph-folder-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 12px 152px;
}

.ph-folder-title {
    padding: 0 4px;
    overflow-wrap: anywhere;
}

.ph-folder-shared {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 0;
    font-size: 14px;
}

.ph-folder-section {
    margin-top: 16px;
}

.ph-folder-notes-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 6px 4px;
}

.ph-tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
}

.ph-tile {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 14px;
    border: 1px solid var(--ph-line);
    border-radius: 8px;
    background: var(--ph-surface);
    color: var(--ph-ink);
    font-size: 15px;
    font-weight: 600;
    text-align: left;
}

.ph-tile span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-tile svg {
    flex-shrink: 0;
    color: var(--ph-accent);
}

.ph-grid {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}

.ph-grid-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ph-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ph-folder-empty {
    padding: 40px 12px;
    text-align: center;
}

.ph-folder-options-title {
    padding: 0 8px;
    font-size: 20px;
    font-weight: 600;
}
</style>
