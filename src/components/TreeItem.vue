<template>
    <div>
        <!-- FOLDER -->
        <div v-if="isFolder" class="flex items-center space-x-2 cursor-pointer">
            <span @click.stop="toggleFolderExpand(item.id)">
                <!-- Show “▼” if expanded, “►” if collapsed -->
                <span v-if="folderOpen">▼</span>
                <span v-else>►</span>
            </span>
            <span class="font-semibold" @click.stop="toggleFolderExpand(item.id)">
                📁 {{ item.name }}
            </span>
        </div>

        <!-- FILE -->
        <div v-else-if="isFile" class="flex items-center space-x-2 cursor-pointer" @click="handleFileClick(item.id)">
            <span>📄</span>
            <span>{{ item.name }}</span>
        </div>

        <!-- Child items, only show if folder is open -->
        <ul v-if="isFolder && folderOpen" class="ml-6 mt-1 border-l pl-2">
            <li v-for="child in children" :key="child.id" class="mb-1">
                <TreeItem :item="child" />
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'

const props = defineProps({
    item: { type: Object, required: true }
})

const docStore = useDocStore()

// Is this item a folder or a file?
const isFolder = computed(() => props.item.type === 'folder')
const isFile = computed(() => props.item.type === 'file')

// Is this folder currently open?
const folderOpen = computed(() => {
    if (!isFolder.value) return false
    return docStore.openFolders.has(props.item.id)
})

// Toggle folder open/closed
function toggleFolderExpand(folderId) {
    docStore.toggleFolder(folderId)
}

// If item is a folder, get its children
const children = computed(() => {
    if (isFolder.value) {
        return docStore.getChildren(props.item.id)
    }
    return []
})

function handleFileClick(fileId) {
    docStore.selectFile(fileId)
}
</script>