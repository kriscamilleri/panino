/**
 * Links between Documents in exports and imports
 * (docs/specs/active/editor-toc-and-internal-links.md §6.7). A ZIP export turns
 * `panino:doc/<id>[#slug]` into a relative path to the exported `.md` file, which
 * Obsidian, VS Code and GitHub follow; an import turns relative `.md` links to files in
 * the same import, and links to Documents' old ids, into `panino:doc/<new id>`.
 *
 * Only link destinations right after `](` are touched, and every scan is linear: a
 * destination ends at the first `(`, `)`, `<`, `>` or whitespace.
 */
import { isValidSlug, decodeFragment } from '@panino/content-merge/document-outline'
import { isDocumentId, parseDocumentHref } from '@panino/content-merge/document-links'

const DOC_PREFIX = 'panino:doc/'
const STOP = new Set(['(', ')', '<', '>', ' ', '\t', '\n', '\r'])
const MAX_DESTINATION = 2048

/**
 * Call `replace` on every inline link destination; it returns the new destination or null.
 *
 * @param {string} markdown
 * @param {(destination: string) => string|null} replace
 * @returns {string}
 */
export function mapLinkDestinations(markdown, replace) {
    const text = String(markdown ?? '')
    let out = ''
    let copied = 0
    let from = 0
    while (from < text.length) {
        const at = text.indexOf('](', from)
        if (at === -1) break
        const start = at + 2
        let end = start
        while (end < text.length && end - start < MAX_DESTINATION && !STOP.has(text[end])) end += 1
        // A destination that ends anywhere but `)` or a space (a title) is not one we rewrite.
        const next = text[end]
        if (end > start && (next === ')' || next === ' ')) {
            const replacement = replace(text.slice(start, end))
            if (replacement !== null && replacement !== undefined) {
                out += text.slice(copied, start) + replacement
                copied = end
            }
        }
        from = Math.max(end, start)
    }
    return copied === 0 ? text : out + text.slice(copied)
}

/** Percent-encode one path segment for a Markdown destination. */
function encodeSegment(segment) {
    return encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/**
 * The relative path from one file to another, both given from the export root.
 *
 * @param {string} fromFile e.g. `Notes/Plan.md`
 * @param {string} toFile e.g. `Proposals/Project plan.md`
 * @returns {string} e.g. `../Proposals/Project%20plan.md`
 */
export function relativeFilePath(fromFile, toFile) {
    const from = String(fromFile).split('/').slice(0, -1)
    const to = String(toFile).split('/')
    let shared = 0
    while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1
    const up = from.length - shared
    const parts = [...Array(up).fill('..'), ...to.slice(shared).map(encodeSegment)]
    return parts.join('/')
}

/**
 * Resolve a relative path against a file's folder. Null when it leaves the root.
 *
 * @param {string} fromFile
 * @param {string} relative already percent-decoded
 * @returns {string|null}
 */
export function resolveRelativePath(fromFile, relative) {
    const parts = String(fromFile).split('/').slice(0, -1)
    for (const segment of String(relative).split('/')) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (!parts.length) return null
            parts.pop()
        } else {
            parts.push(segment)
        }
    }
    return parts.join('/')
}

/**
 * ZIP export: links to Documents in the export become relative `.md` paths. A target
 * outside the export stays `panino:doc/…`.
 *
 * @param {string} markdown
 * @param {string} fromFile this Document's path in the export, with `.md`
 * @param {(id: string) => string|null} fileForId a Document's path in the export, with `.md`
 * @returns {string}
 */
export function rewriteLinksForExport(markdown, fromFile, fileForId) {
    if (String(markdown ?? '').toLowerCase().indexOf(DOC_PREFIX) === -1) return String(markdown ?? '')
    return mapLinkDestinations(markdown, (destination) => {
        const parsed = parseDocumentHref(destination)
        if (parsed?.kind !== 'doc') return null
        const target = fileForId(parsed.id)
        if (!target) return null
        const path = target === fromFile ? '' : relativeFilePath(fromFile, target)
        if (!path && !parsed.heading) return encodeSegment(target.split('/').pop())
        return parsed.heading ? `${path}#${encodeURIComponent(parsed.heading)}` : path
    })
}

/**
 * An import: relative `.md` links to files in the same import, and `panino:doc/<old id>`
 * links to Documents in it, become `panino:doc/<new id>`. Anything else is left as it is.
 * Paths are matched against the import's own file list, never looked up on disk.
 *
 * @param {string} markdown
 * @param {string|null} fromFile this file's path in the import, or null (JSON)
 * @param {{ idForFile?: (path: string) => string|null, idForOldId?: (id: string) => string|null }} maps
 * @returns {string}
 */
export function rewriteLinksForImport(markdown, fromFile, { idForFile = () => null, idForOldId = () => null } = {}) {
    const text = String(markdown ?? '')
    const lower = text.toLowerCase()
    if (lower.indexOf('.md') === -1 && lower.indexOf(DOC_PREFIX) === -1) return text
    return mapLinkDestinations(text, (destination) => {
        const parsed = parseDocumentHref(destination)
        if (parsed?.kind === 'doc') {
            const id = idForOldId(parsed.id)
            if (!id || !isDocumentId(id)) return null
            return parsed.heading ? `${DOC_PREFIX}${id}#${parsed.heading}` : `${DOC_PREFIX}${id}`
        }
        if (parsed || fromFile === null || /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('/') || destination.startsWith('#')) {
            return null
        }
        const hash = destination.indexOf('#')
        const pathPart = hash === -1 ? destination : destination.slice(0, hash)
        if (!/\.md$/i.test(pathPart)) return null
        const decoded = decodeFragment(pathPart)
        if (decoded === null) return null
        const resolved = resolveRelativePath(fromFile, decoded)
        if (!resolved) return null
        const id = idForFile(resolved)
        if (!id || !isDocumentId(id)) return null
        let heading = hash === -1 ? null : decodeFragment(destination.slice(hash + 1))
        if (heading !== null && !isValidSlug(heading)) heading = null
        return heading ? `${DOC_PREFIX}${id}#${heading}` : `${DOC_PREFIX}${id}`
    })
}
