<!-- frontend/src/pages/PrintStylesPage.vue -->
<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- ───────── Top bar ───────── -->
    <nav class="bg-gray-100 border-b">
      <div class="flex items-center justify-between px-4 py-2">
        <h1 class="text-xl font-semibold text-gray-800">Customize Print&nbsp;Styles</h1>
        <button @click="goBack" class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
          <ArrowLeft class="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>
    </nav>

    <!-- ───────── Main layout ───────── -->
    <div class="flex-1 flex">
      <!-- ───── Left: style & margin-box form ───── -->
      <div class="w-1/2 p-8" style="height: calc(100vh - 56px);">
        <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">

          <!-- Tailwind classes per element -->
          <div class="space-y-6">
            <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
              <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>

              <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                <label :for="key" class="block text-sm font-medium text-gray-700">{{ key }}</label>
                <input :id="key" type="text" v-model="printStyleMap[key]"
                  @input="handlePrintStyleChange(key, printStyleMap[key])" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                              focus:outline-none focus:ring-gray-500 focus:border-gray-500
                              sm:text-sm font-mono" />
              </div>
            </div>
          </div>

          <!-- Margin-box header / footer controls -->
          <div class="space-y-6 pt-8 border-t">
            <h2 class="text-lg font-semibold text-gray-700">
              Page Header&nbsp;&amp;&nbsp;Footer
            </h2>

            <div class="grid grid-cols-2 gap-6">

              <!-- Header Left -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Header&nbsp;Left</h3>
                <select :value="printStyleMap.pageHeaderLeftType"
                  @change="handlePrintStyleChange('pageHeaderLeftType', $event.target.value)"
                  class="mb-2 border rounded px-2 py-1 text-sm">
                  <option value="text">Text</option>
                  <option value="image">Image&nbsp;URL</option>
                </select>
                <input :value="printStyleMap.pageHeaderLeftContent"
                  @input="handlePrintStyleChange('pageHeaderLeftContent', $event.target.value)" :placeholder="printStyleMap.pageHeaderLeftType === 'text'
                    ? 'Header text …' : 'https://…'" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                              focus:outline-none focus:ring-gray-500 focus:border-gray-500
                              sm:text-sm font-mono" />
              </div>

              <!-- Header Right -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Header&nbsp;Right</h3>
                <select :value="printStyleMap.pageHeaderRightType"
                  @change="handlePrintStyleChange('pageHeaderRightType', $event.target.value)"
                  class="mb-2 border rounded px-2 py-1 text-sm">
                  <option value="text">Text</option>
                  <option value="image">Image&nbsp;URL</option>
                </select>
                <input :value="printStyleMap.pageHeaderRightContent"
                  @input="handlePrintStyleChange('pageHeaderRightContent', $event.target.value)" :placeholder="printStyleMap.pageHeaderRightType === 'text'
                    ? 'Header text …' : 'https://…'" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                              focus:outline-none focus:ring-gray-500 focus:border-gray-500
                              sm:text-sm font-mono" />
              </div>

              <!-- Footer Left -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Footer&nbsp;Left</h3>
                <select :value="printStyleMap.pageFooterLeftType"
                  @change="handlePrintStyleChange('pageFooterLeftType', $event.target.value)"
                  class="mb-2 border rounded px-2 py-1 text-sm">
                  <option value="text">Text</option>
                  <option value="image">Image&nbsp;URL</option>
                </select>
                <input :value="printStyleMap.pageFooterLeftContent"
                  @input="handlePrintStyleChange('pageFooterLeftContent', $event.target.value)" :placeholder="printStyleMap.pageFooterLeftType === 'text'
                    ? 'Footer text …' : 'https://…'" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                              focus:outline-none focus:ring-gray-500 focus:border-gray-500
                              sm:text-sm font-mono" />
              </div>

              <!-- Footer Right -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Footer&nbsp;Right</h3>
                <select :value="printStyleMap.pageFooterRightType"
                  @change="handlePrintStyleChange('pageFooterRightType', $event.target.value)"
                  class="mb-2 border rounded px-2 py-1 text-sm">
                  <option value="text">Text</option>
                  <option value="image">Image&nbsp;URL</option>
                </select>
                <input :value="printStyleMap.pageFooterRightContent"
                  @input="handlePrintStyleChange('pageFooterRightContent', $event.target.value)" :placeholder="printStyleMap.pageFooterRightType === 'text'
                    ? 'Footer text …' : 'https://…'" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                              focus:outline-none focus:ring-gray-500 focus:border-gray-500
                              sm:text-sm font-mono" />
              </div>

            </div>
          </div>
        </div>
      </div>

      <!-- ───── Right: live preview ───── -->
      <div class="w-1/2 bg-gray-200 p-8 overflow-y-auto">
        <div class="print-preview mx-auto bg-white shadow-lg">

          <!-- header preview -->
          <div class="flex justify-between items-center pb-4 border-b text-sm">
            <HeaderFooterPreview :type="printStyleMap.pageHeaderLeftType"
              :content="printStyleMap.pageHeaderLeftContent" />
            <HeaderFooterPreview :type="printStyleMap.pageHeaderRightType"
              :content="printStyleMap.pageHeaderRightContent" />
          </div>

          <!-- markdown preview -->
          <div class="prose max-w-none py-4" v-html="printPreviewHtml"></div>

          <!-- footer preview -->
          <div class="flex justify-between items-center border-t pt-4 mt-4 text-xs">
            <HeaderFooterPreview :type="printStyleMap.pageFooterLeftType"
              :content="printStyleMap.pageFooterLeftContent" />
            <HeaderFooterPreview :type="printStyleMap.pageFooterRightType"
              :content="printStyleMap.pageFooterRightContent" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { computed } from 'vue'
