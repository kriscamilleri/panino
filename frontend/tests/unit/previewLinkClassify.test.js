// @vitest-environment jsdom
// classifyPreviewLink: a hand-written app route never navigates the Preview,
// whatever relative form it takes (review, 2026-11-08).
import { describe, expect, it } from 'vitest'
import { classifyPreviewLink } from '@/utils/previewLinks'

function anchor(href) {
    const root = document.createElement('div')
    const a = document.createElement('a')
    a.setAttribute('href', href)
    root.appendChild(a)
    return { root, a }
}

describe('classifyPreviewLink', () => {
    it('makes every relative #/ route inert', () => {
        for (const href of ['#/settings', '/#/settings', './#/addons/ai/authorize?x=1', '?a#/settings']) {
            const { root, a } = anchor(href)
            expect(classifyPreviewLink(a, root).kind).toBe('inert')
        }
    })

    it('leaves absolute links external and fragments as headings', () => {
        const ext = anchor('https://example.com/#/x')
        expect(classifyPreviewLink(ext.a, ext.root).kind).toBe('external')
        const heading = anchor('#pn-intro')
        expect(classifyPreviewLink(heading.a, heading.root)).toMatchObject({ kind: 'heading', slug: 'intro' })
    })
})
