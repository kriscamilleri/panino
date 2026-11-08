/**
 * Where a textarea's caret is on screen, measured with a mirror element: a hidden `div`
 * styled like the textarea holds the text before the caret and a marker span. Used to
 * place the link picker at the caret and to scroll the caret into view when the editor
 * grows to its content (OverType's `autoResize`), so an ancestor scrolls, not the textarea.
 */

const MIRRORED = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize',
    'whiteSpace', 'wordWrap', 'overflowWrap', 'wordBreak',
]

/** Text before the caret is cut to this many characters, from the caret's line back. */
const MAX_MIRROR_TEXT = 20000

/**
 * The caret's rectangle in viewport coordinates, or null when it cannot be measured.
 *
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [position] defaults to `selectionEnd`
 * @returns {{ top: number, left: number, bottom: number, height: number }|null}
 */
export function caretRect(textarea, position) {
    if (!textarea || typeof document === 'undefined' || typeof window.getComputedStyle !== 'function') return null
    const at = position ?? textarea.selectionEnd ?? 0
    const style = window.getComputedStyle(textarea)
    const mirror = document.createElement('div')
    for (const prop of MIRRORED) mirror.style[prop] = style[prop]
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.top = '0'
    mirror.style.left = '-9999px'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    mirror.style.height = 'auto'
    const value = textarea.value || ''
    // Very long texts: measure only from a line start within the last stretch. The
    // offset is then relative to that line; the caller only needs the caret's line.
    let from = 0
    let offsetTop = 0
    if (at > MAX_MIRROR_TEXT) {
        from = value.lastIndexOf('\n', at - MAX_MIRROR_TEXT) + 1
        offsetTop = null
    }
    mirror.textContent = value.slice(from, at)
    const marker = document.createElement('span')
    marker.textContent = value.slice(at, at + 1) || '.'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)
    try {
        const box = textarea.getBoundingClientRect()
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20
        if (offsetTop === null) {
            // Cut text: fall back to the line count before the caret.
            let lines = 0
            for (let i = value.indexOf('\n'); i !== -1 && i < at; i = value.indexOf('\n', i + 1)) lines += 1
            const top = box.top + Number.parseFloat(style.paddingTop || '0') + lines * lineHeight - textarea.scrollTop
            return { top, left: box.left + marker.offsetLeft, bottom: top + lineHeight, height: lineHeight }
        }
        const top = box.top + marker.offsetTop - textarea.scrollTop
        const left = box.left + marker.offsetLeft - textarea.scrollLeft
        return { top, left, bottom: top + lineHeight, height: lineHeight }
    } finally {
        mirror.remove()
    }
}

/**
 * The nearest ancestor that scrolls vertically, or the document's scrolling element.
 *
 * @param {Element|null} element
 * @returns {Element|null}
 */
export function scrollParent(element) {
    if (typeof window === 'undefined') return null
    for (let node = element?.parentElement; node; node = node.parentElement) {
        const overflowY = window.getComputedStyle(node).overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    }
    return document.scrollingElement || null
}

/**
 * Scroll the nearest scrolling ancestor so an element's top sits `margin` px below the
 * ancestor's top edge.
 *
 * @param {Element} element
 * @param {{ margin?: number, container?: Element|null }} [options]
 */
export function scrollElementToTop(element, { margin = 16, container = null } = {}) {
    if (!element) return
    const scroller = container || scrollParent(element)
    if (!scroller) return
    const isRoot = scroller === document.scrollingElement || scroller === document.documentElement
    const scrollerTop = isRoot ? 0 : scroller.getBoundingClientRect().top
    const delta = element.getBoundingClientRect().top - scrollerTop - margin
    scroller.scrollTop += delta
}

/**
 * Bring a textarea's caret into view in the ancestor that scrolls it.
 *
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [position]
 */
export function scrollCaretIntoView(textarea, position) {
    const rect = caretRect(textarea, position)
    const scroller = scrollParent(textarea)
    if (!rect || !scroller) return
    const isRoot = scroller === document.scrollingElement || scroller === document.documentElement
    const bounds = isRoot ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect()
    if (rect.top < bounds.top + 16 || rect.bottom > bounds.bottom - 16) {
        scroller.scrollTop += rect.top - bounds.top - Math.max(48, (bounds.bottom - bounds.top) / 3)
    }
}
