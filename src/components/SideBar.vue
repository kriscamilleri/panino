<template>
    <div class="h-full">
        <h2 class="font-bold text-lg mb-4">Documents</h2>
        <ul class="space-y-1">
            <li v-for="item in rootItems" :key="item.id">
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
const rootItems = computed(() => docStore.rootItems)
</script>