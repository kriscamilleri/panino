// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import OverType from 'overtype'
import { patchLinkTooltip, useOverTypePatches } from '@/composables/useOverTypePatches'

describe('OverType patches for links', () => {
    it('leaves Ctrl/Cmd+K unhandled so Panino opens its picker, and keeps bold', () => {
        useOverTypePatches()
        // A test fails here if an OverType upgrade moves or renames the shortcut manager.
        expect(typeof OverType.ShortcutsManager?.prototype?.handleKeydown).toBe('function')
        const insertLink = vi.fn()
        const toggleBold = vi.fn()
        const manager = Object.create(OverType.ShortcutsManager.prototype)
        manager.editor = { toolbar: { handleAction: (action) => (action === 'insertLink' ? insertLink() : toggleBold()) } }
        manager.textarea = document.createElement('textarea')
        const key = (k) => ({ key: k, ctrlKey: true, metaKey: true, shiftKey: false, preventDefault: vi.fn() })
        const k = key('k')
        expect(manager.handleKeydown(k)).toBe(false)
        expect(k.preventDefault).not.toHaveBeenCalled()
        expect(insertLink).not.toHaveBeenCalled()
        expect(manager.handleKeydown(key('b'))).toBe(true)
        expect(toggleBold).toHaveBeenCalled()
    })

    it('routes the link tooltip through Panino for internal links, a new tab for web links', () => {
        const container = document.createElement('div')
        const element = document.createElement('div')
        let clicks = 0
        element.addEventListener('click', () => { clicks += 1 })
        container.appendChild(element)
        const tooltip = { tooltip: element, currentLink: null, hide: vi.fn(), cancelHide: vi.fn(), scheduleHide: vi.fn() }
        const follow = vi.fn()
        const open = vi.spyOn(window, 'open').mockImplementation(() => null)

        expect(patchLinkTooltip({ linkTooltip: tooltip }, follow)).toBe(true)
        expect(tooltip.tooltip).not.toBe(element)
        expect(patchLinkTooltip({ linkTooltip: tooltip }, follow)).toBe(false)

        tooltip.currentLink = { url: 'panino:doc/6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c#budget' }
        tooltip.tooltip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(follow).toHaveBeenCalledWith('panino:doc/6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c#budget')
        expect(open).not.toHaveBeenCalled()

        tooltip.currentLink = { url: 'https://example.com' }
        tooltip.tooltip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
        // OverType's own handler, bound to the old element, never runs.
        expect(clicks).toBe(0)
        open.mockRestore()
    })
})
