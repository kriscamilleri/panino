<template>
    <div class="h-full flex flex-col">
        <div class="flex justify-between items-center mb-4">
            <h2 class="font-bold text-lg">Documents</h2>
            <div class="flex space-x-2">
                <button @click="showCreateFileModal" class="p-2 hover:bg-gray-100 rounded" title="New File">
                    📄+
                </button>
                <button @click="showCreateFolderModal" class="p-2 hover:bg-gray-100 rounded" title="New Folder">
                    📁+
                </button>
            </div>
        </div>

        <!-- File Tree -->
        <div class="flex-1 overflow-y-auto">
            <ul class="space-y-1">
                <li v-for="item in rootItems" :key="item.id">
                    <TreeItem :item="item" />
                </li>
            </ul>
        </div>

        <!-- Create Modal -->
        <div v-if="showCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white p-4 rounded-lg shadow-lg w-96">
                <h3 class="text-lg font-semibold mb-4">Create New {{ createType }}</h3>
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
import { computed, ref } from 'vue'
import { useDocStore } from '@/store/docStore'
import TreeItem from './TreeItem.vue'

const docStore = useDocStore()
const rootItems = computed(() => docStore.rootItems)

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