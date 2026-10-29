import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { renderArticleHtml } from '@/addons/odoo/utils/article'

/**
 * The selected Document as Knowledge article HTML: pending edits saved first,
 * front-matter variables applied, rendered and sanitized like the Preview.
 */
export function useDocumentArticle() {
    const docStore = useDocStore()
    const draftStore = useDraftStore()
    const editorStore = useEditorStore()
    const markdownStore = useMarkdownStore()

    /**
     * @returns {Promise<string|null>} the HTML, or null with no Document selected
     */
    async function buildForSelected() {
        const file = docStore.selectedFile
        if (!file) return null
        await editorStore.flushPendingSave()
        const markdown = draftStore.getDraft(file.id) ?? file.content ?? ''
        return renderArticleHtml(markdownStore.applyMetadataVariables(markdown))
    }

    return { buildForSelected }
}
