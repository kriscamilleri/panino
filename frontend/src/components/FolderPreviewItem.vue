<!-- frontend/src/components/FolderPreviewItem.vue -->
<template>
    <li>
        <div
            class="px-3 py-3 rounded-md"
            :class="fileRowClasses"
            role="button"
            tabindex="0"
            @click="handleRowClick"
            @keydown.enter.prevent="handleRowClick"
            @keydown.space.prevent="handleRowClick"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="flex items-center min-w-0 gap-2">
                    <FolderIcon
                        v-if="item.type === 'folder'"
                        class="w-4 h-4 text-gray-500 shrink-0"
                    />
                    <FileIcon
                        v-else
                        class="w-4 h-4 text-gray-500 shrink-0"
                    />

                    <span
                        v-if="item.type === 'folder'"
                        class="font-semibold truncate"
                    >
                        {{ item.name }}
                    </span>

                    <span
                        v-else
                        class="text-blue-600 font-medium truncate"
                        :data-testid="`folder-preview-file-link-${item.id}`"
                    >
                        {{ item.name }}
                    </span>
                </div>

                <span
                    v-if="item.type === 'file'"
                    class="text-xs text-gray-500 whitespace-nowrap"
                    :title="item.displayedDate ? fmt(item.displayedDate) : ''"
                    :data-testid="`folder-preview-file-updated-${item.id}`"
                >
                    {{ item.displayedDate ? fmtRelative(item.displayedDate) : 'Unknown update time' }}
                </span>
            </div>

            <div
                v-if="item.type === 'file' && variant === 'recent'"
                class="mt-1 text-xs text-gray-500 flex items-center gap-1 min-w-0"
            >
                <span
                    class="text-gray-400 truncate max-w-[16rem] sm:max-w-[22rem]"
                    :title="item.folderName"
                    :data-testid="`folder-preview-file-folder-${item.id}`"
                >
                    {{ item.folderName }}
                </span>
                <span class="mx-1">•</span>
                <span :data-testid="`folder-preview-file-wordcount-${item.id}`">{{ formatWordCount(item.wordCount) }} words</span>
            </div>
        </div>

        <!-- children -->
        <ul
            v-if="item.type === 'folder' && item.children?.length"
            class="ml-6"
        >
            <FolderPreviewItem
                v-for="child in item.children"
                :key="child.id"
                :item="child"
            />
        </ul>
    </li>
</template>

<script setup>
defineOptions({ name: 'FolderPreviewItem' })   // allow recursion

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { Folder as FolderIcon, File as FileIcon } from 'lucide-vue-next'

const props = defineProps({
    item: { type: Object, required: true },
    variant: { type: String, default: 'folder' }
})

const router = useRouter()
const docStore = useDocStore()
const draftStore = useDraftStore()

const fileRowClasses = computed(() => {
    return 'cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-inset'
})

function fmt(s) { return new Date(s).toLocaleString() }

function formatWordCount(wordCount) {
    return new Intl.NumberFormat().format(wordCount || 0)
}

function fmtRelative(d) {
    const target = new Date(d)
    if (Number.isNaN(target.getTime())) return 'Unknown update time'

    const secondsDiff = Math.round((target.getTime() - Date.now()) / 1000)
    const absoluteSeconds = Math.abs(secondsDiff)
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

    if (absoluteSeconds < 60) return rtf.format(secondsDiff, 'second')
    if (absoluteSeconds < 3600) return rtf.format(Math.round(secondsDiff / 60), 'minute')
    if (absoluteSeconds < 86400) return rtf.format(Math.round(secondsDiff / 3600), 'hour')
    if (absoluteSeconds < 604800) return rtf.format(Math.round(secondsDiff / 86400), 'day')

    return fmt(d)
}

async function openFolder(id) {
    await docStore.selectFolder(id)
    router.push({ name: 'folder', params: { folderId: id } })
}

async function openFile(id) {
    draftStore.clearDraft(id)
    await docStore.selectFile(id)
    router.push({ name: 'doc', params: { fileId: id } })
}

function handleRowClick() {
    if (props.item.type === 'folder') {
        openFolder(props.item.id)
        return
    }
    openFile(props.item.id)
}
</script>
