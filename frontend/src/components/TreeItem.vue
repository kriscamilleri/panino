<template>
    <div>
        <!-- Context Menu -->
        <div v-if="showContextMenu" class="fixed bg-white shadow-lg rounded-lg border p-2 z-50"
            :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
            :data-testid="`tree-item-context-menu-${item.id}`">
            <!-- Rename -->
            <button @click="handleRename"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-rename-${item.id}`">
                <Edit class="w-4 h-4" />
                <span>Rename</span>
            </button>

            <div class="border-t my-1"></div>

            <!-- Delete -->
            <button @click="handleDelete"
                class="w-full text-left px-3 py-1 hover:bg-red-100 text-red-600 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-delete-${item.id}`">
                <Trash2 class="w-4 h-4" />
                <span>Delete</span>
            </button>

            <div class="border-t my-1"></div>

            <!-- New File / New Folder -->
            <button v-if="isFolder" @click="handleNewFile"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-new-file-${item.id}`">
                <FilePlus class="w-4 h-4" />
                <span>New File</span>
            </button>
            <button v-if="isFolder" @click="handleNewFolder"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-new-folder-${item.id}`">
                <FolderPlus class="w-4 h-4" />
                <span>New Folder</span>
            </button>
        </div>

        <!-- FOLDER -->
        <div v-if="isFolder" class="flex items-center space-x-2 group rounded-md py-1 md:my-1  cursor-pointer" :class="{
            'bg-gray-700 text-white': isSelectedFolder,
            'bg-gray-600 text-white': isParentOfSelectedFile,
            'hover:bg-gray-100': !isSelectedFolder && !isParentOfSelectedFile // Add hover for non-selected folders
        }" @click.stop="handleFolderClick" :data-testid="`tree-item-folder-${item.id}`">
            <!-- Arrow toggles open/close -->
            <span @click.stop="toggleLocalFolderState" class="cursor-pointer ml-1 p-1 rounded hover:bg-gray-300"
                :data-testid="`tree-item-folder-toggle-${item.id}`">
                <ChevronDown v-if="isOpen" class="w-4 h-4" />
                <ChevronRight v-else class="w-4 h-4" />
            </span>
            <!-- Clicking the name will select the folder -->
            <span class="font-semibold flex-grow truncate" :data-testid="`tree-item-folder-name-${item.id}`">
                <!-- Added truncate -->
                <Folder class="inline-block w-4 h-4 mr-1" />
                {{ item.name }}
            </span>
            <!-- "More" button -->
            <button v-if="!isFiltered" class="transition-opacity px-2 rounded flex-shrink-0" :class="{
                'opacity-100': shouldShowContextButton,
                'opacity-0 group-hover:opacity-100 focus-within:opacity-100': !shouldShowContextButton // Show on focus too
            }" @click.stop="showMenu($event)" :data-testid="`tree-item-folder-menu-${item.id}`">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!-- FILE -->
        <div v-else class="flex items-center space-x-2 cursor-pointer group rounded-md pl-1 hover:bg-gray-100" :class="{
            'ml-6': isFiltered, // Indent filtered files
            'bg-gray-200 hover:bg-gray-300': isSelectedFile // Highlight selected file
        }" @click="handleFileClick(item.id)" @contextmenu.prevent="showMenu($event)"
            :data-testid="`tree-item-file-${item.id}`">
            <File class="w-4 h-4 ml-1 flex-shrink-0" /> <!-- Added flex-shrink-0 -->
            <span class="flex-grow truncate" :data-testid="`tree-item-file-name-${item.id}`"> <!-- Added truncate -->
                {{ item.name }}
            </span>
            <!-- "More" button for file -->
            <button v-if="!isFiltered" class="transition-opacity px-2 rounded flex-shrink-0" :class="{
                'opacity-100': isSelectedFile,
                'opacity-0 group-hover:opacity-100 focus-within:opacity-100': !isSelectedFile // Show on focus too
            }" @click.stop="showMenu($event)" :data-testid="`tree-item-file-menu-${item.id}`">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!-- Child items -->
        <ul v-if="isFolder && isOpen" class="ml-6 mt-1 border-l pl-2">
            <template v-if="isFiltered">
                <!-- Display matching files directly if filtered -->
                <li v-for="file in matchingFiles" :key="file.id" class="mb-1">
                    <TreeItem :item="file" :is-filtered="true" />
                </li>
                <!-- If folder matches but no specific files do, show its children -->
                <li v-if="matchingFiles.length === 0 && children.some(c => c.type === 'file')">
                    <div class="text-xs text-gray-500 pl-2">(Files inside matching folder)</div>
                    <TreeItem v-for="child in children.filter(c => c.type === 'file')" :key="child.id" :item="child"
                        :is-filtered="true" />
                </li>
            </template>
            <template v-else>
                <li v-for="child in children" :key="child.id" class="mb-1">
                    <TreeItem :item="child" :is-filtered="false" />
                </li>
            </template>
        </ul>

        <!-- Create New Modal -->
        <div v-if="showCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            :data-testid="`tree-item-create-modal-${item.id}`">
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">
                    Create New {{ createType }} in "{{ item.name }}"
                </h3>
                <input v-model="newItemName" type="text" class="w-full border rounded p-2 mb-4"
                    :placeholder="'Enter ' + createType + ' name'" @keyup.enter="confirmCreate"
                    :data-testid="`tree-item-create-modal-input-${item.id}`" ref="createInputRef" />
                <div class="flex justify-end space-x-2">
                    <button @click="cancelCreate" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        :data-testid="`tree-item-create-modal-cancel-${item.id}`">
                        Cancel
                    </button>
                    <button @click="confirmCreate" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        :data-testid="`tree-item-create-modal-confirm-${item.id}`">
                        Create
                    </button>
                </div>
            </div>
        </div>

        <!-- Rename Modal -->
        <div v-if="showRenameModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            :data-testid="`tree-item-rename-modal-${item.id}`">
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">Rename {{ renameType }}</h3>
                <input v-model="renameItemName" type="text" class="w-full border rounded p-2 mb-4"
                    @keyup.enter="confirmRename" :placeholder="'Enter new ' + renameType + ' name'"
                    :data-testid="`tree-item-rename-modal-input-${item.id}`" ref="renameInputRef" />
                <div class="flex justify-end space-x-2">
                    <button @click="cancelRename" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        :data-testid="`tree-item-rename-modal-cancel-${item.id}`">
                        Cancel
                    </button>
                    <button @click="confirmRename" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        :data-testid="`tree-item-rename-modal-confirm-${item.id}`">
                        Rename
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue' // Added nextTick
import { useDocStore } from '@/store/docStore'
import TreeItem from './TreeItem.vue' // Self-reference for recursion

