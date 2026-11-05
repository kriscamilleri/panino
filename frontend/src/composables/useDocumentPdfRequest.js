import DOMPurify from 'dompurify'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useMarkdownStore } from '@/store/markdownStore'
import { useStylePresetStore } from '@/store/stylePresetStore'
import { buildPdfRequest, normalizePaperSize } from '@/utils/pdfExport'

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

    /**
     * @param {{ pageSize?: string }} [options] defaults to the print style's paper size
     * @returns {Promise<object|null>} the request body, or null with no Document selected
     */
    async function buildForSelected({ pageSize } = {}) {
        const file = docStore.selectedFile
        if (!file) return null
        await editorStore.flushPendingSave()
        const markdown = draftStore.getDraft(file.id) ?? file.content ?? ''
        const styles = stylePresetStore.resolveForSelected('print', markdown).values
        const md = await markdownStore.getPrintMarkdownIt(styles)
        return buildPdfRequest({
            html: DOMPurify.sanitize(md.render(markdownStore.applyMetadataVariables(markdown))),
            cssStyles: markdownStore.buildPrintCss(styles),
            printStyles: styles,
            sanitize: (html) => DOMPurify.sanitize(html),
            pageSize: pageSize || normalizePaperSize(styles?.pageSize),
        })
    }

    return { buildForSelected }
}
