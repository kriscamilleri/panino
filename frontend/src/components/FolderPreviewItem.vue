<!-- frontend/src/components/FolderPreviewItem.vue -->
<template>
    <li class="mb-1">
        <!-- row -->
        <div class="flex items-center">
            <FolderIcon v-if="item.type === 'folder'" class="w-4 h-4 mr-1 text-gray-700" />
            <FileIcon v-else class="w-4 h-4 mr-1 text-gray-700" />

            <span v-if="item.type === 'folder'" class="font-semibold cursor-pointer hover:underline"
                @click="openFolder(item.id)">
                {{ item.name }}
            </span>

            <a v-else href="#" class="text-blue-600 underline" @click.prevent="openFile(item.id)">
                {{ item.name }}
            </a>

            <span v-if="item.type === 'file'" class="ml-2 text-sm text-gray-500">
                Last&nbsp;Modified:
                {{ item.displayedDate ? fmt(item.displayedDate) : '' }}
            </span>
        </div>

        <!-- children -->
        <ul v-if="item.type === 'folder' && item.children?.length" class="ml-6">
            <FolderPreviewItem v-for="child in item.children" :key="child.id" :item="child" />
        </ul>
    </li>
</template>

<script setup>
defineOptions({ name: 'FolderPreviewItem' })   // allow recursion

import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { Folder as FolderIcon, File as FileIcon } from 'lucide-vue-next'

const props = defineProps({
    item: { type: Object, required: true }
})

const router = useRouter()
const docStore = useDocStore()
const draftStore = useDraftStore()

function fmt(s) { return new Date(s).toLocaleString() }

async function openFolder(id) {
    await docStore.selectFolder(id)
    router.push({ name: 'folder', params: { folderId: id } })
}

async function openFile(id) {
    draftStore.clearDraft(id)
    await docStore.selectFile(id)
    router.push({ name: 'doc', params: { fileId: id } })
}
</script>