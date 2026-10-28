import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'
import DOMPurify from 'dompurify'

/**
 * Render a Document for Odoo Knowledge (docs/specs/active/odoo-integration.md §7):
 * the same MarkdownIt setup as the Preview, without Panino's print styling, then
 * sanitized. The server sanitizes again, turns task lists into Knowledge
 * checklists and replaces images with placeholders.
 *
 * @param {string} markdown with front-matter variables already applied
 * @returns {string}
 */
export function renderArticleHtml(markdown) {
    const md = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(markdownItTaskLists)
    return DOMPurify.sanitize(md.render(String(markdown ?? '')))
}
