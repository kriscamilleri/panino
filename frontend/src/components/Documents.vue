<template>
    <!-- root element also acts as drop-zone to move items to root -->
    <div class="h-full flex flex-col" @dragover.prevent @drop="handleRootDrop">

        <!--──────────────────────── Header ────────────────────────-->
        <div class="flex justify-between items-center mb-4">
            <h2 class="font-bold text-lg cursor-pointer" @click="handleDocumentsClick" data-testid="documents-header">
                Documents
            </h2>
            <div class="flex space-x-2">
                <BaseButton :isActive="showSearch" @click="toggleSearch" title="Toggle Search"
                    data-testid="documents-search-toggle">
                    <Search class="w-4 h-4" />
                </BaseButton>

                <BaseButton @click="showCreateFileModal" title="New File" data-testid="documents-new-file-button">
                    <FilePlus class="w-4 h-4" />
                </BaseButton>

                <BaseButton @click="showCreateFolderModal" title="New Folder" data-testid="documents-new-folder-button">
                    <FolderPlus class="w-4 h-4" />
                </BaseButton>
            </div>
        </div>

        <!--──────────────────────── Search bar ────────────────────────-->
        <div v-if="showSearch" class="mb-4 overflow-hidden transition-all duration-200"
            :class="{ 'opacity-100': showSearch, 'opacity-0': !showSearch }">
            <div class="relative">
                <Search class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input v-model="searchQuery" type="text" placeholder="Search files and folders..."
                    class="w-full px-8 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                    ref="searchInput" data-testid="documents-search-input" />
                <button v-if="searchQuery" @click="clearSearch"
                    class="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                    data-testid="documents-search-clear">
                    <X class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!--──────────────────────── File tree ────────────────────────-->
        <div class="flex-1 overflow-y-auto">
            <div v-if="searchQuery" data-testid="documents-tree-search">
                <div v-if="filteredStructure.length > 0">
                    <ul class="space-y-1">
                        <li v-for="item in filteredStructure" :key="item.id">
                            <TreeItem :item="item" :is-filtered="true"
                                :matching-files="getMatchingFilesForFolder(item)" />
                        </li>
                    </ul>
                </div>
                <div v-else class="text-gray-500 text-center py-4" data-testid="documents-no-matches">
                    No matches found for "{{ searchQuery }}"
                </div>
            </div>
            <div v-else data-testid="documents-tree-normal">
                <ul class="space-y-1">
                    <li v-for="item in rootItems" :key="item.id">
                        <TreeItem :item="item" :is-filtered="false" />
                    </li>
                </ul>
            </div>
        </div>

        <!--──────────────────────── Create modal ────────────────────────-->
        <div v-if="showCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            data-testid="documents-create-modal">
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">
                    Create New {{ createType }}
                </h3>
                <input v-model="newItemName" type="text" class="w-full border rounded p-2 mb-4"
                    :placeholder="'Enter ' + createType + ' name'" @keyup.enter="confirmCreate"
                    data-testid="documents-create-modal-input" />
                <div class="flex justify-end space-x-2">
                    <button @click="cancelCreate" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        data-testid="documents-create-modal-cancel">
                        Cancel
                    </button>
                    <button @click="confirmCreate" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        data-testid="documents-create-modal-confirm">
                        Create
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useStructureStore } from '@/store/structureStore'
import TreeItem from './TreeItem.vue'
import BaseButton from './BaseButton.vue'
import { Search, X, FilePlus, FolderPlus } from 'lucide-vue-next'

const docStore = useDocStore()
const structureStore = useStructureStore()

/*───────────────────────────── search / ui refs ─────────────────────────────*/
const searchQuery = ref('')
const showSearch = ref(false)
const searchInput = ref(null)

function toggleSearch() {
    showSearch.value = !showSearch.value
    showSearch.value && nextTick(() => searchInput.value?.focus())
    !showSearch.value && clearSearch()
}

function clearSearch() { searchQuery.value = '' }

/*───────────────────────────── structure computed ───────────────────────────*/
const rootItems = computed(() => docStore.rootItems)

/*───────────────────────────── filtering helpers
  (unchanged from original file) ───────────────────────────*/
function matchesSearch(text) { return text.toLowerCase().includes(searchQuery.value.toLowerCase()) }
function getAllFilesInFolder(f) {
    const res = []; docStore.getChildren(f.id).forEach(c => { c.type === 'file' ? res.push(c) : res.push(...getAllFilesInFolder(c)) }); return res
}
function getImmediateFiles(f) { return docStore.getChildren(f.id).filter(c => c.type === 'file') }
function getMatchingFilesForFolder(f) {
    if (!searchQuery.value) return []
    if (matchesSearch(f.name)) return getImmediateFiles(f)
    return getAllFilesInFolder(f).filter(fi => matchesSearch(fi.name))
}
function folderMatchesSearch(f) {
    if (matchesSearch(f.name)) return true
    if (getAllFilesInFolder(f).some(fi => matchesSearch(fi.name))) return true
    return docStore.getChildren(f.id).filter(c => c.type === 'folder').some(sf => folderMatchesSearch(sf))
}
const filteredStructure = computed(() => !searchQuery.value ? [] :
    rootItems.value.reduce((acc, i) => {
        if (i.type === 'folder') { if (folderMatchesSearch(i)) acc.push(i) }
        else if (matchesSearch(i.name)) acc.push(i)
        return acc
    }, [])
)

/*───────────────────────────── create-modal helpers (unchanged) ─────────────*/
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')
function showCreateFileModal() { createType.value = 'File'; showCreateModal.value = true; nextTick(focusModalInput) }
function showCreateFolderModal() { createType.value = 'Folder'; showCreateModal.value = true; nextTick(focusModalInput) }
function focusModalInput() { document.querySelector('[data-testid="documents-create-modal-input"]')?.focus() }
function confirmCreate() {
    if (!newItemName.value.trim()) return
    createType.value === 'File'
        ? docStore.createFile(newItemName.value)
        : docStore.createFolder(newItemName.value)
    cancelCreate()
}
function cancelCreate() { showCreateModal.value = false; newItemName.value = ''; createType.value = '' }

/*───────────────────────────── misc ─────────────────────────────*/
function handleDocumentsClick() { docStore.selectFolder(null) }

/*───────────────────────────── drag-and-drop root handler ──────────────────*/
function handleRootDrop(e) {
    const draggedId = e.dataTransfer.getData('application/x-item-id')
    draggedId && structureStore.moveItem(draggedId, null) /* move to root */
}
</script>