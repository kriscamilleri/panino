<template>
    <div class="p-4">
        <h1 class="text-2xl font-bold mb-4">Customize Markdown Styles</h1>

        <!-- Back to main -->
        <button class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded mb-4" @click="goBack">
            Back
        </button>

        <div class="space-y-4">
            <div v-for="(value, key) in styleMap" :key="key" class="flex items-center space-x-4">
                <label class="w-20 font-semibold">{{ key }}</label>
                <input type="text" class="border p-2 rounded flex-1" v-model="styleMap[key]"
                    @change="handleStyleChange(key, styleMap[key])" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'

const docStore = useDocStore()
const router = useRouter()

// We make a local copy of docStore.styles so we can edit them. 
// If you want immediate updates, you can skip the copy and write directly to docStore.styles.
const styleMap = computed({
    get: () => docStore.styles,
    set: (newVal) => { }
})

function handleStyleChange(key, newVal) {
    docStore.updateStyle(key, newVal)
}

function goBack() {
    router.push('/')
}
</script>