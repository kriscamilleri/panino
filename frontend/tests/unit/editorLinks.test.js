import { describe, expect, it } from 'vitest'
import {
    documentLinkMarkdown,
    documentLocation,
    headingLinkMarkdown,
    headingOffset,
    isWebAddress,
    linkAt,
    linkDestination,
    pastedDocumentId,
    replaceRange,
    wikilinkQueryAt,
} from '@/utils/editorLinks'
import { relativeFilePath, resolveRelativePath, rewriteLinksForExport, rewriteLinksForImport } from '@/utils/documentLinkPaths'

const ID = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const NEW = '11111111-2222-4333-8444-555555555555'

describe('the [[ trigger', () => {
    it('finds the query typed after [[ on the caret line', () => {
        expect(wikilinkQueryAt('see [[', 6)).toEqual({ start: 4, end: 6, query: '' })
        expect(wikilinkQueryAt('see [[proj', 10)).toEqual({ start: 4, end: 10, query: 'proj' })
        expect(wikilinkQueryAt('[[#bud', 6)).toEqual({ start: 0, end: 6, query: '#bud' })
    })

    it('ignores closed, escaped, triple and multi-line brackets', () => {
        expect(wikilinkQueryAt('[[done]] x', 10)).toBeNull()
        expect(wikilinkQueryAt('\\[[x', 4)).toBeNull()
        expect(wikilinkQueryAt('[[[x', 4)).toBeNull()
        expect(wikilinkQueryAt('[[a\nb', 5)).toBeNull()
        expect(wikilinkQueryAt(`[[${'x'.repeat(500)}`, 502)).toBeNull()
    })
})

describe('the link under the caret', () => {
    it('finds [label](href) on the line, with titles and angle brackets', () => {
        const text = `a [Plan](panino:doc/${ID}#budget) b [Web](https://x.y "T") c [Sp](<a b.md>)`
        expect(linkAt(text, 5)).toMatchObject({ label: 'Plan', href: `panino:doc/${ID}#budget` })
        expect(linkAt(text, text.indexOf('Web'))).toMatchObject({ href: 'https://x.y' })
        expect(linkAt(text, text.indexOf('Sp'))).toMatchObject({ href: 'a b.md' })
        expect(linkAt(text, 1)).toBeNull()
        expect(linkAt('[a] (b)', 2)).toBeNull()
    })

    it('stays linear on a hostile 2 MiB line', () => {
        const started = Date.now()
        linkAt('[a]('.repeat(512 * 1024), 1000)
        linkAt('['.repeat(2 * 1024 * 1024), 5)
        linkAt('[a](b)'.repeat(350000), 2 * 1024 * 1024 - 3)
        expect(Date.now() - started).toBeLessThan(3000)
    })
})

describe('pasted addresses', () => {
    const origin = 'https://panino.sh'
    it('recognises this app\'s Document addresses only', () => {
        expect(pastedDocumentId(`https://panino.sh/#/doc/${ID}?dbKey=user:x`, origin)).toBe(ID)
        expect(pastedDocumentId(`https://panino.sh/#/doc/${ID.toUpperCase()}`, origin)).toBe(ID)
        expect(pastedDocumentId(`https://evil.example/#/doc/${ID}`, origin)).toBeNull()
        expect(pastedDocumentId('https://panino.sh/#/doc/nope', origin)).toBeNull()
        expect(pastedDocumentId(`https://panino.sh/other#/doc/${ID}`, origin)).toBeNull()
        expect(pastedDocumentId(`two words https://panino.sh/#/doc/${ID}`, origin)).toBeNull()
    })
})

