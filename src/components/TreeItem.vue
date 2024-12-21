<template>
    <div>
        <div v-if="item.type === 'folder'" class="font-semibold cursor-pointer flex items-center space-x-2">
            <span>📁</span>
            <span>{{ item.name }}</span>
        </div>
        <div v-else-if="item.type === 'file'" class="cursor-pointer flex items-center space-x-2"
            @click="handleFileClick(item.id)">
            <span>📄</span>
            <span>{{ item.name }}</span>
        </div>

        <!-- Recurse into children if folder -->
        <ul v-if="item.type === 'folder'" class="ml-5 mt-2">
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
    item: {
        type: Object,
        required: true
    }
})

const docStore = useDocStore()

// Retrieve children of this folder
const children = computed(() => {
    if (props.item.type === 'folder') {
        return docStore.getChildren(props.item.id)
    }
    return []
})

// When a file is clicked, select it
function handleFileClick(fileId) {
    docStore.selectFile(fileId)
}
</script>

<style scoped>
/* Slight indentation or styling for nested items is done by "ml-5" etc. */
</style>