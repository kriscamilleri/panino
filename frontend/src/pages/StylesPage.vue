# In src/pages/StylesPage.vue

<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <!-- Top Navigation Bar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Customize Markdown Styles</h1>
                <button @click="goBack"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
                    <ArrowLeft class="w-4 h-4" />
                    <span>Back</span>
                </button>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="flex-1 flex">
            <!-- Styles Form -->
            <div class="w-1/2 p-8" style="height: calc(100vh - 56px);">
                <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
                    <div class="space-y-6">
                        <!-- Organize styles by category -->
                        <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
                            <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
                            <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                                <label :for="key" class="block text-sm font-medium text-gray-700">
                                    {{ key }}
                                </label>
                                <input :id="key" type="text" v-model="styleMap[key]"
                                    @input="handleStyleChange(key, styleMap[key])" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm 
                                           focus:outline-none focus:ring-gray-500 focus:border-gray-500 
                                           sm:text-sm font-mono" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Preview Pane -->
            <div class="w-1/2 bg-white border-l p-8 overflow-y-auto">
                <div class="prose max-w-none" v-html="previewHtml"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { computed, ref } from 'vue'
import { useDocStore } from '@/store/docStore'
import { ArrowLeft } from 'lucide-vue-next'

const docStore = useDocStore()
const router = useRouter()

// We make a local copy of docStore.styles so we can edit them
const styleMap = computed({
    get: () => docStore.styles,
    set: () => { }
})

// Organize styles into categories
const categorizedStyles = computed(() => {
    const categories = {
        'Headings': ['h1', 'h2', 'h3'],
        'Text': ['p', 'em', 'strong', 'code', 'blockquote'],
        'Lists': ['ul', 'ol', 'li'],
        'Links & Media': ['a', 'img'],
        'Tables': ['table', 'tr', 'th', 'td'],
        'Other': ['hr']
    }

    return Object.entries(categories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys.map(key => [key, styleMap.value[key]])
        )
        return acc
    }, {})
})

// Sample markdown for preview
const sampleMarkdown = `
# Heading 1
## Heading 2
### Heading 3



Normal paragraph with **bold** and _italic_ text. Here's some \`inline code\`.
> A blockquote with some thoughtful text.

[A link](https://prettyneat.io)

---
* Unordered list item 1
* Unordered list item 2
  * Nested item
---
1. Ordered list item 1
2. Ordered list item 2
   1. Nested ordered item
---

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

---

\`\`\`
Code block
printf("Hello, World!");
\`\`\`
---

![Image placeholder](https://www.prettyneat.io/assets/prettyneat-logo-lg.png)

`

// Generate preview HTML
const previewHtml = computed(() => {
    const md = docStore.getMarkdownIt()
    return md.render(sampleMarkdown)
})

function handleStyleChange(key, newVal) {
    docStore.updateStyle(key, newVal)
}

function goBack() {
    router.push('/')
}
</script>