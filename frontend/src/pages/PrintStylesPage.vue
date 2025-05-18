<template>
  <CustomizeStylesPage :config="printStylesConfig" />
</template>

<script setup>
import CustomizeStylesPage from './CustomizeStylesPage.vue';
import { useDocStore } from '@/store/docStore'; // Or directly useMarkdownStore

const docStore = useDocStore(); // Replace with useMarkdownStore if applicable

const printStylesConfig = {
  title: 'Customize Print Styles',
  getStyles: () => docStore.printStyles, // Assumes printStyles is reactive or provides a getter
  updateStyleAction: docStore.updatePrintStyle,
  getMarkdownIt: docStore.getPrintMarkdownIt,
  sampleMarkdown: `...`, // Copy sample markdown from original PrintStylesPage
  styleCategories: { /* ... same as StylesPage or specific if different ... */
    'Headings': ['h1', 'h2', 'h3'],
    'Text': ['p', 'em', 'strong', 'code', 'blockquote'],
    'Lists': ['ul', 'ol', 'li'],
    'Links & Media': ['a', 'img'],
    'Tables': ['table', 'tr', 'th', 'td'],
    'Other': ['hr']
  },
  extraFieldsTitle: 'Optional Header & Footer HTML',
  extraFields: [
    { id: 'printHeaderHtml', label: 'Print Header HTML', type: 'textarea', modelKey: 'printHeaderHtml', placeholder: 'Optional HTML...' },
    { id: 'printFooterHtml', label: 'Print Footer HTML', type: 'textarea', modelKey: 'printFooterHtml', placeholder: 'Optional HTML...' }
  ]
};
</script>