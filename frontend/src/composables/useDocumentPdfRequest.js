import DOMPurify from 'dompurify'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { useStylePresetStore } from '@/store/stylePresetStore'
import { buildPdfRequest, normalizePaperSize } from '@/utils/pdfExport'
import { usePdfDocumentLinks } from '@/composables/usePdfDocumentLinks'

/**
 * The `/render-pdf` request for the selected Document, made the way Export makes
 * it: the Document's print style (its own, its folder's, or the Default), its
 * front-matter variables applied, sanitized HTML. Pending edits are saved first,
 * so the PDF matches what is on screen.
 */
export function useDocumentPdfRequest() {
    const docStore = useDocStore()
    const draftStore = useDraftStore()
    const editorStore = useEditorStore()
    const markdownStore = useMarkdownStore()
    const stylePresetStore = useStylePresetStore()
    const { renderPdfHtml } = usePdfDocumentLinks()

    /**
     * @param {{ pageSize?: string, documentLinks?: 'pdf'|'text' }} [options] the paper size
     *   defaults to the print style's; links to other Documents print as text unless
     *   `documentLinks: 'pdf'`, which marks those that resolve for the author so the API
     *   links them to the web app
     * @returns {Promise<object|null>} the request body, or null with no Document selected
     */
    async function buildForSelected({ pageSize, documentLinks = 'text' } = {}) {
        const file = docStore.selectedFile
        if (!file) return null
        await editorStore.flushPendingSave()
        const markdown = draftStore.getDraft(file.id) ?? file.content ?? ''
        const styles = stylePresetStore.resolveForSelected('print', markdown).values
        const md = await markdownStore.getPrintMarkdownIt(styles, { documentLinks })
        const html = documentLinks === 'pdf'
            ? await renderPdfHtml(md, markdown, file)
            : md.render(markdownStore.applyMetadataVariables(markdown), { documentId: file.id })
        return buildPdfRequest({
            html: DOMPurify.sanitize(html),
            cssStyles: markdownStore.buildPrintCss(styles),
            printStyles: styles,
            sanitize: (html) => DOMPurify.sanitize(html),
            pageSize: pageSize || normalizePaperSize(styles?.pageSize),
        })
    }

    return { buildForSelected }
}
