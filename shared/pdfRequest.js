/**
 * Building a `/render-pdf` request. Shared by the print styles page, the phone
 * Export sheet and the API's Odoo syncs, so every PDF of a Document is made
 * from the same payload.
 */

export const PAPER_SIZES = Object.freeze(['A4', 'Letter']);

/**
 * @param {unknown} value
 * @returns {'A4'|'Letter'} A4 unless Letter was asked for
 */
export function normalizePaperSize(value) {
    return value === 'Letter' ? 'Letter' : 'A4';
}

/**
 * The request body. Every HTML fragment goes through `sanitize`; a paper size
 * override replaces the saved one for this export only.
 *
 * @param {object} input
 * @param {string} input.html rendered Document HTML
 * @param {string} input.cssStyles print CSS
 * @param {object} input.printStyles saved print style settings
 * @param {(html: string) => string} input.sanitize
 * @param {string} [input.pageSize] 'A4' or 'Letter'
 * @returns {{ htmlContent: string, cssStyles: string, printStyles: object }}
 */
export function buildPdfRequest({ html, cssStyles, printStyles = {}, sanitize, pageSize }) {
    return {
        htmlContent: sanitize(html),
        cssStyles,
        printStyles: {
            ...printStyles,
            printHeaderHtml: sanitize(printStyles.printHeaderHtml || ''),
            printFooterHtml: sanitize(printStyles.printFooterHtml || ''),
            ...(pageSize ? { pageSize: normalizePaperSize(pageSize) } : {}),
        },
    };
}
