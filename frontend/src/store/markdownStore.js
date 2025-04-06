// src/store/markdownStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'

export const useMarkdownStore = defineStore('markdownStore', () => {
    //
    // 1) Styles for normal (preview) rendering
    //
    const styles = ref({
        h1: 'text-3xl font-bold mt-4 mb-2 block',
        h2: 'text-2xl font-semibold mt-3 mb-2 block',
        h3: 'text-xl font-semibold mt-2 mb-1 block',
        h4: 'text-lg font-semibold mt-2 mb-1 block text-gray-600', // Added h4
        p: 'mb-2 leading-relaxed', // Class for paragraphs
        ul: 'list-disc list-inside mb-2',
        ol: 'list-decimal list-inside mb-2',
        li: 'ml-5 mb-1',
        code: 'bg-gray-100 text-sm px-1 py-0.5 rounded', // Class for inline code
        pre: 'bg-gray-100 p-2 rounded my-2 overflow-x-auto text-sm', // Class for code blocks (<pre>)
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'text-blue-600 underline',
        img: 'max-w-full h-auto my-2', // Added margin to images
        table: 'border-collapse border border-gray-300 my-2 w-full', // Added w-full
        tr: 'border-t border-gray-200', // Added border for table rows
        th: 'border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold', // Added text-left and font-semibold
        td: 'border border-gray-300 px-2 py-1',
    })

    //
    // 2) Styles specifically for printing (completely independent)
    //
    const printStyles = ref({
        h1: 'font-bold text-2xl my-2 block',
        h2: 'font-bold text-xl my-2 block',
        h3: 'font-bold text-lg my-1 block',
        h4: 'font-semibold text-base my-1 block text-gray-700', // Added h4 print style
        p: 'mb-2 leading-relaxed', // Class for print paragraphs
        ul: 'list-disc mb-2 ml-8',
        ol: 'list-decimal mb-2 ml-8',
        li: 'mb-1',
        code: 'bg-gray-200 px-1 py-0.5 rounded text-sm font-mono', // Class for print inline code
        pre: 'bg-gray-200 p-2 rounded my-2 overflow-x-auto text-sm font-mono', // Class for print code blocks
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'underline text-blue-700', // Added color
        img: 'max-w-full h-auto my-2', // Added margin
        table: 'border-collapse border border-gray-300 my-2 w-full', // Added w-full
        tr: 'border-t border-gray-200',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold',
        td: 'border border-gray-300 px-2 py-1',

        // Print-specific header/footer
        printHeaderHtml: '',
        printFooterHtml: '',
    })

    // Update normal (preview) style
    function updateStyle(key, newVal) {
        if (styles.value[key] !== undefined) {
            styles.value[key] = newVal
        }
    }

    // Update print style
    function updatePrintStyle(key, newVal) {
        if (printStyles.value[key] !== undefined) {
            printStyles.value[key] = newVal
        }
    }

    // --- Helper Function to add classes via token attributes ---
    function addClassToToken(token, className) {
        if (className) {
            const existingClass = token.attrGet('class');
            if (existingClass) {
                // Check if the class is already present to avoid duplicates
                const classes = existingClass.split(' ');
                if (!classes.includes(className)) {
                    token.attrJoin('class', className);
                }
            } else {
                token.attrPush(['class', className]);
            }
        }
    }
    // --- End Helper ---


    // MarkdownIt for normal (preview) rendering
    function getMarkdownIt() {
        const md = new MarkdownIt({
            html: true,      // Allow HTML tags in source
            linkify: true,   // Autoconvert URL-like text to links
            typographer: true,// Enable smartquotes, dashes, etc.
            breaks: true     // Convert '\n' in paragraphs into <br> (GFM style)
        }).use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true }); // Ensure task lists are fully enabled


        // --- Rule Overrides for Adding Classes ---

        // Headings: Add classes directly to heading_open token
        md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            const className = styles.value[token.tag]; // Get class for h1, h2, etc.
            if (className) {
                token.attrJoin('class', className);
            }
            return self.renderToken(tokens, idx, options); // Use default renderer
        };

        // Paragraphs: Modify token attributes instead of overriding renderer
        // This ensures default paragraph logic (like handling double newlines) is preserved.
        const defaultParagraphOpen = md.renderer.rules.paragraph_open || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.p);
            return defaultParagraphOpen(tokens, idx, options, env, self);
        };

        // Lists
        md.renderer.rules.bullet_list_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.ul);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.ordered_list_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.ol);
            return self.renderToken(tokens, idx, options);
        };
        // List Items (handles task list rendering correctly now)
        const defaultListItemOpen = md.renderer.rules.list_item_open || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.li);
            // Let markdown-it-task-lists handle checkbox rendering by calling default
            return defaultListItemOpen(tokens, idx, options, env, self);
        };


        // Inline Code
        const defaultCodeInline = md.renderer.rules.code_inline || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.code);
            // Escape content to prevent XSS if needed (though default renderer usually does)
            token.content = md.utils.escapeHtml(token.content);
            return defaultCodeInline(tokens, idx, options, env, self);
        };

        // Fenced Code Blocks (<pre><code>)
        const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.fence = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            // The default fence renderer wraps content in <pre><code>...</code></pre>
            // We want to add the class to the <pre> tag.
            // Markdown-it adds attributes to the outer token which becomes the <pre> tag.
            addClassToToken(token, styles.value.pre);
            // Ensure content is escaped
            token.content = md.utils.escapeHtml(token.content);
            return defaultFence(tokens, idx, options, env, self);
        };
        // Also handle indented code blocks
        const defaultCodeBlock = md.renderer.rules.code_block || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.code_block = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.pre); // Use the same style as fenced blocks
            token.content = md.utils.escapeHtml(token.content);
            return defaultCodeBlock(tokens, idx, options, env, self);
        };

        // Blockquote
        md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.blockquote);
            return self.renderToken(tokens, idx, options);
        };

        // Horizontal Rule
        md.renderer.rules.hr = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.hr);
            return self.renderToken(tokens, idx, options);
        };

        // Emphasis (Italic)
        md.renderer.rules.em_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.em);
            return self.renderToken(tokens, idx, options);
        };

        // Strong (Bold)
        md.renderer.rules.strong_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.strong);
            return self.renderToken(tokens, idx, options);
        };

        // Links
        md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.a);
            // Add target="_blank" and rel="noopener" for external links (optional but good practice)
            // Simple check: does it start with http or //?
            const href = token.attrGet('href');
            if (href && (href.startsWith('http') || href.startsWith('//'))) {
                token.attrSet('target', '_blank');
                token.attrSet('rel', 'noopener noreferrer');
            }
            // Ensure internal links (#anchor) don't get target=_blank
            else if (href && href.startsWith('#')) {
                token.attrSet('target', '_self'); // Explicitly set to self if needed
                // Remove rel if it was somehow added
                const relIndex = token.attrIndex('rel');
                if (relIndex !== -1) {
                    token.attrs.splice(relIndex, 1);
                }
            }
            return self.renderToken(tokens, idx, options);
        };

        // Images
        md.renderer.rules.image = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.img);
            // Set loading="lazy" for performance (optional)
            token.attrSet('loading', 'lazy');
            return self.renderToken(tokens, idx, options);
        };

        // Tables
        md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.table);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.tr_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.tr);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.th_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.th);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.td_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, styles.value.td);
            return self.renderToken(tokens, idx, options);
        };

        // --- End Rule Overrides ---

        return md
    }

    // MarkdownIt for print rendering (Apply similar logic)
    function getPrintMarkdownIt() {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true // Keep breaks consistent if desired for print
        }).use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true }); // Task lists for print too

        // Apply print styles using the same token modification approach

        md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value[token.tag]);
            return self.renderToken(tokens, idx, options);
        };

        const defaultPrintParagraphOpen = md.renderer.rules.paragraph_open || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.p);
            return defaultPrintParagraphOpen(tokens, idx, options, env, self);
        };


        md.renderer.rules.bullet_list_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.ul);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.ordered_list_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.ol);
            return self.renderToken(tokens, idx, options);
        };

        const defaultPrintListItemOpen = md.renderer.rules.list_item_open || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.li);
            return defaultPrintListItemOpen(tokens, idx, options, env, self);
        };

        const defaultPrintCodeInline = md.renderer.rules.code_inline || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.code);
            token.content = md.utils.escapeHtml(token.content);
            return defaultPrintCodeInline(tokens, idx, options, env, self);
        };

        const defaultPrintFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.fence = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.pre);
            token.content = md.utils.escapeHtml(token.content);
            return defaultPrintFence(tokens, idx, options, env, self);
        };
        const defaultPrintCodeBlock = md.renderer.rules.code_block || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.code_block = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.pre);
            token.content = md.utils.escapeHtml(token.content);
            return defaultPrintCodeBlock(tokens, idx, options, env, self);
        };

        md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.blockquote);
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.hr = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.hr);
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.em_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.em);
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.strong_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.strong);
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.a);
            // Don't force target=_blank for print usually
            const href = token.attrGet('href');
            if (href && (href.startsWith('http') || href.startsWith('//'))) {
                token.attrSet('target', '_blank'); // Keep for consistency if clicked from a preview maybe?
                token.attrSet('rel', 'noopener noreferrer');
            }
            else if (href && href.startsWith('#')) {
                token.attrSet('target', '_self');
                const relIndex = token.attrIndex('rel');
                if (relIndex !== -1) {
                    token.attrs.splice(relIndex, 1);
                }
            }
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.image = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.img);
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.table);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.tr_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.tr);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.th_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.th);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.td_open = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            addClassToToken(token, printStyles.value.td);
            return self.renderToken(tokens, idx, options);
        };

        return md
    }


    return {
        // Preview (normal) styles
        styles,
        updateStyle,
        getMarkdownIt,

        // Print styles
        printStyles,
        updatePrintStyle,
        getPrintMarkdownIt,
    }
})