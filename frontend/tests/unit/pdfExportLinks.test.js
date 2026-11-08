import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentRenderer } from '@panino/content-merge/markdown-render'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const KNOWN = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const GONE = '11111111-2222-4333-8444-555555555555'

const hoisted = vi.hoisted(() => ({
    resolveDocuments: vi.fn(),
    renderOptions: [],
    file: { id: 'self', dbKey: 'user:me', content: '' },
}))

vi.mock('dompurify', () => ({ default: { sanitize: (html) => html } }))
vi.mock('@/store/docStore', () => ({
    useDocStore: () => ({ selectedFile: hoisted.file, resolveDocuments: hoisted.resolveDocuments }),
}))
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }))
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => ({ flushPendingSave: vi.fn(async () => {}) }) }))
vi.mock('@/store/stylePresetStore', () => ({ useStylePresetStore: () => ({ resolveForSelected: () => ({ values: {} }) }) }))
vi.mock('@/store/markdownStore', () => ({
    useMarkdownStore: () => ({
        applyMetadataVariables: (text) => text,
        buildPrintCss: () => '',
        getPrintMarkdownIt: async (styles, options = {}) => {
            hoisted.renderOptions.push(options)
            return createDocumentRenderer({ documentLinks: options.documentLinks === 'pdf' ? 'pdf' : 'text' })
        },
    }),
}))
vi.mock('@/utils/pdfExport', () => ({
    buildPdfRequest: ({ html }) => ({ htmlContent: html }),
    normalizePaperSize: (size) => size || 'A4',
}))

const { useDocumentPdfRequest } = await import('@/composables/useDocumentPdfRequest')

const MARKDOWN = `## Budget\n\n[Known](panino:doc/${KNOWN}#budget) [Gone](panino:doc/${GONE}) [Here](panino:doc/self#budget) [Up](#budget)`

beforeEach(() => {
    hoisted.renderOptions = []
    hoisted.file = { id: 'self', dbKey: 'user:me', content: MARKDOWN }
    hoisted.resolveDocuments.mockReset()
    hoisted.resolveDocuments.mockImplementation(async (ids) => new Map(ids.map((id) => [id, id === KNOWN ? { id, dbKey: 'user:me' } : null])))
})

describe('PDFs made in the browser', () => {
    it("render 'text' by default: no Document is marked for a web-app link", async () => {
        const { buildForSelected } = useDocumentPdfRequest()
        const { htmlContent } = await buildForSelected()
        expect(hoisted.renderOptions).toEqual([{ documentLinks: 'text' }])
        expect(htmlContent).toContain('<span class="pn-doc-link">Known</span>')
        expect(htmlContent).not.toContain('data-pn-doc')
        expect(hoisted.resolveDocuments).not.toHaveBeenCalled()
        expect(htmlContent).toContain('<a href="#pn-budget" data-pn-heading="budget">Up</a>')
    })

    it("render 'pdf' when asked, marking only the ids that resolve for the author", async () => {
        const { buildForSelected } = useDocumentPdfRequest()
        const { htmlContent } = await buildForSelected({ documentLinks: 'pdf' })
        expect(hoisted.resolveDocuments).toHaveBeenCalledWith([KNOWN, GONE], { preferDbKey: 'user:me' })
        expect(htmlContent).toContain(`<a class="pn-doc-link" data-pn-doc="${KNOWN}" data-pn-heading="budget">Known</a>`)
        expect(htmlContent).toContain('<span class="pn-doc-link">Gone</span>')
        expect(htmlContent).not.toContain('href="panino:')
    })

    it('the export screens ask for pdf links', () => {
        const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
        for (const file of ['../../src/pages/PrintStylesPage.vue', '../../src/components/phone/ExportSheet.vue']) {
            const source = read(file)
            expect(source).toContain("getPrintMarkdownIt(")
            expect(source).toContain("{ documentLinks: 'pdf' }")
            expect(source).toContain('renderPdfHtml(md,')
        }
    })
})
