import DOMPurify from 'dompurify'
import { renderDocumentHtml } from '@panino/content-merge/markdown-render'

/**
 * Render a Document for Odoo Knowledge (docs/specs/active/odoo-integration.md §7):
 * the shared renderer the Preview and the API use, without Panino's print
 * styling, then sanitized. The server sanitizes again, turns task lists into
 * Knowledge checklists and uploads the images.
 *
 * @param {string} markdown with front-matter variables already applied
 * @returns {string}
 */
export function renderArticleHtml(markdown) {
    return DOMPurify.sanitize(renderDocumentHtml(markdown))
}
