<template>
    <div>
        <!--───────────────────────── Context-menu ─────────────────────────-->
        <div v-if="showContextMenu" class="fixed bg-white shadow-lg rounded-lg border p-2 z-50"
            :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
            :data-testid="`tree-item-context-menu-${item.id}`">
            <!-- Rename -->
            <button @click="handleRename"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-rename-${item.id}`">
                <Edit class="w-4 h-4" /><span>Rename</span>
            </button>

            <div class="border-t my-1" />

            <!-- Delete -->
            <button @click="handleDelete"
                class="w-full text-left px-3 py-1 hover:bg-red-100 text-red-600 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-delete-${item.id}`">
                <Trash2 class="w-4 h-4" /><span>Delete</span>
            </button>

            <div class="border-t my-1" />

            <!-- New in folder -->
            <button v-if="isFolder" @click="handleNewFile"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-new-file-${item.id}`">
                <FilePlus class="w-4 h-4" /><span>New File</span>
            </button>
            <button v-if="isFolder" @click="handleNewFolder"
                class="w-full text-left px-3 py-1 hover:bg-gray-100 rounded flex items-center space-x-1"
                :data-testid="`tree-item-context-menu-new-folder-${item.id}`">
                <FolderPlus class="w-4 h-4" /><span>New Folder</span>
            </button>
        </div>

        <!--───────────────────────── Folder row ─────────────────────────-->
        <div v-if="isFolder" class="flex items-center space-x-2 group rounded-md py-1 md:my-1 cursor-pointer" :class="{
            'bg-gray-700 text-white': isSelectedFolder,
            'bg-gray-600 text-white': isParentOfSelectedFile,
            'hover:bg-gray-100': !isSelectedFolder && !isParentOfSelectedFile
        }" draggable="true" @dragstart="handleDragStart" @dragover.prevent.stop @drop.prevent.stop="handleDrop"
            @click.stop="handleFolderClick" :data-testid="`tree-item-folder-${item.id}`">

            <span @click.stop="toggleLocalFolderState" class="cursor-pointer ml-1 p-1 rounded hover:bg-gray-300"
                :data-testid="`tree-item-folder-toggle-${item.id}`">
                <ChevronDown v-if="isOpen" class="w-4 h-4" />
                <ChevronRight v-else class="w-4 h-4" />
            </span>

            <span class="font-semibold flex-grow truncate" :data-testid="`tree-item-folder-name-${item.id}`">
                <Folder class="inline-block w-4 h-4 mr-1" />{{ item.name }}
            </span>

            <button v-if="!isFiltered" class="transition-opacity px-2 rounded flex-shrink-0" :class="{
                'opacity-100': shouldShowContextButton,
                'opacity-0 group-hover:opacity-100 focus-within:opacity-100': !shouldShowContextButton
            }" @click.stop="showMenu($event)" :data-testid="`tree-item-folder-menu-${item.id}`">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!--───────────────────────── File row ─────────────────────────-->
        <div v-else class="flex items-center space-x-2 cursor-pointer group rounded-md pl-1 hover:bg-gray-100" :class="{
            'ml-6': isFiltered,
            'bg-gray-200 hover:bg-gray-300': isSelectedFile
        }" draggable="true" @dragstart="handleDragStart" @dragover.prevent @click="handleFileClick(item.id)"
            @contextmenu.prevent="showMenu($event)" :data-testid="`tree-item-file-${item.id}`">

            <File class="w-4 h-4 ml-1 flex-shrink-0" />
            <span class="flex-grow truncate" :data-testid="`tree-item-file-name-${item.id}`">{{ item.name }}</span>

            <button v-if="!isFiltered" class="transition-opacity px-2 rounded flex-shrink-0" :class="{
                'opacity-100': isSelectedFile,
                'opacity-0 group-hover:opacity-100 focus-within:opacity-100': !isSelectedFile
            }" @click.stop="showMenu($event)" :data-testid="`tree-item-file-menu-${item.id}`">
                <MoreHorizontal class="w-4 h-4" />
            </button>
        </div>

        <!--───────────────────────── Children list ─────────────────────────-->
        <ul v-if="isFolder && isOpen" class="ml-6 mt-1 border-l pl-2">
            <template v-if="isFiltered">
                <li v-for="file in matchingFiles" :key="file.id" class="mb-1">
                    <TreeItem :item="file" :is-filtered="true" />
                </li>
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

        <!--───────────────────────── Create-new Modal ─────────────────────────-->
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

        <!--───────────────────────── Rename Modal ─────────────────────────-->
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
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useStructureStore } from '@/store/structureStore'

import {
    Trash2, FilePlus, FolderPlus, MoreHorizontal,
    ChevronRight, ChevronDown, Folder, File, Edit
} from 'lucide-vue-next'

const props = defineProps({
    item: { type: Object, required: true },
    isFiltered: { type: Boolean, default: false },
    matchingFiles: { type: Array, default: () => [] }
})

const docStore = useDocStore()
const structureStore = useStructureStore()
const router = useRouter()

const isFolder = computed(() => props.item.type === 'folder')
const localFolderState = ref(props.isFiltered)
const isOpen = computed(() =>
    isFolder.value
        ? (props.isFiltered ? localFolderState.value : docStore.openFolders.has(props.item.id))
        : false)

const isSelectedFile = computed(() =>
    !isFolder.value && docStore.selectedFileId === props.item.id)

const isParentOfSelectedFile = computed(() => {
    if (!isFolder.value) return false
    const selFile = docStore.selectedFile
    return selFile ? selFile.parentId === props.item.id : false
})

const isSelectedFolder = computed(() =>
    isFolder.value && (
        docStore.selectedFolderId === props.item.id ||
        (!docStore.selectedFolderId && isParentOfSelectedFile.value)
    ))

const shouldShowContextButton = computed(() =>
    isSelectedFolder.value || isParentOfSelectedFile.value || isSelectedFile.value)

const children = computed(() =>
    isFolder.value ? docStore.getChildren(props.item.id) : [])

/* ──────────────────────────────
   ▸ DRAG-AND-DROP
────────────────────────────── */
function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-item-id', props.item.id)
}

function handleDrop(e) {
    const draggedId = e.dataTransfer.getData('application/x-item-id')
    if (!draggedId) return
    if (draggedId === props.item.id) return
    structureStore.moveItem(draggedId, props.item.id)
}

/* ──────────────────────────────
   ▸ FOLDER / FILE CLICK
────────────────────────────── */
function toggleLocalFolderState() {
    props.isFiltered
        ? (localFolderState.value = !localFolderState.value)
        : docStore.toggleFolder(props.item.id)
}

function handleFolderClick() {
    // navigate to folder route
    router.push({ name: 'folder', params: { folderId: props.item.id } })
}

function handleFileClick(id) {
    // navigate to file route
    router.push({ name: 'doc', params: { fileId: id } })
}

/* ──────────────────────────────
   ▸ CONTEXT-MENU & MODALS
   (all logic identical to original file, unchanged)
────────────────────────────── */
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

function showMenu(event) {
    if (props.isFiltered) return
    contextMenuX.value = event.clientX
    contextMenuY.value = event.clientY
    showContextMenu.value = true
    event.preventDefault()
}

function handleDelete() {
    if (props.item.id === 'welcome' || props.item.id.startsWith('welcome-')) {
        alert("The default 'Welcome' item cannot be deleted.")
        showContextMenu.value = false
        return
    }
    if (confirm(`Delete "${props.item.name}"? This cannot be undone.`)) {
        docStore.deleteItem(props.item.id)
    }
    showContextMenu.value = false
}

/* create-modal */
const showCreateModal = ref(false)
const createType = ref('')
const newItemName = ref('')
const createInputRef = ref(null)

function handleNewFile() { openCreate('File') }
function handleNewFolder() { openCreate('Folder') }
function openCreate(type) {
    createType.value = type
    showCreateModal.value = true
    showContextMenu.value = false
    nextTick(() => createInputRef.value?.focus())
}
function confirmCreate() {
    if (!newItemName.value.trim()) return
    createType.value === 'File'
        ? docStore.createFile(newItemName.value, props.item.id)
        : docStore.createFolder(newItemName.value, props.item.id)
    cancelCreate()
}
function cancelCreate() {
    showCreateModal.value = false
    newItemName.value = ''
    createType.value = ''
}

/* rename-modal */
const showRenameModal = ref(false)
const renameType = ref('')
const renameItemName = ref('')
const renameInputRef = ref(null)

function handleRename() {
    if (props.item.id === 'welcome' || props.item.id.startsWith('welcome-')) {
        alert("The default 'Welcome' item cannot be renamed.")
        showContextMenu.value = false
        return
    }
    renameType.value = props.item.type
    renameItemName.value = props.item.name
    showRenameModal.value = true
    showContextMenu.value = false
    nextTick(() => renameInputRef.value?.focus())
}
function confirmRename() {
    const trimmed = renameItemName.value.trim()
    if (trimmed && trimmed !== props.item.name) {
        docStore.renameItem(props.item.id, trimmed)
    }
    cancelRename()
}
function cancelRename() {
    showRenameModal.value = false
    renameItemName.value = ''
    renameType.value = ''
}

function handleClickOutside(e) {
    const menuEl = document.querySelector(`[data-testid="tree-item-context-menu-${props.item.id}"]`)
    if (!showContextMenu.value || !menuEl) return
    if (!menuEl.contains(e.target)) showContextMenu.value = false
}
onMounted(() => document.addEventListener('click', handleClickOutside, true))
onUnmounted(() => document.removeEventListener('click', handleClickOutside, true))
</script>

<style scoped>
.truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