describe('link Markdown', () => {
    it('escapes titles and heading text, and keeps an author label as written', () => {
        expect(documentLinkMarkdown({ id: ID, title: 'Plan [v2] *draft*' })).toBe(`[Plan \\[v2\\] \\*draft\\*](panino:doc/${ID})`)
        expect(documentLinkMarkdown({ id: ID, title: 'Plan' }, { slug: 'budget', text: 'Budget' })).toBe(`[Budget](panino:doc/${ID}#budget)`)
        expect(documentLinkMarkdown({ id: ID, title: 'Plan' }, null, 'my words')).toBe(`[my words](panino:doc/${ID})`)
        expect(headingLinkMarkdown({ slug: 'qa', text: 'Q&A' })).toBe('[Q&A](#qa)')
    })

    it('recognises web addresses and wraps awkward ones', () => {
        expect(isWebAddress('https://example.com/a')).toBe(true)
        expect(isWebAddress('mailto:a@b.c')).toBe(true)
        expect(isWebAddress('javascript:alert(1)')).toBe(false)
        expect(isWebAddress('example.com')).toBe(false)
        expect(linkDestination('https://x.y/a_(b)')).toBe('<https://x.y/a_(b)>')
        expect(linkDestination('https://x.y/a')).toBe('https://x.y/a')
    })

    it('describes locations and replaces ranges', () => {
        expect(documentLocation({ spaceName: 'Acme', folderPath: 'Proposals / 2026' })).toBe('Acme space · Proposals / 2026')
        expect(documentLocation({ folderPath: '' })).toBe('No folder')
        expect(replaceRange({ value: 'a [[pro b' }, 2, 7, 'X')).toEqual({ value: 'a X b', selectionStart: 3, selectionEnd: 3 })
    })

    it('finds a heading line below front matter', () => {
        const text = '---\ntitle: T\n---\nintro\n\n## Budget\n'
        expect(text.slice(headingOffset(text, 'budget'))).toBe('## Budget\n')
        expect(headingOffset(text, 'missing')).toBeNull()
    })
})

describe('links in exports and imports', () => {
    it('builds relative paths and resolves them back', () => {
        expect(relativeFilePath('Notes/Plan.md', 'Proposals/Project plan.md')).toBe('../Proposals/Project%20plan.md')
        expect(relativeFilePath('Plan.md', 'A/B (1).md')).toBe('A/B%20%281%29.md')
        expect(relativeFilePath('A/x.md', 'A/y.md')).toBe('y.md')
        expect(resolveRelativePath('Notes/Plan.md', '../Proposals/Project plan.md')).toBe('Proposals/Project plan.md')
        expect(resolveRelativePath('Plan.md', '../../x.md')).toBeNull()
    })

    it('rewrites Document links to relative .md paths on export, leaving others', () => {
        const files = new Map([[ID, 'Proposals/Project plan.md']])
        const out = rewriteLinksForExport(`[a](panino:doc/${ID}#budget) [b](panino:doc/${NEW}) [c](https://x.y)`, 'Notes/Plan.md', (id) => files.get(id) || null)
        expect(out).toBe(`[a](../Proposals/Project%20plan.md#budget) [b](panino:doc/${NEW}) [c](https://x.y)`)
    })

    it('rewrites relative .md links and old ids on import, and nothing else', () => {
        const ids = new Map([['Proposals/Project plan.md', NEW]])
        const out = rewriteLinksForImport(
            `[a](../Proposals/Project%20plan.md#budget) [b](panino:doc/${ID}) [c](missing.md) [d](https://x.y/a.md) [e](/abs.md)`,
            'Notes/Plan.md',
            { idForFile: (path) => ids.get(path) || null, idForOldId: (id) => (id === ID ? NEW : null) },
        )
        expect(out).toBe(`[a](panino:doc/${NEW}#budget) [b](panino:doc/${NEW}) [c](missing.md) [d](https://x.y/a.md) [e](/abs.md)`)
    })

    it('stays linear on hostile link-heavy text', () => {
        const started = Date.now()
        rewriteLinksForImport('](a'.repeat(700000), 'x.md', { idForFile: () => null })
        rewriteLinksForImport(`](${'a'.repeat(2 * 1024 * 1024)}.md`, 'x.md', { idForFile: () => null })
        rewriteLinksForExport('](panino:doc/'.repeat(150000), 'x.md', () => null)
        expect(Date.now() - started).toBeLessThan(3000)
    })
})
