import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheetPath = fileURLToPath(new URL('../../src/assets/main.css', import.meta.url))

describe('dark preview code blocks', () => {
    it('overrides the renderer inline light code colors', async () => {
        const stylesheet = await readFile(stylesheetPath, 'utf8')

        expect(stylesheet).toContain(
            "html[data-theme='dark'] [data-testid='preview-content'] code,"
        )
        expect(stylesheet).toContain(
            'background-color: var(--pn-surface-elevated) !important;'
        )
        expect(stylesheet).toContain('color: var(--pn-text) !important;')
        expect(stylesheet).toContain(
            "html[data-theme='dark'] [data-testid='preview-content'] pre > code"
        )
        expect(stylesheet).toContain('background-color: transparent !important;')
        expect(stylesheet).toContain('color: inherit !important;')
    })

    it('uses the primary palette for the active pinned dashboard filter', async () => {
        const stylesheet = await readFile(stylesheetPath, 'utf8')

        expect(stylesheet).toContain(
            "html[data-theme='dark'] .pinned-filter-toggle[aria-pressed='true']"
        )
        expect(stylesheet).toContain(
            'background-color: var(--pn-primary) !important;'
        )
        expect(stylesheet).toContain('color: #151515 !important;')
    })
})
