<template>
    <div
        class="h-full flex flex-col"
        @dragover.prevent
        @drop="handleRootDrop"
    >
        <div class="flex justify-between items-center mb-4">
            <h2
                class="font-bold text-lg cursor-pointer"
                @click="handleDocumentsClick"
                data-testid="documents-header"
            >
                Documents
            </h2>
            <div
                ref="headerButtonsRef"
                class="flex space-x-2"
            >
                <BaseButton
                    :isActive="searchOpen"
                    @click="toggleSearch"
                    title="Search (Ctrl+Shift+F)"
                    data-testid="documents-search-toggle"
                >
                    <Search class="w-4 h-4" />
                </BaseButton>

                <BaseButton
                    @click="showCreateFileModal"
                    title="New Document"
                    data-testid="documents-new-file-button"
                >
                    <FilePlus class="w-4 h-4" />
                </BaseButton>

                <BaseButton
                    @click="showCreateFolderModal"
                    title="New Folder"
                    data-testid="documents-new-folder-button"
                >
                    <FolderPlus class="w-4 h-4" />
                </BaseButton>

                <BaseButton
                    @click="showTemplatePicker = true"
                    title="New from Template"
                    data-testid="documents-new-from-template-button"
                >
                    <FileText class="w-4 h-4" />
                </BaseButton>
            </div>
        </div>

        <!-- Tag filters and search both replace the tree; an open search wins. -->
        <TagFilterBar v-if="!searchOpen" />
        <div
            v-if="tagStore.hasFilters && !searchOpen"
            class="flex-1 overflow-y-auto"
        >
            <DocumentTransferPanel />
            <TagFilterResults />
        </div>
        <div v-else class="flex-1 overflow-y-auto">
            <DocumentTransferPanel />
            <div
                v-if="docStore.syncStore.bootstrapState.status === 'loading'"
                class="mb-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800"
                role="status"
                data-testid="space-bootstrap-progress"
            >
                Loading shared space {{ docStore.syncStore.bootstrapState.completed + 1 }}
                of {{ docStore.syncStore.bootstrapState.total }}…
            </div>
            <div
                v-else-if="docStore.syncStore.bootstrapState.status === 'upgrade-required'"
                class="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
                role="alert"
                data-testid="space-bootstrap-upgrade-required"
            >
                {{ docStore.syncStore.bootstrapState.error }}
            </div>
            <SearchPanel
                v-if="searchOpen"
                @close="closeSearch"
            />
            <div
                v-else
                data-testid="documents-tree-normal"
            >
                <ul
                    v-if="!spaceItems.length"
                    class="space-y-1"
                >
                    <li
                        v-for="item in personalItems"
                        :key="item.treeKey || item.id"
                    >
                        <TreeItem
                            :item="item"
                            :is-filtered="false"
                        />
                    </li>
                </ul>
                <ul
                    v-else
                    class="space-y-1"
                >
                    <li data-testid="documents-my-notes">
                        <div
                            class="flex items-center space-x-2 rounded-md py-1 my-1 cursor-pointer hover:bg-gray-100"
                            role="button"
                            tabindex="0"
                            :aria-expanded="!ui.myNotesCollapsed"
                            data-testid="documents-my-notes-toggle"
                            @click="ui.toggleMyNotesCollapsed()"
                            @keydown.enter.prevent="ui.toggleMyNotesCollapsed()"
                            @keydown.space.prevent="ui.toggleMyNotesCollapsed()"
                            @dragover.prevent.stop
                            @drop.prevent.stop="handleRootDrop"
                        >
                            <span class="ml-1 p-1 rounded hover:bg-gray-300">
                                <ChevronRight
                                    v-if="ui.myNotesCollapsed"
                                    class="w-4 h-4"
                                />
                                <ChevronDown
                                    v-else
                                    class="w-4 h-4"
                                />
                            </span>
                            <span class="font-semibold flex-grow truncate">
                                <User class="inline-block w-4 h-4 mr-1" />My Notes
                            </span>
                        </div>
                        <ul
                            v-if="!ui.myNotesCollapsed"
                            class="ml-6 mt-1 border-l pl-2"
                            data-testid="documents-my-notes-items"
                        >
                            <li
                                v-for="item in personalItems"
                                :key="item.treeKey || item.id"
                            >
                                <TreeItem
                                    :item="item"
                                    :is-filtered="false"
                                />
                            </li>
                            <li
                                v-if="!personalItems.length"
                                class="text-sm text-gray-500 pl-2 py-1"
                            >
                                No Documents yet.
                            </li>
                        </ul>
                    </li>
                    <li
                        v-for="item in spaceItems"
                        :key="item.treeKey || item.id"
                    >
                        <TreeItem
                            :item="item"
                            :is-filtered="false"
                        />
                    </li>
                </ul>
            </div>
        </div>

        <PromptModal
            v-if="showCreateModal"
            v-model="newItemName"
            :title="`Create New ${createType}`"
            :label="`${createType} name`"
            :placeholder="'Enter ' + createType + ' name'"
            confirm-label="Create"
            data-testid="documents-create-modal"
            input-testid="documents-create-modal-input"
            cancel-testid="documents-create-modal-cancel"
            confirm-testid="documents-create-modal-confirm"
            @confirm="confirmCreate"
            @cancel="cancelCreate"
        />

        <TemplatePickerModal
            v-if="showTemplatePicker"
            :current-folder-id="structureStore.selectedFolderId"
            :database-key="structureStore.selectedDbKey || docStore.syncStore.personalDbKey"
            @close="showTemplatePicker = false"
            @created="onNoteCreatedFromTemplate"
        />
    </div>
