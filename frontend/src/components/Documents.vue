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
            <div class="flex space-x-2">
                <BaseButton
                    :isActive="showSearch"
                    @click="toggleSearch"
                    title="Toggle Search"
                    data-testid="documents-search-toggle"
                >
                    <Search class="w-4 h-4" />
                </BaseButton>

                <BaseButton
                    @click="showCreateFileModal"
                    title="New File"
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
            </div>
        </div>

        <div
            v-if="showSearch"
            class="mb-4 overflow-hidden transition-all duration-200"
            :class="{ 'opacity-100': showSearch, 'opacity-0': !showSearch }"
        >
            <div class="relative">
                <Search class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input
                    v-model="searchQuery"
                    type="text"
                    placeholder="Search files and folders..."
                    class="w-full px-8 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                    ref="searchInput"
                    data-testid="documents-search-input"
                />
                <button
                    v-if="searchQuery"
                    @click="clearSearch"
                    class="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                    data-testid="documents-search-clear"
                >
                    <X class="w-4 h-4" />
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto">
            <div
                v-if="searchQuery"
                data-testid="documents-tree-search"
            >
                <div v-if="filteredStructure.length > 0">
                    <ul class="space-y-1">
                        <li
                            v-for="item in filteredStructure"
                            :key="item.id"
                        >
                            <TreeItem
                                :item="item"
                                :is-filtered="true"
                                :matching-files="getMatchingFilesForItem(item)"
                            />
                        </li>
                    </ul>
                </div>
                <div
                    v-else
                    class="text-gray-500 text-center py-4"
                    data-testid="documents-no-matches"
                >
                    No matches found for "{{ searchQuery }}"
                </div>
            </div>
            <div
                v-else
                data-testid="documents-tree-normal"
            >
                <ul class="space-y-1">
                    <li
                        v-for="item in rootItems"
                        :key="item.id"
                    >
                        <TreeItem
                            :item="item"
                            :is-filtered="false"
                        />
                    </li>
                </ul>
            </div>
        </div>

        <div
            v-if="showCreateModal"
            class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            data-testid="documents-create-modal"
        >
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">
                    Create New {{ createType }}
                </h3>
                <input
                    v-model="newItemName"
                    type="text"
                    class="w-full border rounded p-2 mb-4"
                    :placeholder="'Enter ' + createType + ' name'"
                    @keyup.enter="confirmCreate"
                    data-testid="documents-create-modal-input"
                />
                <div class="flex justify-end space-x-2">
                    <button
                        @click="cancelCreate"
                        class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        data-testid="documents-create-modal-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        @click="confirmCreate"
                        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        data-testid="documents-create-modal-confirm"
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, provide } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import TreeItem from './TreeItem.vue'
import BaseButton from './BaseButton.vue'
import { Search, X, FilePlus, FolderPlus } from 'lucide-vue-next'

const docStore = useDocStore()
const ui = useUiStore();
const router = useRouter();

const { rootItems } = storeToRefs(docStore)

provide('refreshParent', docStore.loadRootItems);

/* search / ui refs */
const searchQuery = ref('')
const showSearch = ref(false)
const searchInput = ref(null)

function toggleSearch() {
    showSearch.value = !showSearch.value
    showSearch.value && nextTick(() => searchInput.value?.focus())
    !showSearch.value && clearSearch()
}
function clearSearch() { searchQuery.value = '' }

/* filtering helpers */
function matchesSearch(text, query) { return text.toLowerCase().includes(query.toLowerCase()) }

async function getAllFilesInFolder(f) {
    let res = [];
    const children = await docStore.getChildren(f.id);
    for (const c of children) {
        if (c.type === 'file') {
            res.push(c);
        } else {
            res.push(...(await getAllFilesInFolder(c)));
        }
    }
    return res;
}

async function getImmediateFiles(f) {
    return (await docStore.getChildren(f.id)).filter(c => c.type === 'file')
}

const filteredStructure = ref([])
const matchingFilesMap = ref({})

let searchVersion = 0
watch(searchQuery, async (query) => {
    if (!query) {
        filteredStructure.value = []
        matchingFilesMap.value = {}
        return
    }
    const version = ++searchVersion
    const results = []
    const filesMap = {}
    for (const item of rootItems.value) {
        if (version !== searchVersion) return
        if (item.type === 'file') {
            if (matchesSearch(item.name, query)) results.push(item)
        } else {
            const folderNameMatches = matchesSearch(item.name, query)
            let files
            if (folderNameMatches) {
                files = await getImmediateFiles(item)
            } else {
                files = (await getAllFilesInFolder(item)).filter(fi => matchesSearch(fi.name, query))
            }
            if (version !== searchVersion) return
            if (folderNameMatches || files.length > 0) {
                results.push(item)
                filesMap[item.id] = files
            }
        }
    }
    if (version !== searchVersion) return
    filteredStructure.value = results
    matchingFilesMap.value = filesMap
})

function getMatchingFilesForItem(item) {
    return matchingFilesMap.value[item.id] || []
}


/* create-modal helpers */
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')
function showCreateFileModal() { createType.value = 'File'; showCreateModal.value = true; nextTick(focusModalInput) }
function showCreateFolderModal() { createType.value = 'Folder'; showCreateModal.value = true; nextTick(focusModalInput) }
function focusModalInput() { document.querySelector('[data-testid="documents-create-modal-input"]')?.focus() }

async function confirmCreate() {
    if (!newItemName.value.trim()) return

    try {
        let newItem;
        if (createType.value === 'File') {
            newItem = await docStore.createFile(newItemName.value)
            if (newItem && newItem.id) {
                await nextTick() // Wait for DOM updates
                router.push({ name: 'doc', params: { fileId: newItem.id } })
            }
        } else {
            newItem = await docStore.createFolder(newItemName.value)
            if (newItem && newItem.id) {
                await nextTick()
                router.push({ name: 'folder', params: { folderId: newItem.id } })
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

/* misc */
function handleDocumentsClick() { docStore.selectFolder(null) }

/* drag-and-drop root handler */
async function handleRootDrop(e) {
    const droppedItem = JSON.parse(e.dataTransfer.getData('application/json'))
    if (!droppedItem || !droppedItem.id) return
    await docStore.moveItem(droppedItem.id, null, droppedItem.type);
    await docStore.loadRootItems(); // Refresh root list
}
</script>
