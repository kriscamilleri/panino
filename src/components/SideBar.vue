<template>
    <div class="h-full flex flex-col">
        <!-- Header with action buttons -->
        <div class="flex justify-between items-center mb-4">
            <h2 class="font-bold text-lg">Documents</h2>
            <div class="flex space-x-2">
                <button @click="toggleSearch" class="p-2 hover:bg-gray-100 rounded"
                    :class="{ 'bg-gray-200': showSearch }" title="Toggle Search">
                    <Search class="w-4 h-4" />
                </button>
                <button @click="showCreateFileModal" class="p-2 hover:bg-gray-100 rounded flex items-center space-x-1"
                    title="New File">
                    <FilePlus class="w-4 h-4" />
                </button>
                <button @click="showCreateFolderModal" class="p-2 hover:bg-gray-100 rounded flex items-center space-x-1"
                    title="New Folder">
                    <FolderPlus class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!-- Collapsible Search section -->
        <div v-if="showSearch" class="mb-4 overflow-hidden transition-all duration-200"
            :class="{ 'opacity-100': showSearch, 'opacity-0': !showSearch }">
            <div class="relative">
                <Search class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input v-model="searchQuery" type="text" placeholder="Search files and folders..."
                    class="w-full px-8 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                    ref="searchInput" />
                <button v-if="searchQuery" @click="clearSearch"
                    class="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                    <X class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!-- File Tree -->
        <div class="flex-1 overflow-y-auto">
            <div v-if="searchQuery">
                <div v-if="filteredStructure.length > 0">
                    <ul class="space-y-1">
                        <li v-for="item in filteredStructure" :key="item.id">
                            <TreeItem :item="item" :is-filtered="true"
                                :matching-files="getMatchingFilesForFolder(item)" />
                        </li>
                    </ul>
                </div>
                <div v-else class="text-gray-500 text-center py-4">
                    No matches found for "{{ searchQuery }}"
                </div>
            </div>
            <div v-else>
                <ul class="space-y-1">
                    <li v-for="item in rootItems" :key="item.id">
                        <TreeItem :item="item" :is-filtered="false" />
                    </li>
                </ul>
            </div>
        </div>

        <!-- Create Modal -->
        <div v-if="showCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">
                    Create New {{ createType }}
                </h3>
                <input v-model="newItemName" type="text" class="w-full border rounded p-2 mb-4"
                    :placeholder="'Enter ' + createType + ' name'" @keyup.enter="confirmCreate" />
                <div class="flex justify-end space-x-2">
                    <button @click="cancelCreate" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
                        Cancel
                    </button>
                    <button @click="confirmCreate" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                        Create
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, nextTick } from 'vue'
import { useDocStore } from '@/store/docStore'
import TreeItem from './TreeItem.vue'

// Import only necessary Lucide icons
import {
    Search,
    X,
    FilePlus,
    FolderPlus
} from 'lucide-vue-next'

const docStore = useDocStore()
const rootItems = computed(() => docStore.rootItems)

// Search functionality
const searchQuery = ref('')
const showSearch = ref(false)
const searchInput = ref(null)

function toggleSearch() {
    showSearch.value = !showSearch.value
    if (showSearch.value) {
        nextTick(() => {
            searchInput.value?.focus()
        })
    } else {
        clearSearch()
    }
}

function clearSearch() {
    searchQuery.value = ''
}

// Helper function to get all files in a folder and its subfolders
function getAllFilesInFolder(folder) {
    const result = []
    const children = docStore.getChildren(folder.id)
    children.forEach(child => {
        if (child.type === 'file') {
            result.push(child)
        } else if (child.type === 'folder') {
            result.push(...getAllFilesInFolder(child))
        }
    })
    return result
}

// Helper function to get immediate files in a folder (non-recursive)
function getImmediateFiles(folder) {
    return docStore.getChildren(folder.id).filter(child => child.type === 'file')
}

// Helper function to check if text matches search query
function matchesSearch(text) {
    return text.toLowerCase().includes(searchQuery.value.toLowerCase())
}

// Get matching files for a specific folder
function getMatchingFilesForFolder(folder) {
    if (!searchQuery.value || !folder) return []
    if (matchesSearch(folder.name)) {
        return getImmediateFiles(folder)
    }
    return getAllFilesInFolder(folder).filter(file => matchesSearch(file.name))
}

// Check if a folder or its children match the search
function folderMatchesSearch(folder) {
    if (matchesSearch(folder.name)) return true
    const matchingFiles = getAllFilesInFolder(folder).filter(file => matchesSearch(file.name))
    if (matchingFiles.length > 0) return true
    const children = docStore.getChildren(folder.id)
    const subfolders = children.filter(child => child.type === 'folder')
    return subfolders.some(subfolder => folderMatchesSearch(subfolder))
}

const filteredStructure = computed(() => {
    if (!searchQuery.value) return []
    return rootItems.value.reduce((acc, item) => {
        if (item.type === 'folder') {
            if (folderMatchesSearch(item)) {
                acc.push(item)
            }
        } else if (item.type === 'file' && matchesSearch(item.name)) {
            acc.push(item)
        }
        return acc
    }, [])
})

// Create modal state
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')

function showCreateFileModal() {
    createType.value = 'File'
    showCreateModal.value = true
}

function showCreateFolderModal() {
    createType.value = 'Folder'
    showCreateModal.value = true
}

function confirmCreate() {
    if (newItemName.value.trim()) {
        if (createType.value === 'File') {
            docStore.createFile(newItemName.value)
        } else {
            docStore.createFolder(newItemName.value)
        }
        cancelCreate()
    }
}

function cancelCreate() {
    showCreateModal.value = false
    newItemName.value = ''
    createType.value = ''
}
</script>
