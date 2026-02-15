<template>
    <div class="flex-1 overflow-hidden p-4">
        <h2
            v-if="isRecentView"
            class="text-xl font-bold mb-2"
            data-testid="folder-preview-recent-heading"
        >
            Recent&nbsp;Documents
        </h2>

        <h2
            v-else
            class="text-xl font-bold mb-2"
            :data-testid="`folder-preview-name-${folderId}`"
        >
            {{ folderName }}
        </h2>

        <template v-if="isRecentView">
            <div
                v-if="recentFiles.length === 0"
                class="text-gray-500"
                data-testid="folder-preview-recent-empty"
            >
                No recent documents yet.
            </div>
            <ul
                v-else
                class="max-w-3xl"
            >
                <FolderPreviewItem
                    v-for="file in recentFiles"
                    :key="file.id"
                    :item="file"
                    variant="recent"
                />
            </ul>
        </template>

        <template v-else-if="isLoading">
            <div class="text-gray-500">Loading folder contents...</div>
        </template>
        <template v-else>
            <ul class="max-w-3xl">
                <FolderPreviewItem
                    v-for="node in treeData"
                    :key="node.id"
                    :item="node"
                />
            </ul>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue'

import FolderPreviewItem from '@/components/FolderPreviewItem.vue'
import { useDocStore } from '@/store/docStore'

/* ───────── Props ───────── */
const props = defineProps({
    folderId: { type: String, default: null }
})

/* ───────── Stores / router ───────── */
const docStore = useDocStore()


/* ───────── Helpers ───────── */
const isRecentView = computed(() => props.folderId === '__recent__')
const isLoading = ref(false);
const folderName = ref('Folder')

watchEffect(async () => {
    if (isRecentView.value || !props.folderId) {
        folderName.value = ''
        return
    }

    const result = await docStore.syncStore.execute('SELECT name FROM folders WHERE id = ?', [props.folderId])
    folderName.value = result?.[0]?.name || 'Folder'
})

/* ───────── Recent Docs (reactive) ───────── */
const recentFiles = ref([])

watchEffect(async () => {
    if (!isRecentView.value) return
    recentFiles.value = await docStore.getRecentDocuments(10)
})

/* ───────── Folder Tree (now async) ───────── */
const treeData = ref([])

watchEffect(async () => {
    if (isRecentView.value || !props.folderId) {
        treeData.value = [];
        return;
    }

    isLoading.value = true;

    // recursive asynchronous builder
    async function build(id) {
        const children = await docStore.getChildren(id);

        children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name)
            return a.type === 'folder' ? -1 : 1
        });

        const processedChildren = [];
        for (const c of children) {
            if (c.type === 'folder') {
                processedChildren.push({
                    id: c.id,
                    type: 'folder',
                    name: c.name,
                    children: await build(c.id)
                });
            } else {
                // Fetch full note details to get updated_at
                const noteResult = await docStore.syncStore.execute('SELECT updated_at, created_at FROM notes WHERE id = ?', [c.id]);
                const note = noteResult?.[0];

                processedChildren.push({
                    id: c.id,
                    type: 'file',
                    name: c.name,
                    displayedDate: note?.updated_at || note?.created_at || ''
                });
            }
        }
        return processedChildren;
    }

    treeData.value = await build(props.folderId)
    isLoading.value = false;
})

</script>
