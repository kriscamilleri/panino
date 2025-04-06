# In src/pages/StylesPage.vue

<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <!-- Top Navigation Bar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Customize Markdown Styles</h1>
                <button @click="goBack"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2"
                    data-testid="styles-back-button">
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
                                    @input="handleStyleChange(key, $event.target.value)" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                                           focus:outline-none focus:ring-gray-500 focus:border-gray-500
                                           sm:text-sm font-mono" :data-testid="`style-input-${key}`" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Preview Pane -->
            <div class="w-1/2 bg-white border-l p-8 overflow-y-auto" data-testid="styles-preview-container">
                <!-- Add wrapping div with prose -->
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

// We make a computed property that gets/sets from the store
const styleMap = computed({
    get: () => ({ ...docStore.styles }), // Return a copy to potentially avoid direct mutation issues
    set: (value) => {
        // Setter might not be needed if using the action below
    }
})

// Debounce helper
function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

// Debounced action to update the store
const debouncedUpdateStyle = debounce((key, value) => {
    docStore.updateStyle(key, value)
}, 300); // 300ms debounce

function handleStyleChange(key, newVal) {
    // Update the store via the debounced action
    debouncedUpdateStyle(key, newVal)
}


// Organize styles into categories
const categorizedStyles = computed(() => {
    const categories = {
        'Headings': ['h1', 'h2', 'h3', 'h4'], // Added h4
        'Text': ['p', 'em', 'strong', 'code', 'blockquote'],
        'Lists': ['ul', 'ol', 'li'],
        'Links & Media': ['a', 'img'],
        'Tables': ['table', 'tr', 'th', 'td'],
        'Other': ['hr', 'pre'] // Added 'pre' for code blocks
    }

    const currentStyles = styleMap.value; // Use the computed value

    return Object.entries(categories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys
                .filter(key => currentStyles.hasOwnProperty(key)) // Ensure key exists
                .map(key => [key, currentStyles[key]])
        )
        return acc
    }, {})
})

// Sample markdown for preview
const sampleMarkdown = `
# Heading 1 Example
## Heading 2 Example
### Heading 3 Example
#### Heading 4 Example

This is a normal paragraph with some **bold text** and _italic text_.
You can also include \`inline code snippets\`.

> Here is a blockquote. It can span multiple lines and helps emphasize text quoted from another source.

Here's a link to [PrettyNeat](https://prettyneat.io).

---

An unordered list:
* Item 1
* Item 2
  * Nested Item 2a
  * Nested Item 2b
* Item 3

---

An ordered list:
1. First item
2. Second item
   1. Nested ordered item 2.1
   2. Nested ordered item 2.2
3. Third item

---

A task list:
- [ ] Task to do
- [x] Task completed

---

A simple table:

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1A  | Cell 1B  | Cell 1C  |
| Cell 2A  | Cell 2B  | Cell 2C  |
| Cell 3A  | Cell 3B  | Cell 3C  |

---

A code block example:
\`\`\`javascript
function greet(name) {
  // This is a comment inside the code block
  console.log(\`Hello, \${name}! Let's test the styles.\`);
}

greet('Developer');
\`\`\`

---

Finally, an image example:

![PrettyNeat Logo](https://www.prettyneat.io/assets/prettyneat-logo-lg.png)

`

// Generate preview HTML using the live styles from the store
const previewHtml = computed(() => {
    const md = docStore.getMarkdownIt() // This now uses the reactive styles
    return md.render(sampleMarkdown)
})

function goBack() {
    router.push('/')
}
</script>

<style scoped>
/* Add specific styles for the preview if needed, beyond Tailwind Prose */
[data-testid="styles-preview-container"] :deep(img) {
    display: block;
    /* Ensure images behave predictably */
    margin: 1em 0;
    /* Add some margin */
}

[data-testid="styles-preview-container"] :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
}

[data-testid="styles-preview-container"] :deep(th),
[data-testid="styles-preview-container"] :deep(td) {
    border: 1px solid #ccc;
    padding: 0.5em;
    text-align: left;
}

[data-testid="styles-preview-container"] :deep(th) {
    background-color: #f0f0f0;
}
</style>
