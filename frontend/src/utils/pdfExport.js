/**
 * Building and sending a `/render-pdf` request. Shared by the print styles
 * page and the phone Export sheet so both send the same sanitized payload.
 */

export const PAPER_SIZES = Object.freeze(['A4', 'Letter']);
export const PDF_TIMEOUT_MS = 90000;

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

/**
 * Send the request and return the PDF. Rejects with an `AbortError` after
 * `timeoutMs`, and with the server's text on any other failure.
 *
 * @param {object} input
 * @param {string} input.apiUrl
 * @param {string} input.token
 * @param {object} input.body result of buildPdfRequest
 * @param {number} [input.timeoutMs]
 * @param {typeof fetch} [input.fetchImpl]
 * @returns {Promise<Blob>}
 */
export async function requestPdf({ apiUrl, token, body, timeoutMs = PDF_TIMEOUT_MS, fetchImpl = fetch }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${apiUrl}/render-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`PDF generation failed: ${text}`);
        }
        return await response.blob();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * A safe download name for a Document's PDF.
 *
 * @param {string} title
 * @returns {string}
 */
export function pdfFileName(title) {
    const base = String(title ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return `${base || 'Document'}.pdf`;
}
