/**
 * Pure helpers for writing and following links in the editor
 * (docs/specs/active/editor-toc-and-internal-links.md §6.4, §6.5). Every scan here is
 * bounded to the caret's line and linear in its length: a Document line can be 2 MiB.
 */
import { formatDocumentHref, isDocumentId } from '@panino/content-merge/document-links'
import { escapeInlineText } from '@panino/content-merge/marker-blocks'
import { documentOutline } from '@panino/content-merge/table-of-contents'
import { findFrontMatterBlock } from '@panino/content-merge/front-matter'

/** How far back from the caret `[[` is looked for. */
const WIKILINK_LOOKBACK = 120

/**
 * The `[[query` being typed at the caret, or null. The query runs from just after `[[`
 * to the caret, on one line, and holds no `]`.
 *
 * @param {string} value
 * @param {number} caret
 * @returns {{ start: number, end: number, query: string }|null} `start` is the offset of `[[`
 */
export function wikilinkQueryAt(value, caret) {
    const text = String(value ?? '')
    const end = Math.min(Math.max(Number(caret) || 0, 0), text.length)
    const floor = Math.max(0, end - WIKILINK_LOOKBACK)
    for (let i = end - 1; i >= floor + 1; i -= 1) {
        const char = text[i]
        if (char === '\n' || char === ']') return null
        if (char === '[' && text[i - 1] === '[') {
            // `[[[` is not a trigger, nor is an escaped `\[[`.
            if (text[i - 2] === '[' || text[i - 2] === '\\') return null
            return { start: i - 1, end, query: text.slice(i + 1, end) }
        }
    }
    return null
}

/**
 * The Markdown link `[label](href)` under an offset, on that offset's line.
 *
 * @param {string} value
 * @param {number} offset
 * @returns {{ start: number, end: number, label: string, href: string }|null}
 */
export function linkAt(value, offset) {
    const text = String(value ?? '')
    const at = Math.min(Math.max(Number(offset) || 0, 0), text.length)
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    const newline = text.indexOf('\n', at)
    const lineEnd = newline === -1 ? text.length : newline
    let i = lineStart
    while (i < lineEnd) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] !== '[') { i += 1; continue }
        // Find the label's closing bracket, allowing balanced nested brackets.
        let depth = 0
        let j = i + 1
        let close = -1
        while (j < lineEnd) {
            const char = text[j]
            if (char === '\\') { j += 2; continue }
            if (char === '[') depth += 1
            else if (char === ']') {
                if (depth === 0) { close = j; break }
                depth -= 1
            }
            j += 1
        }
        if (close === -1) return null
        if (text[close + 1] !== '(') { i = close + 1; continue }
        let k = close + 2
        let parens = 0
        let end = -1
        while (k < lineEnd) {
            const char = text[k]
            if (char === '\\') { k += 2; continue }
            if (char === '(') parens += 1
            else if (char === ')') {
                if (parens === 0) { end = k; break }
                parens -= 1
            }
            k += 1
        }
        // Nothing after this closes a destination either, as far as a linear scan can
        // tell, so stop rather than rescan the rest of the line from each bracket.
        if (end === -1) return null
        if (at >= i && at <= end) {
            const inner = text.slice(close + 2, end).trim()
            let href = inner
            if (inner.startsWith('<')) {
                const gt = inner.indexOf('>')
                href = gt === -1 ? inner : inner.slice(1, gt)
            } else {
                const space = inner.search(/\s/)
                if (space > 0) href = inner.slice(0, space)
            }
            return { start: i, end: end + 1, label: text.slice(i + 1, close), href }
        }
        i = end + 1
    }
    return null
}

/**
 * A pasted Panino address of a Document on this origin (`<origin>/#/doc/<uuid>[?…]`),
 * as its id, or null.
 *
 * @param {string} pasted
 * @param {string} origin `window.location.origin`
 * @param {string} [pathname] `window.location.pathname`, for an app served below the root
 * @returns {string|null}
 */
