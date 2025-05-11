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
                <ImagePasteHandler v-model="headerLeftModel" placeholder="Header text..." :maxWidth="180"
                  :maxHeight="48" />
              </div>

              <!-- Header Right -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Header&nbsp;Right</h3>
                <ImagePasteHandler v-model="headerRightModel" placeholder="Header text..." :maxWidth="180"
                  :maxHeight="48" />
              </div>

              <!-- Footer Left -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Footer&nbsp;Left</h3>
                <ImagePasteHandler v-model="footerLeftModel" placeholder="Footer text..." :maxWidth="180"
                  :maxHeight="48" />
              </div>

              <!-- Footer Right -->
              <div>
                <h3 class="text-sm font-medium text-gray-700 mb-2">Footer&nbsp;Right</h3>
                <ImagePasteHandler v-model="footerRightModel" placeholder="Footer text..." :maxWidth="180"
                  :maxHeight="48" />
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
            <HeaderFooterPreview :type="headerLeftModel.type" :content="headerLeftModel.content" />
            <HeaderFooterPreview :type="headerRightModel.type" :content="headerRightModel.content" />
          </div>

          <!-- markdown preview -->
          <div class="prose max-w-none py-4" v-html="printPreviewHtml"></div>

          <!-- footer preview -->
          <div class="flex justify-between items-center border-t pt-4 mt-4 text-xs">
            <HeaderFooterPreview :type="footerLeftModel.type" :content="footerLeftModel.content" />
            <HeaderFooterPreview :type="footerRightModel.type" :content="footerRightModel.content" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { computed, ref, watch, onMounted } from 'vue'
import { useDocStore } from '@/store/docStore'
import { ArrowLeft } from 'lucide-vue-next'
import HeaderFooterPreview from '@/components/HeaderFooterPreview.vue'
import ImagePasteHandler from '@/components/ImagePasteHandler.vue'

const router = useRouter()
const docStore = useDocStore()

/* ▸ Reactive models for header/footer content */
const headerLeftModel = ref({
  type: 'text',
  content: ''
})

const headerRightModel = ref({
  type: 'text',
  content: ''
})

const footerLeftModel = ref({
  type: 'text',
  content: ''
})

const footerRightModel = ref({
  type: 'text',
  content: ''
})

/* ▸ Two-way map proxy for all printStyles fields */
const printStyleMap = computed({
  get: () => {
    // Ensure defaults are set if the store has no values
    const styles = docStore.printStyles || {};

    // Make sure all needed properties exist with fallbacks
    return {
      ...styles,
      pageHeaderLeftType: styles.pageHeaderLeftType || 'text',
      pageHeaderLeftContent: styles.pageHeaderLeftContent || '',
      pageHeaderRightType: styles.pageHeaderRightType || 'text',
      pageHeaderRightContent: styles.pageHeaderRightContent || '',
      pageFooterLeftType: styles.pageFooterLeftType || 'text',
      pageFooterLeftContent: styles.pageFooterLeftContent || '',
      pageFooterRightType: styles.pageFooterRightType || 'text',
      pageFooterRightContent: styles.pageFooterRightContent || ''
    };
  },
  set: () => { } // No direct setting of the entire object
})

/* ▸ Initialize models from printStyles */
onMounted(() => {
  // Set default values for header/footer fields if not already set
  if (!docStore.printStyles.pageHeaderLeftType) {
    docStore.updatePrintStyle('pageHeaderLeftType', 'text')
  }
  if (!docStore.printStyles.pageHeaderRightType) {
    docStore.updatePrintStyle('pageHeaderRightType', 'text')
  }
  if (!docStore.printStyles.pageFooterLeftType) {
    docStore.updatePrintStyle('pageFooterLeftType', 'text')
  }
  if (!docStore.printStyles.pageFooterRightType) {
    docStore.updatePrintStyle('pageFooterRightType', 'text')
  }

  // Load header/footer state from docStore
  headerLeftModel.value = {
    type: printStyleMap.value.pageHeaderLeftType || 'text',
    content: printStyleMap.value.pageHeaderLeftContent || ''
  }

  headerRightModel.value = {
    type: printStyleMap.value.pageHeaderRightType || 'text',
    content: printStyleMap.value.pageHeaderRightContent || ''
  }

  footerLeftModel.value = {
    type: printStyleMap.value.pageFooterLeftType || 'text',
    content: printStyleMap.value.pageFooterLeftContent || ''
  }

  footerRightModel.value = {
    type: printStyleMap.value.pageFooterRightType || 'text',
    content: printStyleMap.value.pageFooterRightContent || ''
  }
})

/* ▸ Watch for changes to models and sync to docStore */
watch(headerLeftModel, (newVal) => {
  console.log('Header Left changed:', newVal.type, newVal.content.substring(0, 30) + (newVal.content.length > 30 ? '...' : ''));
  handlePrintStyleChange('pageHeaderLeftType', newVal.type);
  handlePrintStyleChange('pageHeaderLeftContent', newVal.content);
}, { deep: true });

watch(headerRightModel, (newVal) => {
  console.log('Header Right changed:', newVal.type, newVal.content.substring(0, 30) + (newVal.content.length > 30 ? '...' : ''));
  handlePrintStyleChange('pageHeaderRightType', newVal.type);
  handlePrintStyleChange('pageHeaderRightContent', newVal.content);
}, { deep: true });

watch(footerLeftModel, (newVal) => {
  console.log('Footer Left changed:', newVal.type, newVal.content.substring(0, 30) + (newVal.content.length > 30 ? '...' : ''));
  handlePrintStyleChange('pageFooterLeftType', newVal.type);
  handlePrintStyleChange('pageFooterLeftContent', newVal.content);
}, { deep: true });

watch(footerRightModel, (newVal) => {
  console.log('Footer Right changed:', newVal.type, newVal.content.substring(0, 30) + (newVal.content.length > 30 ? '...' : ''));
  handlePrintStyleChange('pageFooterRightType', newVal.type);
  handlePrintStyleChange('pageFooterRightContent', newVal.content);
}, { deep: true });

function handlePrintStyleChange(key, val) {
  console.log(`Updating print style: ${key} = ${val ? (typeof val === 'string' && val.length > 30 ? val.substring(0, 30) + '...' : val) : 'empty'}`);
  docStore.updatePrintStyle(key, val);
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