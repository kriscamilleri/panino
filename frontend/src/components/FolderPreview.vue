<!-- frontend/src/components/FolderPreview.vue -->
<template>
  <div class="flex-1 overflow-hidden p-4">
    <!-- ───────── Heading ───────── -->
    <h2 v-if="isRecentView" class="text-xl font-bold mb-2" data-testid="folder-preview-recent-heading">
      Recent&nbsp;Documents
    </h2>

    <h2 v-else class="text-xl font-bold mb-2" :data-testid="`folder-preview-name-${folderId}`">
      {{ folderName }}
    </h2>

    <!-- ───────── Recent Docs ───────── -->
    <template v-if="isRecentView">
      <ul>
        <li v-for="file in recentFiles" :key="file.id" class="mb-2">
          <a href="#" class="text-blue-600 underline" @click.prevent="openFile(file.id)"
            :data-testid="`folder-preview-file-link-${file.id}`">
            {{ file.name }}
          </a>
          <span class="ml-2 text-sm text-gray-500">
            Last&nbsp;Modified:
            {{ format(file.displayedDate) }}
          </span>
        </li>
      </ul>
    </template>

    <!-- ───────── Folder Tree ───────── -->
    <template v-else>
      <ul>
        <FolderPreviewItem v-for="node in treeData" :key="node.id" :item="node" />
      </ul>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue'
import { useRouter } from 'vue-router'

import FolderPreviewItem from '@/components/FolderPreviewItem.vue'
import { useDocStore } from '@/store/docStore'
import { useContentStore } from '@/store/contentStore'
import { useDraftStore } from '@/store/draftStore'

/* ───────── Props ───────── */
const props = defineProps({
  folderId: { type: String, default: null }
})

/* ───────── Stores / router ───────── */
const docStore = useDocStore()
const contentStore = useContentStore()
const draftStore = useDraftStore()
const router = useRouter()

/* ───────── Helpers ───────── */
const isRecentView = computed(() => props.folderId === '__recent__')

const folderName = computed(() => {
  if (isRecentView.value || !props.folderId) return ''
  const n = docStore.data.structure[props.folderId]
  return n?.name ?? ''
})

function format(d) {
  return d ? new Date(d).toLocaleString() : ''
}

/* ───────── Recent Docs (reactive) ───────── */
const recentFiles = ref([])

watchEffect(async () => {
  if (!isRecentView.value) return

  /* Every watchEffect run picks up:
       ▸ folderId (recent view flag)
       ▸ structure changes (docStore.data.structure)
       ▸ file-content changes (lastModified)
  */
  recentFiles.value = await docStore.getRecentDocuments(10)
})

/* ───────── Folder Tree (pure-computed) ───────── */
const treeData = computed(() => {
  if (isRecentView.value || !props.folderId) return []

  // recursive synchronous builder (reactive because it calls docStore.getChildren)
  function build(id) {
    const children = docStore
      .getChildren(id)
      .slice()                       // shallow-copy
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'folder' ? -1 : 1
      })

    return children.map(c => {
      if (c.type === 'folder') {
        return {
          id: c.id,
          type: 'folder',
          name: c.name,
          children: build(c.id)
        }
      }
      /* file */
      const meta = contentStore.contentCache.get(c.id) || {}
      const disp = meta.lastModified || meta.createdTime || ''
      return {
        id: c.id,
        type: 'file',
        name: c.name,
        displayedDate: disp
      }
    })
  }

  return build(props.folderId)
})

/* ───────── Navigation helpers ───────── */
async function openFile(id) {
  draftStore.clearDraft(id)
  await docStore.selectFile(id)
  router.push({ name: 'doc', params: { fileId: id } })
}
</script>