export function pastedDocumentId(pasted, origin, pathname = '/') {
    const text = String(pasted ?? '').trim()
    if (!text || text.length > 2048 || /\s/.test(text)) return null
    let url
    try {
        url = new URL(text)
    } catch {
        return null
    }
    if (url.origin !== origin) return null
    const base = String(pathname || '/').replace(/index\.html$/, '')
    if (url.pathname !== base && url.pathname !== `${base}index.html`) return null
    if (!url.hash.startsWith('#/doc/')) return null
    const rest = url.hash.slice('#/doc/'.length)
    const id = rest.split(/[?#/]/, 1)[0]
    return isDocumentId(id) ? id.toLowerCase() : null
}

/**
 * The Markdown for a link to another Document or a heading in it.
 *
 * @param {{ id: string, title: string }} target
 * @param {{ slug: string, text: string }|null} [heading]
 * @param {string} [label] the author's own label (a selection), used as written
 * @returns {string}
 */
export function documentLinkMarkdown(target, heading = null, label = '') {
    const text = label || escapeInlineText(heading ? heading.text : target.title) || 'Untitled'
    return `[${text}](${formatDocumentHref(target.id, heading ? heading.slug : null)})`
}

/**
 * The Markdown for a link to a heading in this Document.
 *
 * @param {{ slug: string, text: string }} heading
 * @param {string} [label]
 * @returns {string}
 */
export function headingLinkMarkdown(heading, label = '') {
    return `[${label || escapeInlineText(heading.text) || 'Untitled heading'}](#${heading.slug})`
}

/**
 * Whether the picker's text is a web address to link to as typed.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isWebAddress(text) {
    const value = String(text ?? '').trim()
    if (!value || value.length > 2048 || /\s/.test(value)) return false
    if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true
    try {
        const url = new URL(value)
        return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
    } catch {
        return false
    }
}

/**
 * A web address made safe as a link destination: `<…>` when it holds parentheses or
 * spaces would break the link.
 *
 * @param {string} url
 * @returns {string}
 */
export function linkDestination(url) {
    const value = String(url ?? '').trim()
    return /[()<>\s]/.test(value) ? `<${value.replace(/[<>]/g, encodeURIComponent)}>` : value
}

/**
 * Replace `[start, end)` of an editor state with text, the caret after it.
 *
 * @param {{ value: string }} state
 * @param {number} start
 * @param {number} end
 * @param {string} text
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }}
 */
export function replaceRange(state, start, end, text) {
    const value = String(state?.value ?? '')
    const caret = start + text.length
    return { value: value.slice(0, start) + text + value.slice(end), selectionStart: caret, selectionEnd: caret }
}

/**
 * Where a Document's location reads in the picker and in link tooltips: "Acme space ·
 * Proposals / 2026", or the folder path, or "No folder".
 *
 * @param {{ spaceName?: string|null, folderPath?: string }} target
 * @returns {string}
 */
export function documentLocation(target) {
    const folder = target?.folderPath || ''
    if (target?.spaceName) return folder ? `${target.spaceName} space · ${folder}` : `${target.spaceName} space`
    return folder || 'No folder'
}

/**
 * The offset in a Document's text of the line a heading starts on, from the outline's
 * source line plus the front matter above the body. Null when the heading is not there.
 *
 * @param {string} text the whole Document
 * @param {string} slug
 * @param {object} [variables] for `applyDocumentVariables`
 * @returns {number|null}
 */
export function headingOffset(text, slug, variables = {}) {
    const value = String(text ?? '')
    const heading = documentOutline(value, variables).find((entry) => entry.slug === slug)
    if (!heading || heading.line === null) return null
    const lines = value.split('\n')
    const front = findFrontMatterBlock(lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)))
    const target = heading.line + (front.start === -1 ? 0 : front.end + 1)
    let offset = 0
    for (let i = 0; i < target && i < lines.length; i += 1) offset += lines[i].length + 1
    return Math.min(offset, value.length)
}
