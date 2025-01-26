<!-- frontend/src/pages/PrintStylesPage.vue -->
<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
      <!-- Top Navigation Bar -->
      <nav class="bg-gray-100 border-b">
        <div class="flex items-center justify-between px-4 py-2">
          <h1 class="text-xl font-semibold text-gray-800">Customize Print Styles</h1>
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
              <!-- Organize styles by category (similar to normal styles) -->
              <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
                <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
                <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                  <label :for="key" class="block text-sm font-medium text-gray-700">
                    {{ key }}
                  </label>
                  <input
                    :id="key"
                    type="text"
                    v-model="printStyleMap[key]"
                    @input="handlePrintStyleChange(key, printStyleMap[key])"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                           focus:outline-none focus:ring-gray-500 focus:border-gray-500
                           sm:text-sm font-mono"
                  />
                </div>
              </div>
  
              <!-- Additional fields for Print Header and Footer -->
              <div class="space-y-4 pt-8 border-t">
                <h2 class="text-lg font-semibold text-gray-700">Optional Header &amp; Footer HTML</h2>
  
                <!-- Print Header HTML -->
                <div class="space-y-2">
                  <label for="printHeaderHtml" class="block text-sm font-medium text-gray-700">
                    Print Header HTML
                  </label>
                  <textarea
                    id="printHeaderHtml"
                    rows="4"
                    v-model="printHeaderHtmlLocal"
                    @input="updatePrintHeader(printHeaderHtmlLocal)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                           focus:outline-none focus:ring-gray-500 focus:border-gray-500
                           sm:text-sm font-mono"
                    placeholder="Optional HTML to appear at the top of printed pages"
                  ></textarea>
                </div>
  
                <!-- Print Footer HTML -->
                <div class="space-y-2">
                  <label for="printFooterHtml" class="block text-sm font-medium text-gray-700">
                    Print Footer HTML
                  </label>
                  <textarea
                    id="printFooterHtml"
                    rows="4"
                    v-model="printFooterHtmlLocal"
                    @input="updatePrintFooter(printFooterHtmlLocal)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                           focus:outline-none focus:ring-gray-500 focus:border-gray-500
                           sm:text-sm font-mono"
                    placeholder="Optional HTML to appear at the bottom of printed pages"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        </div>
  
        <!-- Preview Pane -->
        <div class="w-1/2 bg-white border-l p-8 overflow-y-auto">
          <div class="prose max-w-none" v-html="printPreviewHtml"></div>
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
  
  //
  // Access the separate printStyles from docStore
  //
  const printStyleMap = computed({
    get: () => docStore.printStyles,
    set: () => {}
  })
  
  // Local copies for header/footer
  const printHeaderHtmlLocal = ref(docStore.printStyles.printHeaderHtml || '')
  const printFooterHtmlLocal = ref(docStore.printStyles.printFooterHtml || '')
  
  // Update print style classes
  function handlePrintStyleChange(key, newVal) {
    docStore.updatePrintStyle(key, newVal)
  }
  
  // Update print header
  function updatePrintHeader(html) {
    docStore.updatePrintStyle('printHeaderHtml', html)
  }
  
  // Update print footer
  function updatePrintFooter(html) {
    docStore.updatePrintStyle('printFooterHtml', html)
  }
  
  // Categorize the main style keys (excluding the header/footer)
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
        keys.map(key => [key, printStyleMap.value[key]])
      )
      return acc
    }, {})
  })
  
  // Sample markdown
  const sampleMarkdown = `
  # Print Style Example
  
  ## Print Subheader
  
  This is some **bold** text, an _italic_ word, and a \`code snippet\`.
  
  > A blockquote for print demonstration.
  
  * A bullet list
  * Another list item
  
  1. Numbered list
  2. Another item
  
  [External Link](https://example.com)
  
  ![Placeholder image](https://via.placeholder.com/150)
  
  | Header A | Header B |
  |----------|----------|
  | Row 1    | Row 2   |
  
  ---
  
  \`\`\`
  Some code block
  \`\`\`
  `
  
  // Live preview of print styles
  const printPreviewHtml = computed(() => {
    const md = docStore.getPrintMarkdownIt()
    return md.render(sampleMarkdown)
  })
  
  function goBack() {
    router.push('/')
  }
  </script>
  