import {
    Trash2,
    FilePlus,
    FolderPlus,
    MoreHorizontal,
    ChevronRight,
    ChevronDown,
    Folder,
    File,
    Edit
} from 'lucide-vue-next'

const props = defineProps({
    item: { type: Object, required: true },
    isFiltered: { type: Boolean, default: false },
    matchingFiles: { type: Array, default: () => [] }
})

const docStore = useDocStore()

// Type checks
const isFolder = computed(() => props.item.type === 'folder')

// Local open state for folder in filtered mode (default to open if filtered)
const localFolderState = ref(props.isFiltered)

const isOpen = computed(() => {
    if (!isFolder.value) return false
    // Always open if filtered, otherwise use global state
    return props.isFiltered ? localFolderState.value : docStore.openFolders.has(props.item.id)
})

// Return true if the user is “selecting” this file
const isSelectedFile = computed(() => {
    return !isFolder.value && docStore.selectedFileId === props.item.id
})

// Return true if this folder is “selected”
const isSelectedFolder = computed(() => {
    // Folder is selected if its ID matches selectedFolderId OR if no folder is explicitly selected but a file inside it IS selected
    return isFolder.value && (docStore.selectedFolderId === props.item.id || (!docStore.selectedFolderId && isParentOfSelectedFile.value))
})


// Return true if it is the parent of the currently selected file
const isParentOfSelectedFile = computed(() => {
    if (!isFolder.value) return false
    const selFile = docStore.selectedFile
    if (!selFile) return false
    return selFile.parentId === props.item.id
})

