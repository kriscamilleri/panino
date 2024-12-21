<template>
    <div>
        <h2 class="font-bold text-lg mb-4">Documents</h2>
        <ul>
            <li v-for="item in rootItems" :key="item.id" class="mb-2">
                <TreeItem :item="item" />
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'
import TreeItem from './TreeItem.vue'

const docStore = useDocStore()

// Root-level items in the store
const rootItems = computed(() => docStore.rootItems)
</script>