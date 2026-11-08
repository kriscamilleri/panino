import { useRouter } from 'vue-router'
import { parseDocumentHref, APP_ROUTE_LINK_TITLE } from '@panino/content-merge/document-links'
import { decodeFragment } from '@panino/content-merge/document-outline'
import { useDocStore } from '@/store/docStore'
import { useEditorStore } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { useDocumentLinkStore } from '@/store/documentLinkStore'
import { documentLocation } from '@/utils/editorLinks'
import { attributeSelectorValue } from '@/utils/previewLinks'

export const UNAVAILABLE_MESSAGE = "This Document isn't available. It may have been deleted, or it isn't shared with you."
export const UNRESOLVED_TITLE = 'Not found, or not shared with you'
/** At most this many distinct Document ids are decorated per render. */
export const MAX_DECORATED_IDS = 500

/**
 * Following and decorating links to headings and other Documents
 * (docs/specs/active/editor-toc-and-internal-links.md §6.5). The Preview and the editor
 * both follow links through here, so a link behaves the same wherever it is clicked.
 */
export function useDocumentLinks() {
    const router = useRouter()
    const docStore = useDocStore()
    const editorStore = useEditorStore()
    const ui = useUiStore()
    const linkStore = useDocumentLinkStore()

    /**
     * Open another Document (or scroll, for a link to the open one). Resolves the id
     * locally first; an id this device cannot open shows one message whatever the reason.
     *
     * @param {{ id: string, heading?: string|null }} link
     * @param {{ onSameDocument?: (heading: string|null) => void }} [options]
     * @returns {Promise<boolean>} whether it went somewhere
     */
    async function followDocument({ id, heading = null }, { onSameDocument } = {}) {
        const current = docStore.selectedFile
        if (current?.id && String(current.id).toLowerCase() === String(id).toLowerCase()) {
            if (onSameDocument) onSameDocument(heading)
            else linkStore.requestHeading(heading)
            return true
        }
        const target = (await docStore.resolveDocuments([id], { preferDbKey: current?.dbKey || null })).get(String(id).toLowerCase())
        if (!target) {
            ui.addToast(UNAVAILABLE_MESSAGE, 'info')
            return false
        }
        await editorStore.flushPendingSave()
        const query = { dbKey: target.dbKey }
        if (heading) query.heading = heading
        await router.push({ name: 'doc', params: { fileId: target.id }, query })
        return true
    }

    /**
     * Follow a link written in the editor: a Document or a heading in the app, a web or
     * mail address in a new tab, nothing else.
     *
     * @param {string} href as written in the Markdown
     * @param {{ onHeading: (slug: string) => void }} handlers
     * @returns {Promise<boolean>}
     */
    async function followHref(href, { onHeading }) {
        const value = String(href ?? '').trim()
        const parsed = parseDocumentHref(value)
        if (parsed?.kind === 'doc') {
            return followDocument(parsed, { onSameDocument: (slug) => (slug ? onHeading(slug) : onHeading(null)) })
        }
        if (parsed?.kind === 'invalid') {
            ui.addToast(UNAVAILABLE_MESSAGE, 'info')
            return false
        }
        if (value.startsWith('#/')) {
            ui.addToast(APP_ROUTE_LINK_TITLE, 'info')
            return false
        }
        if (value.startsWith('#')) {
            const slug = decodeFragment(value.slice(1))
            if (slug) onHeading(slug)
            return Boolean(slug)
        }
        if (/^(https?:|mailto:)/i.test(value)) {
            window.open(value, '_blank', 'noopener,noreferrer')
            return true
        }
        return false
    }

    /**
     * Mark links in rendered, sanitized HTML through DOM APIs only: every Document link
     * gets a title with the current title and location, or the broken style; a heading
     * link whose heading is not in the content is broken; headings take focus.
     *
     * @param {HTMLElement} root
     * @returns {Promise<void>}
     */
    async function decorate(root) {
        if (!root) return
        for (const heading of root.querySelectorAll('h1[id^="pn-"], h2[id^="pn-"], h3[id^="pn-"], h4[id^="pn-"], h5[id^="pn-"], h6[id^="pn-"]')) {
            heading.setAttribute('tabindex', '-1')
        }
        // A fragment that matches nothing in the content goes nowhere.
        for (const anchor of root.querySelectorAll('a[href^="#"]:not([data-pn-doc])')) {
            const href = anchor.getAttribute('href')
            if (href === '#' || href.startsWith('#/')) continue
            const id = decodeFragment(href.slice(1))
            const found = id !== null && (root.querySelector(`[id="${attributeSelectorValue(id)}"]`)
                || root.querySelector(`[id="${attributeSelectorValue(`pn-${id}`)}"]`))
            if (!found) anchor.classList.add('pn-link-broken')
        }
        const anchors = [...root.querySelectorAll('a[data-pn-doc]')]
        if (!anchors.length) return
        const ids = [...new Set(anchors.map((a) => a.getAttribute('data-pn-doc')))].slice(0, MAX_DECORATED_IDS)
        const resolved = await docStore.resolveDocuments(ids, { preferDbKey: docStore.selectedFile?.dbKey || null })
        for (const anchor of anchors) {
            if (!anchor.isConnected) continue
            const id = anchor.getAttribute('data-pn-doc')
            if (!resolved.has(id)) continue
            const target = resolved.get(id)
            if (target) {
                anchor.classList.remove('pn-link-broken')
                anchor.setAttribute('title', `${target.title} — ${documentLocation(target)}`)
            } else {
                anchor.classList.add('pn-link-broken')
                anchor.setAttribute('title', UNRESOLVED_TITLE)
            }
        }
    }

    return { followDocument, followHref, decorate }
}

