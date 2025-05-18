<template>
    <CustomizeStylesPage :config="markdownStylesConfig" previewType="html" />
</template>

<script setup>
import CustomizeStylesPage from './CustomizeStylesPage.vue';
import { useDocStore } from '@/store/docStore';

const docStore = useDocStore();

const sampleMarkdown = `
# Sample Document for Markdown Preview

This document demonstrates how your selected markdown styles will appear in the application's live preview pane.

## Text Formatting

This is a paragraph containing **bold text**, _italic text_, and \`inline code\`. Strikethrough is also available using \`~~\` (e.g., ~~mistake~~).

### Lists

- Unordered List Item 1
- Unordered List Item 2
    - Nested Item A
    - Nested Item B

1. Ordered List Item 1
2. Ordered List Item 2
    1. Sub-ordered Item
    2. Another Sub-ordered Item

- [x] A completed task
- [ ] An incomplete task

## Block Elements

> This is a blockquote. It's useful for quoting text from other sources.
> It can span multiple lines.

\`\`\`javascript
// This is a JavaScript code block
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}
greet('Developer');
\`\`\`

---

## Tables

Tables are structured with pipes and hyphens:

| Left-aligned | Center-aligned | Right-aligned |
| :----------- | :------------: | ------------: |
| Content      |    Content     |       Content |
| Item         |      Item      |          Item |

## Links and Images

A link to the [Vue.js documentation](https://vuejs.org/).

An image:
![Vue Logo](https://vuejs.org/images/logo.png)
`;

const markdownStylesConfig = {
    title: 'Customize Markdown Styles',
    getStyles: () => ({ ...docStore.styles }), // Creates a reactive copy for local editing
    updateStyleAction: docStore.updateStyle,
    getMarkdownIt: docStore.getMarkdownIt,
    sampleMarkdown: sampleMarkdown,
    styleCategories: {
        'Headings': ['h1', 'h2', 'h3', 'h4'],
        'Text': ['p', 'em', 'strong', 'code', 'blockquote'],
        'Lists': ['ul', 'ol', 'li'],
        'Links & Media': ['a', 'img'],
        'Tables': ['table', 'tr', 'th', 'td'],
        'Other': ['hr', 'pre']
    },
    extraFields: [] // No extra fields for regular markdown styles
};
</script>