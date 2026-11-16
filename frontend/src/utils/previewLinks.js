/**
 * Links in the rendered Preview (docs/specs/active/editor-toc-and-internal-links.md §6.5).
 * Read from sanitized DOM only; nothing here builds HTML.
 */
import { HEADING_ID_PREFIX, decodeFragment } from '@panino/content-merge/document-outline'
import { isAppRouteHref, isDocumentId } from '@panino/content-merge/document-links'
import { scrollElementToTop } from '@/utils/caretRect'

/**
 * What a click inside the Preview landed on.
 *
 * @param {EventTarget|null} target
 * @param {HTMLElement|null} root the Preview's content element
 * @returns {null
 *   | { kind: 'heading', slug: string|null, element: HTMLAnchorElement }
 *   | { kind: 'document', id: string, heading: string|null, element: HTMLAnchorElement }
 *   | { kind: 'inert', element: Element }
 *   | { kind: 'external', element: HTMLAnchorElement }}
 */
export function classifyPreviewLink(target, root) {
    const start = target instanceof Element ? target : target?.parentElement
    const element = start?.closest?.('a')
    if (!element || (root && !root.contains(element))) return null
    const docId = element.getAttribute('data-pn-doc')
    if (docId !== null) {
        if (!isDocumentId(docId)) return { kind: 'inert', element }
        return { kind: 'document', id: docId.toLowerCase(), heading: element.getAttribute('data-pn-heading') || null, element }
    }
    const href = element.getAttribute('href')
    if (href === null) return { kind: 'inert', element }
    // An app route written by hand (`/#/settings`) is inert even if it got past the renderer.
    if (isAppRouteHref(href)) return { kind: 'inert', element }
    if (!href.startsWith('#')) return { kind: 'external', element }
    const heading = element.getAttribute('data-pn-heading')
    if (heading) return { kind: 'heading', slug: heading, element }
    const fragment = decodeFragment(href.slice(1))
    if (fragment === null) return { kind: 'inert', element }
    // `#pn-slug`, or a raw-HTML anchor id, or nothing (the top).
    const slug = fragment.startsWith(HEADING_ID_PREFIX) ? fragment.slice(HEADING_ID_PREFIX.length) : fragment
    return { kind: 'heading', slug: slug || null, element, rawId: fragment }
}

/**
 * A value made safe inside a double-quoted CSS attribute selector.
 *
 * @param {string} value
 * @returns {string}
 */
export function attributeSelectorValue(value) {
    return String(value).replace(/["\\\n\r]/g, (char) => (char === '\n' || char === '\r' ? ' ' : `\\${char}`))
}

/**
 * The element a heading slug points at inside the Preview, or null.
 *
 * @param {HTMLElement} root
 * @param {string|null} slug
 * @returns {HTMLElement|null}
 */
export function findHeadingElement(root, slug) {
    if (!root || !slug) return null
    return root.querySelector(`[id="${attributeSelectorValue(`${HEADING_ID_PREFIX}${slug}`)}"]`)
        || root.querySelector(`[id="${attributeSelectorValue(slug)}"]`)
}

/**
 * Scroll the Preview's scrolling ancestor so a heading sits 16 px below its top, then
 * focus it for screen readers. No history entry; the route is untouched. A null slug
 * scrolls to the top.
 *
 * @param {HTMLElement} root
 * @param {string|null} slug
 * @returns {boolean} whether the heading was found
 */
export function scrollToHeading(root, slug) {
    if (!root) return false
    if (!slug) {
        scrollElementToTop(root, { margin: 16 })
        return true
    }
    const element = findHeadingElement(root, slug)
    if (!element) return false
    scrollElementToTop(element, { margin: 16 })
    if (typeof element.focus === 'function') {
        if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
        element.focus({ preventScroll: true })
    }
    return true
}
