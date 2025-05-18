<template>
    <CustomizeStylesPage :config="markdownStylesConfig" />
</template>

<script setup>
import CustomizeStylesPage from './CustomizeStylesPage.vue';
import { useDocStore } from '@/store/docStore'; // Or directly useMarkdownStore if docStore is refactored

const docStore = useDocStore(); // Replace with useMarkdownStore if applicable

const markdownStylesConfig = {
    title: 'Customize Markdown Styles',
    getStyles: () => docStore.styles, // Assumes styles is reactive or provides a getter
    updateStyleAction: docStore.updateStyle,
    getMarkdownIt: docStore.getMarkdownIt,
    sampleMarkdown: `...`, // Copy sample markdown from original StylesPage
    styleCategories: {
        'Headings': ['h1', 'h2', 'h3', 'h4'],
        'Text': ['p', 'em', 'strong', 'code', 'blockquote'],
        'Lists': ['ul', 'ol', 'li'],
        'Links & Media': ['a', 'img'],
        'Tables': ['table', 'tr', 'th', 'td'],
        'Other': ['hr', 'pre']
    },
    extraFields: []
};
</script>