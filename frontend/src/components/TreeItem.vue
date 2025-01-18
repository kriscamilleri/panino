<template>
    <div>
        <!-- Context Menu -->
        <div v-if="showContextMenu" class="fixed bg-white shadow-lg rounded-lg border p-2 z-50"
            :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }">
            <button @click="handleDelete"
                class="w-full text-left px-3 py-1 hover:bg-red-100 text-red-600 rounded flex items-center space-x-1">
                <Trash2 class="w-4 h-4" />
                <span>Delete</span>
            </button>
            <div class="border-t my-1"></div>
            <button v-if="isFolder" @click="handleNewFile"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1">
                <FilePlus class="w-4 h-4" />
                <span>New File</span>
            </button>
            <button v-if="isFolder" @click="handleNewFolder"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1">
                <FolderPlus class="w-4 h-4" />
                <span>New Folder</span>
            </button>
        </div>

        <!-- FOLDER -->
        <div v-if="isFolder" class="flex items-center space-x-2 cursor-pointer group"
            @contextmenu.prevent="showMenu($event)">
            <span @click.stop="toggleLocalFolderState" class="flex items-center">
                <ChevronDown v-if="isOpen" class="w-4 h-4" />
                <ChevronRight v-else class="w-4 h-4" />
            </span>
            <span class="font-semibold flex-grow" @click.stop="toggleLocalFolderState">
                <Folder class="inline-block w-4 h-4 mr-1" />
                {{ item.name }}
                <span v-if="isFiltered && matchingFiles.length > 0" class="text-sm text-gray-500">
                    ({{ matchingFiles.length }} matches)
                </span>
            </span>
            <button v-if="!isFiltered" class="opacity-0 group-hover:opacity-100 px-2 hover:bg-gray-200 rounded"
                @click.stop="showMenu($event)">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!-- FILE -->
        <div v-else class="flex items-center space-x-2 cursor-pointer group" :class="{ 'ml-6': isFiltered }"
            @click="handleFileClick(item.id)" @contextmenu.prevent="showMenu($event)">
            <File class="w-4 h-4" />
            <span class="flex-grow">
                {{ item.name }}
            </span>
            <button v-if="!isFiltered" class="opacity-0 group-hover:opacity-100 px-2 hover:bg-gray-200 rounded"
                @click.stop="showMenu($event)">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!-- Child items -->
        <ul v-if="isFolder && isOpen" class="ml-6 mt-1 border-l pl-2">
            <template v-if="isFiltered">
                <li v-for="file in matchingFiles" :key="file.id" class="mb-1">
                    <TreeItem :item="file" :is-filtered="true" />
                </li>
            </template>
            <template v-else>
                <li v-for="child in children" :key="child.id" class="mb-1">
                    <TreeItem :item="child" :is-filtered="false" />
                </li>
            </template>
        </ul>

        <!-- Create New Modal -->
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
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useDocStore } from '@/store/docStore'
import TreeItem from './TreeItem.vue'

// Import necessary Lucide icons
import {
    Trash2,
    FilePlus,
    FolderPlus,
    MoreHorizontal,
    ChevronRight,
    ChevronDown,
    Folder,
    File
} from 'lucide-vue-next'

const props = defineProps({
    item: { type: Object, required: true },
    isFiltered: { type: Boolean, default: false },
    matchingFiles: { type: Array, default: () => [] }
})

const docStore = useDocStore()

// Type checks
const isFolder = computed(() => props.item.type === 'folder')
const isFile = computed(() => props.item.type === 'file')

// Local folder state for filtered view
const localFolderState = ref(true)

// Folder open state
const isOpen = computed(() => {
    if (!isFolder.value) return false
    return props.isFiltered
        ? localFolderState.value
        : docStore.openFolders.has(props.item.id)
})

// Context menu state
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

// Create modal state
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')

// Get child items for folders
const children = computed(() => {
    if (isFolder.value) {
        return docStore.getChildren(props.item.id)
    }
    return []
})

// Event Handlers
function toggleLocalFolderState() {
    if (props.isFiltered) {
        localFolderState.value = !localFolderState.value
    } else {
        docStore.toggleFolder(props.item.id)
    }
}

function handleFileClick(fileId) {
    docStore.selectFile(fileId)
}

function showMenu(event) {
    if (!props.isFiltered) {
        contextMenuX.value = event.clientX
        contextMenuY.value = event.clientY
        showContextMenu.value = true
    }
}

function handleDelete() {
    if (confirm(`Are you sure you want to delete ${props.item.name}?`)) {
        docStore.deleteItem(props.item.id)
    }
    showContextMenu.value = false
}

function handleNewFile() {
    createType.value = 'File'
    showCreateModal.value = true
    showContextMenu.value = false
}

function handleNewFolder() {
    createType.value = 'Folder'
    showCreateModal.value = true
    showContextMenu.value = false
}

function confirmCreate() {
    if (newItemName.value.trim()) {
        if (createType.value === 'File') {
            docStore.createFile(newItemName.value, props.item.id)
        } else {
            docStore.createFolder(newItemName.value, props.item.id)
        }
        cancelCreate()
    }
}

function cancelCreate() {
    showCreateModal.value = false
    newItemName.value = ''
    createType.value = ''
}

// Close context menu when clicking outside
function handleClickOutside() {
    if (showContextMenu.value) {
        showContextMenu.value = false
    }
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
})
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
})
</script>
