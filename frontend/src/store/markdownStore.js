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
        h4: 'text-lg font-semibold mt-2 mb-1 block text-gray-600',
        p: 'mb-2 leading-relaxed',
        ul: 'list-disc list-inside mb-2',
        ol: 'list-decimal list-inside mb-2',
        li: 'ml-5 mb-1',
        code: 'bg-gray-100 text-sm px-1 py-0.5 rounded',
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'text-blue-600 underline',
        img: 'max-w-full h-auto',
        table: 'border-collapse border border-gray-300 my-2',
        tr: '',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1',
        td: 'border border-gray-300 px-2 py-1',
    })

    //
    // 2) Styles specifically for printing (completely independent)
    //
    const printStyles = ref({
        h1: 'font-bold text-2xl my-2 block',
        h2: 'font-bold text-xl my-2 block',
        h3: 'font-bold text-lg my-1 block',
        p: 'mb-2 leading-relaxed',
        ul: 'list-disc mb-2 ml-8',
        ol: 'list-decimal mb-2 ml-8',
        li: 'mb-1',
        code: 'bg-gray-200 px-1 py-0.5 rounded text-sm',
        blockquote: 'border-l-4 border-gray-300 pl-4 italic my-2',
        hr: 'border-t my-4',
        em: 'italic',
        strong: 'font-bold',
        a: 'underline',
        img: 'max-w-full h-auto',
        table: 'border-collapse border border-gray-300 my-2',
        tr: '',
        th: 'border border-gray-300 bg-gray-100 px-2 py-1',
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

    // MarkdownIt for normal (preview) rendering
    function getMarkdownIt() {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true
        }).use(markdownItTaskLists)

        // Paragraph (div or span if inside list)
        md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
            const inList = tokens.some((token, i) => {
                if (i < idx) {
                    return token.type === 'list_item_open' && !token.hidden
                }
                return false
            })
            return inList
                ? `<span class="${styles.value.p}">`
                : `<div class="${styles.value.p}">`
        }

        md.renderer.rules.paragraph_close = (tokens, idx) => {
            const inList = tokens.some((token, i) => {
                if (i < idx) {
                    return token.type === 'list_item_open' && !token.hidden
                }
                return false
            })
            return inList ? '</span>' : '</div>'
        }

        md.renderer.rules.heading_open = (tokens, idx) => {
            const tag = tokens[idx].tag
            return `<${tag} class="${styles.value[tag]}">`
        }

        md.renderer.rules.bullet_list_open = () => `<ul class="${styles.value.ul}">`
        md.renderer.rules.ordered_list_open = () => `<ol class="${styles.value.ol}">`

        md.renderer.rules.list_item_open = (tokens, idx) => {
            // Check for task list
            if (tokens[idx].map && tokens[idx].map.length > 0) {
                if (tokens[idx + 2]?.type === 'task_list_item_open') {
                    const checked = tokens[idx + 2].checked
                    return `<li class="${styles.value.li}"><input type="checkbox" ${checked ? 'checked' : ''} disabled> `
                }
            }
            return `<li class="${styles.value.li}">`
        }

        md.renderer.rules.code_inline = (tokens, idx) =>
            `<code class="${styles.value.code}">${tokens[idx].content}</code>`

        md.renderer.rules.blockquote_open = () =>
            `<blockquote class="${styles.value.blockquote}">`

        md.renderer.rules.hr = () => `<hr class="${styles.value.hr}">`
        md.renderer.rules.em_open = () => `<em class="${styles.value.em}">`
        md.renderer.rules.strong_open = () => `<strong class="${styles.value.strong}">`

        md.renderer.rules.link_open = (tokens, idx) => {
            const href = tokens[idx].attrGet('href')
            return `<a href="${href}" class="${styles.value.a}" target="_blank" rel="noopener">`
        }

        md.renderer.rules.image = (tokens, idx) => {
            const token = tokens[idx]
            const src = token.attrGet('src')
            const alt = token.content
            const title = token.attrGet('title')
            return `<img src="${src}" alt="${alt}" title="${title || ''}" class="${styles.value.img}">`
        }

        md.renderer.rules.table_open = () => `<table class="${styles.value.table}">`
        md.renderer.rules.th_open = () => `<th class="${styles.value.th}">`
        md.renderer.rules.td_open = () => `<td class="${styles.value.td}">`

        return md
    }

    // MarkdownIt for print rendering
    function getPrintMarkdownIt() {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true
        }).use(markdownItTaskLists)

        // Paragraph (div or span if inside list)
        md.renderer.rules.paragraph_open = (tokens, idx) => {
            const inList = tokens.some((token, i) => i < idx && token.type === 'list_item_open' && !token.hidden)
            return inList
                ? `<span class="${printStyles.value.p}">`
                : `<div class="${printStyles.value.p}">`
        }
        md.renderer.rules.paragraph_close = (tokens, idx) => {
            const inList = tokens.some((token, i) => i < idx && token.type === 'list_item_open' && !token.hidden)
            return inList ? '</span>' : '</div>'
        }

        md.renderer.rules.heading_open = (tokens, idx) => {
            const tag = tokens[idx].tag
            return `<${tag} class="${printStyles.value[tag]}">`
        }

        md.renderer.rules.bullet_list_open = () => `<ul class="${printStyles.value.ul}">`
        md.renderer.rules.ordered_list_open = () => `<ol class="${printStyles.value.ol}">`

        md.renderer.rules.list_item_open = (tokens, idx) => {
            if (tokens[idx].map && tokens[idx].map.length > 0) {
                if (tokens[idx + 2]?.type === 'task_list_item_open') {
                    const checked = tokens[idx + 2].checked
                    return `<li class="${printStyles.value.li}"><input type="checkbox" ${checked ? 'checked' : ''} disabled> `
                }
            }
            return `<li class="${printStyles.value.li}">`
        }

        md.renderer.rules.code_inline = (tokens, idx) =>
            `<code class="${printStyles.value.code}">${tokens[idx].content}</code>`

        md.renderer.rules.blockquote_open = () =>
            `<blockquote class="${printStyles.value.blockquote}">`

        md.renderer.rules.hr = () => `<hr class="${printStyles.value.hr}">`
        md.renderer.rules.em_open = () => `<em class="${printStyles.value.em}">`
        md.renderer.rules.strong_open = () => `<strong class="${printStyles.value.strong}">`

        md.renderer.rules.link_open = (tokens, idx) => {
            const href = tokens[idx].attrGet('href')
            return `<a href="${href}" class="${printStyles.value.a}" target="_blank" rel="noopener">`
        }

        md.renderer.rules.image = (tokens, idx) => {
            const token = tokens[idx]
            const src = token.attrGet('src')
            const alt = token.content
            const title = token.attrGet('title')
            return `<img src="${src}" alt="${alt}" title="${title || ''}" class="${printStyles.value.img}">`
        }

        md.renderer.rules.table_open = () => `<table class="${printStyles.value.table}">`
        md.renderer.rules.th_open = () => `<th class="${printStyles.value.th}">`
        md.renderer.rules.td_open = () => `<td class="${printStyles.value.td}">`

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
