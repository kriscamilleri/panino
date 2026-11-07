/**
 * The `/render-pdf` request for a Document in a sync (docs/specs/active/odoo-integration.md
 * §11, "Server-side rendering", Phase 12): built the way Export builds it in the browser.
 * The builder lives in core (`documentPdf.js`) because the AI agents add-on exports PDFs
 * the same way, and add-ons may not import each other. This module keeps the names the
 * sync and its tests use.
 */

export { accountPrintStyles, folderTrail, styleLibrary } from '../../documentPdf.js';
export { buildDocumentPdfRequest as buildSyncPdfRequest } from '../../documentPdf.js';
