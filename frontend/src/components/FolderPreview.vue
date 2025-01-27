<template>
  <div class="flex-1 overflow-hidden p-4">
    <h2 class="text-xl font-bold mb-2">{{ folderName }}</h2>
    <ul>
      <li
        v-for="file in childFiles"
        :key="file.id"
        class="mb-2"
      >
        <!-- Linking to the file route -->
        <router-link
          :to="{ name: 'doc', params: { fileId: file.id } }"
          class="text-blue-600 underline"
        >
          {{ file.name }}
        </router-link>
        <span class="ml-2 text-sm text-gray-500">
          <!-- Show lastModified if available, otherwise createdTime -->
          Last Modified: {{ file.displayedDate ? formatDate(file.displayedDate) : '' }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
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

// We'll store child files and their date to display
const childFiles = ref([])

// A computed property to get the folder's name from docStore
const folderName = computed(() => {
  if (!props.folderId) return ''
  const folderItem = docStore.data.structure[props.folderId]
  return folderItem?.name || ''
})

// Whenever folderId changes, load/refresh its child files
watch(
  () => props.folderId,
  async (folderId) => {
    childFiles.value = []
    if (!folderId) return

    const children = docStore.getChildren(folderId).filter((i) => i.type === 'file')
    const loaded = []
    for (const c of children) {
      let doc = contentStore.contentCache.get(c.id)
      if (!doc) {
        doc = await contentStore.loadContent(c.id)
      }
      // If there's no lastModified, show createdTime. (Set in syncStore)
      const displayedDate = doc?.lastModified || doc?.createdTime || ''
      loaded.push({
        id: c.id,
        name: c.name,
        displayedDate
      })
    }
    // Sort alphabetically
    loaded.sort((a, b) => a.name.localeCompare(b.name))
    childFiles.value = loaded
  },
  { immediate: true }
)

// Simple date formatting
function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString()
}

defineExpose({
    formatDate
})

</script>
