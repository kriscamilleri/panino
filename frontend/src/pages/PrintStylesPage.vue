<template>
  <CustomizeStylesPage :config="printStylesConfig" previewType="pdf" />
</template>

<script setup>
import CustomizeStylesPage from './CustomizeStylesPage.vue';
import { useDocStore } from '@/store/docStore';

const docStore = useDocStore();

const sampleMarkdown = `
# Sample Document for Print Preview

This document demonstrates how your selected print styles will appear. Changes to styles on the left will be reflected in the PDF preview on the right in near real-time.

The main content of your document will be rendered here. Ensure your Tailwind classes for headings, paragraphs, lists, etc., provide appropriate top and bottom margins to avoid overlapping with the fixed headers and footers you define below. For example, your first heading might need a \`mt-8\` or similar if you have a tall header.

## Typography and Layout

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam scelerisque arcu eget velit consectetur, **vitae fermentum eros lacinia**. Integer eu _nibh_ sit amet justo faucibus fringilla.

### Sub-headings and Lists

- Unordered list item one.
- Unordered list item two.
  - A nested item.
  - Another nested item.
1. Ordered list item one.
2. Ordered list item two.

\`\`\`css
body {
  font-family: 'Arial', sans-serif;
  line-height: 1.6;
  /* Margins for main content area are handled by jsPDF settings */
}
h1 {
  color: #333;
}
\`\`\`

> A blockquote provides emphasis or citation. It should be clearly distinct from the main text flow.

---

## Tables and Images

Tables should be legible and well-formatted for print.

| Feature         | Status      | Notes                           |
|-----------------|-------------|---------------------------------|
| PDF Preview     | Implemented | Uses jsPDF and html2canvas      |
| Style Editing   | Live        | Changes update preview          |
| Header/Footer   | Supported   | Text-based with styling options |

![Placeholder Image](/assets/vue.svg)  
*Caption for the image above.*

For more details, visit [our documentation](https://example.com).
This is more text to ensure pagination. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante. Donec eu libero sit amet quam egestas semper. Aenean ultricies mi vitae est. Mauris placerat eleifend leo. Quisque sit amet est et sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed, commodo vitae, ornare sit amet, wisi. Aenean fermentum, elit eget tincidunt condimentum, eros ipsum rutrum orci, sagittis tempus lacus enim ac dui. Donec non enim in turpis pulvinar facilisis. Ut felis. Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue, eu vulputate magna eros eu erat. Aliquam erat volutpat. Nam dui mi, tincidunt quis, accumsan porttitor, facilisis luctus, metus.
`;

const printStylesConfig = {
  title: 'Customize Print Styles',
  getStyles: () => ({ ...docStore.printStyles }),
  updateStyleAction: docStore.updatePrintStyle,
  getMarkdownIt: docStore.getPrintMarkdownIt,
  sampleMarkdown: sampleMarkdown,
  styleCategories: {
    'Element Styles': ['h1', 'h2', 'h3', 'h4', 'p', 'em', 'strong', 'code', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'tr', 'th', 'td', 'hr', 'pre'],
  },
  extraFieldsTitle: 'Print Header & Footer Settings',
  extraFields: [
    { id: 'printHeaderHtml', label: 'Page Header Text/HTML', type: 'textarea', modelKey: 'printHeaderHtml', rows: 2, placeholder: 'Text for page headers. Basic HTML allowed.' },
    { id: 'headerFontSize', label: 'Header Font Size (pt)', type: 'input', inputType: 'number', modelKey: 'headerFontSize', placeholder: 'e.g., 10' },
    { id: 'headerFontColor', label: 'Header Font Color', type: 'input', inputType: 'color', modelKey: 'headerFontColor' },
    { 
      id: 'headerAlign', label: 'Header Alignment', type: 'select', modelKey: 'headerAlign', 
      options: [{value: 'left', text: 'Left'}, {value: 'center', text: 'Center'}, {value: 'right', text: 'Right'}]
    },
    { id: 'printFooterHtml', label: 'Page Footer Text/HTML', type: 'textarea', modelKey: 'printFooterHtml', rows: 2, placeholder: 'Use %p for current page, %P for total pages (if enabled). Basic HTML allowed.' },
    { id: 'footerFontSize', label: 'Footer Font Size (pt)', type: 'input', inputType: 'number', modelKey: 'footerFontSize', placeholder: 'e.g., 10' },
    { id: 'footerFontColor', label: 'Footer Font Color', type: 'input', inputType: 'color', modelKey: 'footerFontColor' },
    { 
      id: 'footerAlign', label: 'Footer Alignment', type: 'select', modelKey: 'footerAlign',
      options: [{value: 'left', text: 'Left'}, {value: 'center', text: 'Center'}, {value: 'right', text: 'Right'}]
    },
    { id: 'enablePageNumbers', label: 'Enable Page Numbers in Footer', type: 'checkbox', modelKey: 'enablePageNumbers' } // New field
  ]
};
</script>