// We only show the “More” button for a folder if it is either selected or is the parent of the selected file
const shouldShowContextButton = computed(() => {
    return isSelectedFolder.value || isParentOfSelectedFile.value || isSelectedFile.value; // Show for selected file too
})

// Context menu state
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

// Child items
const children = computed(() => {
    if (isFolder.value) {
        return docStore.getChildren(props.item.id)
    }
    return []
})

// Refs for modal inputs
const createInputRef = ref(null)
const renameInputRef = ref(null)

// Create modal
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')

// Rename modal
const showRenameModal = ref(false)
const renameType = ref('')
const renameItemName = ref('')

// Folder toggling / selection
function toggleLocalFolderState() {
    // Only toggle local state if filtered
    if (props.isFiltered) {
        localFolderState.value = !localFolderState.value
    } else {
        docStore.toggleFolder(props.item.id)
    }
}
function handleFolderClick() {
    docStore.selectFolder(props.item.id)
}

// File selection
function handleFileClick(fileId) {
    docStore.selectFile(fileId)
}

// Context menu
function showMenu(event) {
    if (props.isFiltered) return // Disable context menu in filtered view for simplicity
    contextMenuX.value = event.clientX
    contextMenuY.value = event.clientY
    showContextMenu.value = true
    // Prevent browser default context menu
    event.preventDefault();
}

function handleDelete() {
    // Add check for welcome file/folder (assuming ID 'welcome' or starts with 'welcome-')
    if (props.item.id === 'welcome' || props.item.id.startsWith('welcome-')) {
        alert("The default 'Welcome' item cannot be deleted.");
        showContextMenu.value = false;
        return;
    }

    if (confirm(`Are you sure you want to delete "${props.item.name}"? This cannot be undone.`)) { // Stronger warning
        docStore.deleteItem(props.item.id)
    }
    showContextMenu.value = false
}

function handleNewFile() {
    createType.value = 'File'
    showCreateModal.value = true
    showContextMenu.value = false
    nextTick(() => createInputRef.value?.focus()) // Focus input on modal open
}

function handleNewFolder() {
    createType.value = 'Folder'
    showCreateModal.value = true
    showContextMenu.value = false
    nextTick(() => createInputRef.value?.focus()) // Focus input on modal open
}

function confirmCreate() {
    if (newItemName.value.trim()) {
        if (createType.value === 'File') {
            // Pass parent ID (which is props.item.id for folders)
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

// Rename
function handleRename() {
    // Add check for welcome file/folder
    if (props.item.id === 'welcome' || props.item.id.startsWith('welcome-')) {
        alert("The default 'Welcome' item cannot be renamed.");
        showContextMenu.value = false;
        return;
    }
    renameType.value = props.item.type
    renameItemName.value = props.item.name
    showRenameModal.value = true
    showContextMenu.value = false
    nextTick(() => renameInputRef.value?.focus()) // Focus input on modal open
}
function confirmRename() {
    const trimmedName = renameItemName.value.trim()
    if (trimmedName && trimmedName !== props.item.name) { // Only rename if name changed
        docStore.renameItem(props.item.id, trimmedName)
    }
    cancelRename()
}
function cancelRename() {
    showRenameModal.value = false
    renameItemName.value = ''
    renameType.value = ''
}

// Close context menu on outside click
function handleClickOutside(event) {
    // Check if the click was outside the context menu itself
    const contextMenuElement = document.querySelector(`[data-testid="tree-item-context-menu-${props.item.id}"]`);
    if (showContextMenu.value && contextMenuElement && !contextMenuElement.contains(event.target)) {
        // Check if the click was on the button that opened the menu
        const menuButton = document.querySelector(`[data-testid="tree-item-${isFolder.value ? 'folder' : 'file'}-menu-${props.item.id}"]`);
        if (!menuButton || !menuButton.contains(event.target)) {
            showContextMenu.value = false
        }
    }
}
onMounted(() => {
    document.addEventListener('click', handleClickOutside, true) // Use capture phase
})
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside, true) // Use capture phase
})
</script>

<style scoped>
/* Add ellipsis for long names */
.truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
