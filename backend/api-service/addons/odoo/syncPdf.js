/**
 * The `/render-pdf` request for a Document in a sync (docs/specs/shipped/odoo-integration.md
 * §11, "Server-side rendering", Phase 12): built the way Export builds it in the browser.
 * The builder lives in core (`documentPdf.js`) because the AI agents add-on exports PDFs
 * the same way, and add-ons may not import each other. This module keeps the names the
 * sync and its tests use.
 */

import { buildDocumentPdfRequest } from '../../documentPdf.js';

export { accountPrintStyles, folderTrail, styleLibrary } from '../../documentPdf.js';

/**
 * The core builder with links to other Documents marked for the PDF
 * (docs/specs/active/editor-toc-and-internal-links.md §6.8, N1): the renderPdf calls in
 * this add-on pass `appLinks`, so those links open the Document in the Panino web app.
 * The sync hash covers the Markdown, CSS and print styles, so this refiles nothing.
 *
 * @param {Parameters<typeof buildDocumentPdfRequest>[0]} input
 * @returns {ReturnType<typeof buildDocumentPdfRequest>}
 */
export function buildSyncPdfRequest(input) {
    return buildDocumentPdfRequest({ ...input, documentLinks: 'pdf' });
}