import { useDocStore } from '@/store/docStore'
import { ArrowLeft } from 'lucide-vue-next'
import HeaderFooterPreview from '@/components/HeaderFooterPreview.vue'

const router = useRouter()
const docStore = useDocStore()

/* ▸ Two-way map proxy for all printStyles fields */
const printStyleMap = computed({
  get: () => docStore.printStyles,
  set: () => { }
})

function handlePrintStyleChange(key, val) {
  docStore.updatePrintStyle(key, val)
}

/* Categorise element-class keys for form */
const categorizedStyles = computed(() => {
  const cats = {
    Headings: ['h1', 'h2', 'h3', 'h4'],
    Text: ['p', 'em', 'strong', 'code', 'blockquote', 'pre'],
    Lists: ['ul', 'ol', 'li'],
    'Links & Media': ['a', 'img'],
    Tables: ['table', 'tr', 'th', 'td'],
    Other: ['hr']
  }
  return Object.fromEntries(
    Object.entries(cats).map(([c, keys]) => [
      c,
      Object.fromEntries(keys.map(k => [k, printStyleMap.value[k]]))
    ])
  )
})

/* Sample markdown for preview */
const sampleMarkdown = `
# Print Style Example
Some **bold** text, _italic_ words and \`inline code\`.

> A quote for good measure.

* Bullet 1
* Bullet 2

1. Numbered 1
2. Numbered 2

[External link](https://example.com)

![Placeholder](https://via.placeholder.com/150)

| A | B |
|---|---|
| 1 | 2 |

\`\`\`
code block
\`\`\`
`

/* Live preview HTML */
const printPreviewHtml = computed(() => {
  const md = docStore.getPrintMarkdownIt()
  return md.render(sampleMarkdown)
})

function goBack() {
  router.push('/')
}
</script>

<style scoped>
@media print {
  @page {
    size: auto;
    margin: 1cm;
  }
}

.print-preview {
  width: 210mm;
  margin: auto;
  padding: 1cm;
  background: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, .15);
}
</style>
