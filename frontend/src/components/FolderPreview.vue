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
            <ul>
                <li
                    v-for="file in recentFiles"
                    :key="file.id"
                    class="mb-2"
                >
                    <a
                        href="#"
                        class="text-blue-600 underline"
                        @click.prevent="openFile(file.id)"
                        :data-testid="`folder-preview-file-link-${file.id}`"
                    >
                        {{ file.name }}
                    </a>
                    <span class="ml-2 text-sm text-gray-500">
                        Last&nbsp;Modified:
                        {{ format(file.displayedDate) }}
                    </span>
                </li>
            </ul>
        </template>

        <template v-else-if="isLoading">
            <div class="text-gray-500">Loading folder contents...</div>
        </template>
        <template v-else>
            <ul>
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
import { ref, computed, watchEffect, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import FolderPreviewItem from '@/components/FolderPreviewItem.vue'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { storeToRefs } from 'pinia';

/* ───────── Props ───────── */
const props = defineProps({
    folderId: { type: String, default: null }
})

/* ───────── Stores / router ───────── */
const docStore = useDocStore()
const draftStore = useDraftStore()
const router = useRouter()
const { rootItems } = storeToRefs(docStore);


/* ───────── Helpers ───────── */
const isRecentView = computed(() => props.folderId === '__recent__')
const isLoading = ref(false);

const folderName = computed(() => {
    if (isRecentView.value || !props.folderId) return ''
    // We need to find the folder name. It might not be in rootItems.
    // A proper solution would be another DB query. For now, we assume it might be a root item.
    const folder = rootItems.value.find(f => f.id === props.folderId && f.type === 'folder');
    return folder?.name ?? 'Folder';
})

function format(d) {
    return d ? new Date(d).toLocaleString() : ''
}

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
                const noteResult = await docStore.syncStore.execute('SELECT updated_at FROM notes WHERE id = ?', [c.id]);
                const note = noteResult.rows?._array[0];

                processedChildren.push({
                    id: c.id,
                    type: 'file',
                    name: c.name,
                    displayedDate: note?.updated_at || ''
                });
            }
        }
        return processedChildren;
    }

    treeData.value = await build(props.folderId)
    isLoading.value = false;
})


/* ───────── Navigation helpers ───────── */
async function openFile(id) {
    draftStore.clearDraft(id)
    await docStore.selectFile(id)
    router.push({ name: 'doc', params: { fileId: id } })
}
</script>
