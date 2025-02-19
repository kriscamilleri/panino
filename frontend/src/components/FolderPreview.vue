<template>
  <div class="flex-1 overflow-hidden p-4">
    <!-- If folderId is the special "__recent__", show a "Recent Documents" heading -->
    <h2 v-if="isRecentView" class="text-xl font-bold mb-2">Recent Documents</h2>
    <h2 v-else class="text-xl font-bold mb-2">{{ folderName }}</h2>

    <ul>
      <li v-for="file in childFiles" :key="file.id" class="mb-2">
        <!-- Replaced router-link with a manual click handler -->
        <a href="#" class="text-blue-600 underline" @click.prevent="handleFileClick(file.id)">
          {{ file.name }}
        </a>
        <span class="ml-2 text-sm text-gray-500">
          Last Modified:
          {{ file.displayedDate ? formatDate(file.displayedDate) : '' }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useContentStore } from '@/store/contentStore'

/**
 * Props
 */
const props = defineProps({
  folderId: {
    type: String,
    default: null
  }
})

const docStore = useDocStore()
const contentStore = useContentStore()
const router = useRouter()

const childFiles = ref([])
const isRecentView = computed(() => props.folderId === '__recent__')

// A computed property to get the folder’s name from docStore
const folderName = computed(() => {
  if (!props.folderId) return ''
  const folderItem = docStore.data.structure[props.folderId]
  return folderItem?.name || ''
})

/**
 * If folderId === "__recent__", load the top 10 recently edited docs.
 */
async function loadRecentDocs() {
  childFiles.value = await docStore.getRecentDocuments(10)
}

/**
 * Otherwise, load the actual folder's child files
 */
async function loadFolderFiles(folderId) {
  childFiles.value = []

  const children = docStore.getChildren(folderId)
    .filter((item) => item.type === 'file')

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

  // Sort them by name for display
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

/**
 * Reuse date formatting
 */
function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString()
}

/**
 * Important: we explicitly select the file in docStore,
 * then navigate to /doc/:fileId. This ensures docStore
 * has already loaded the content by the time Editor.vue appears.
 */
function handleFileClick(fileId) {
  // 1) Select the file in docStore
  docStore.selectFile(fileId)

  // 2) Then go to /doc/:fileId
  router.push({ name: 'doc', params: { fileId } })
}

defineExpose({
  formatDate
})
</script>
