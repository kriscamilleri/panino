<template>
  <div class="flex-1 overflow-hidden p-4">
    <!-- If folderId is the special "__recent__", show a "Recent Documents" heading -->
    <h2 v-if="isRecentView" class="text-xl font-bold mb-2">Recent Documents</h2>
    <h2 v-else class="text-xl font-bold mb-2">{{ folderName }}</h2>
    <ul>
      <li v-for="file in childFiles" :key="file.id" class="mb-2">
        <router-link :to="{ name: 'doc', params: { fileId: file.id } }" class="text-blue-600 underline">
          {{ file.name }}
        </router-link>
        <span class="ml-2 text-sm text-gray-500">
          Last Modified: {{ file.displayedDate ? formatDate(file.displayedDate) : '' }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useContentStore } from '@/store/contentStore'

const props = defineProps({
  folderId: {
    type: String,
    default: null
  }
})

const docStore = useDocStore()
const contentStore = useContentStore()

const childFiles = ref([])
const isRecentView = computed(() => props.folderId === '__recent__')

// A computed property to get the folder's name from docStore
const folderName = computed(() => {
  if (!props.folderId) return ''
  const folderItem = docStore.data.structure[props.folderId]
  return folderItem?.name || ''
})

// If this is the "recent docs" pseudo-folder, we load top 10.
async function loadRecentDocs() {
  childFiles.value = await docStore.getRecentDocuments(10)
}

// Otherwise, load the actual folder's child files
async function loadFolderFiles(folderId) {
  childFiles.value = []
  const children = docStore.getChildren(folderId).filter((i) => i.type === 'file')
  const loaded = []
  for (const c of children) {
    let doc = contentStore.contentCache.get(c.id)
    if (!doc) {
      doc = await contentStore.loadContent(c.id)
    }
    const displayedDate = doc?.lastModified || doc?.createdTime || ''
    loaded.push({
      id: c.id,
      name: c.name,
      displayedDate
    })
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  childFiles.value = loaded
}

onMounted(async () => {
  if (isRecentView.value) {
    await loadRecentDocs()
  } else if (props.folderId) {
    await loadFolderFiles(props.folderId)
  }
})

watch(
  () => props.folderId,
  async (newVal) => {
    if (newVal === '__recent__') {
      await loadRecentDocs()
    } else if (newVal) {
      await loadFolderFiles(newVal)
    } else {
      childFiles.value = []
    }
  }
)

// Reuse date formatting
function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString()
}

defineExpose({
  formatDate
})
</script>