</template>

<script setup>
import { computed, ref, nextTick, provide } from 'vue';
import { useRouter } from 'vue-router';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import TreeItem from './TreeItem.vue'
import BaseButton from './BaseButton.vue'
import { Search, FilePlus, FolderPlus, FileText, ChevronDown, ChevronRight, User } from 'lucide-vue-next'
import TemplatePickerModal from '@/components/TemplatePickerModal.vue'
import PromptModal from '@/components/PromptModal.vue'
import { useStructureStore } from '@/store/structureStore'
import { useSpaceTransferStore } from '@/store/spaceTransferStore'
import DocumentTransferPanel from '@/components/DocumentTransferPanel.vue'
import TagFilterBar from '@/components/tags/TagFilterBar.vue'
import TagFilterResults from '@/components/tags/TagFilterResults.vue'
import { useTagStore } from '@/store/tagStore'
import SearchPanel from '@/components/SearchPanel.vue'
import { useDesktopSearchState } from '@/composables/useDocumentSearch'

const docStore = useDocStore()
const ui = useUiStore();
const structureStore = useStructureStore()
const transferStore = useSpaceTransferStore()
const tagStore = useTagStore()
const router = useRouter();

const rootItems = computed(() => docStore.rootItems)
// Once there is a space, the personal Documents and folders sit under a
// collapsible My Notes row, above the spaces.
const spaceItems = computed(() => rootItems.value.filter((item) => item.type === 'space'))
const personalItems = computed(() => rootItems.value.filter((item) => item.type !== 'space'))

provide('refreshParent', docStore.loadRootItems);
provide('requestDatabaseTransfer', (details) => transferStore.begin(details));

/* search: the panel replaces the tree while open (advanced-search.md §5.1) */
const desktopSearch = useDesktopSearchState()
const searchOpen = computed(() => desktopSearch.open.value)

function toggleSearch() {
    if (desktopSearch.open.value) desktopSearch.closeSearch()
    else desktopSearch.openSearch()
}
// Closing the panel (Esc or its close button) puts focus back on the search button.
// (BaseButton renders a fragment, so the button is found in the header rather than by a ref.)
const headerButtonsRef = ref(null)
function closeSearch() {
    desktopSearch.closeSearch()
    nextTick(() => headerButtonsRef.value?.querySelector('[data-testid="documents-search-toggle"]')?.focus())
}


/* create-modal helpers */
const showCreateModal = ref(false)
const showTemplatePicker = ref(false)
const createType = ref('')
const newItemName = ref('')
// PromptModal focuses its own input once mounted.
function showCreateFileModal() { createType.value = 'Document'; showCreateModal.value = true }
function showCreateFolderModal() { createType.value = 'Folder'; showCreateModal.value = true }

async function confirmCreate() {
    if (!newItemName.value.trim()) return

    try {
        let newItem;
        if (createType.value === 'Document') {
            newItem = await docStore.createFile(docStore.syncStore.personalDbKey, newItemName.value)
            if (newItem && newItem.id) {
                await nextTick() // Wait for DOM updates
                router.push({ name: 'doc', params: { fileId: newItem.id }, query: { dbKey: newItem.dbKey } })
            }
        } else {
            newItem = await docStore.createFolder(docStore.syncStore.personalDbKey, newItemName.value)
            if (newItem && newItem.id) {
                await nextTick()
                router.push({ name: 'folder', params: { folderId: newItem.id }, query: { dbKey: newItem.dbKey } })
            }
        }
    } catch (error) {
        console.error('Failed to create item:', error)
        ui.addToast(`Failed to create ${createType.value.toLowerCase()}`)
    } finally {
        cancelCreate()
    }
}
function cancelCreate() { showCreateModal.value = false; newItemName.value = ''; createType.value = '' }

function onNoteCreatedFromTemplate(note) {
    showTemplatePicker.value = false;
    router.push({ name: 'doc', params: { fileId: note.id }, query: { dbKey: note.dbKey } });
}

/* misc */
function handleDocumentsClick() { docStore.selectFolder(null, docStore.syncStore.personalDbKey) }

/* drag-and-drop root handler */
async function handleRootDrop(e) {
    const droppedItem = JSON.parse(e.dataTransfer.getData('application/json'))
    if (!droppedItem || !droppedItem.id) return
    try {
        const result = await docStore.moveItem(
            droppedItem.id,
            null,
            droppedItem.type,
            docStore.syncStore.personalDbKey,
        );
        if (result?.requiresConfirmation) {
            transferStore.begin(result);
            return;
        }
        await docStore.loadRootItems(); // Refresh root list
    } catch (error) {
        ui.addToast(error?.message || 'Failed to move Document.', 'warning')
    }
}
</script>
