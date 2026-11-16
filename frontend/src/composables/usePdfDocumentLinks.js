import { findDocumentLinkIds } from '@panino/content-merge/document-links'
import { useDocStore } from '@/store/docStore'
import { useMarkdownStore } from '@/store/markdownStore'

/**
 * Render a Document for a PDF made in the browser
 * (docs/specs/active/editor-toc-and-internal-links.md §6.3, §6.8): headings in it stay
 * internal links, and links to other Documents are marked for the API (which adds the
 * web-app address) only when they resolve for the author now. A link that is broken for
 * the author would be broken for every reader, so it prints as text.
 */
export function usePdfDocumentLinks() {
    const docStore = useDocStore()
    const markdownStore = useMarkdownStore()

    /**
     * @param {import('markdown-it')} md from `getPrintMarkdownIt(styles, { documentLinks: 'pdf' })`
     * @param {string} markdown the Document, front matter included
     * @param {{ id?: string, dbKey?: string }|null} file the Document being exported
     * @returns {Promise<string>} unsanitized HTML
     */
    async function renderPdfHtml(md, markdown, file) {
        const source = markdownStore.applyMetadataVariables(markdown)
        const ids = findDocumentLinkIds(source)
        const resolvedDocumentIds = new Set()
        if (ids.length) {
            const resolved = await docStore.resolveDocuments(ids, { preferDbKey: file?.dbKey || null })
            for (const [id, target] of resolved) if (target) resolvedDocumentIds.add(id)
        }
        return md.render(source, { documentId: file?.id || null, resolvedDocumentIds })
    }

    return { renderPdfHtml }
}
