/**
 * Sales order blocks (docs/specs/active/odoo-sales-order-blocks.md): a sales
 * order from Odoo, stored in the Document as plain Markdown tables between two
 * marker comments. The opening marker holds the block's settings, so the block
 * can be refreshed; everything between the markers is Panino's and is replaced
 * on refresh. Pure functions: no stores, no network.
 *
 * Two kinds of block: a table of chosen values and columns (marker `v: 1`), and
 * a block drawn from a Markdown layout it carries (marker `v: 2`,
 * odooSaleOrderLayout.js). The layout sits as written in its own comment right
 * under the marker, so it reads (and can be edited) in the editor:
 *
 *   <!-- odoo:sale.order {"v":2,"id":20,"ref":"S00020"} -->
 *   <!-- odoo:layout
 *   ## Quotation {{order.name}}
 *   -->
 *   …what the layout drew…
 *   <!-- /odoo:sale.order -->
 *
 * Blocks written before that keep the layout in the marker's JSON (`layout`),
 * and are rewritten in the readable form on their next refresh.
 */

import { layoutFields, parseLayout, renderLayout } from './odooSaleOrderLayout'

export const BLOCK_MODEL = 'sale.order'

const START_LINE = /^<!-- odoo:sale\.order (.*) -->[ \t]*$/
const END_LINE = /^<!-- \/odoo:sale\.order -->[ \t]*$/
const LAYOUT_SECTION = /^[^\n]*\n<!-- odoo:layout\n([\s\S]*?)\n-->[ \t]*(?:\n|$)/
const ALPHANUMERIC = /[\p{L}\p{N}]/u
const ENTITY_LIKE = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i
const FIELD_NAME = /^[a-z_][a-z0-9_]{0,63}$/
const MAX_FIELDS = 30
const NUMERIC_TYPES = new Set(['integer', 'float', 'monetary'])

/**
 * @typedef {object} BlockConfig
 * @property {number} id the order id in Odoo
 * @property {string} ref the order reference when inserted, e.g. `S00042`
 * @property {string[]} fields header values, in order (from the layout for a layout block)
 * @property {string[]} columns line columns, in order (from the layout for a layout block)
 * @property {string} [layout] the block's Markdown layout; absent for a table block
 */

/**
 * @typedef {object} Block
 * @property {number} start offset of the opening marker
 * @property {number} end offset just after the closing marker (or the opening one when unclosed)
 * @property {string} raw the block's text, `value.slice(start, end)`
 * @property {BlockConfig|null} config null when the settings are damaged
 * @property {boolean} closed false when the closing marker is missing; such a
 *   block is never rewritten, since where it ends is unknown
 */

/**
 * Check a block's settings as read from a Document.
 *
 * @param {unknown} input
 * @returns {BlockConfig|null}
 */
export function parseConfig(input) {
    if (!input || typeof input !== 'object' || (input.v !== 1 && input.v !== 2)) return null
    const id = input.id
    if (!Number.isSafeInteger(id) || id <= 0) return null
    if (typeof input.ref !== 'string' || input.ref.length > 200) return null
    if (input.v === 2) {
        if (typeof input.layout !== 'string' || !parseLayout(input.layout).ok) return null
        return { id, ref: input.ref, layout: input.layout, ...layoutFields(input.layout) }
    }
    const names = (list) => (Array.isArray(list) && list.length <= MAX_FIELDS && list.every((name) => typeof name === 'string' && FIELD_NAME.test(name))
        ? [...list]
        : null)
    const fields = names(input.fields)
    const columns = names(input.columns)
    if (!fields || !columns) return null
    return { id, ref: input.ref, fields, columns }
}

/**
 * A block's settings from its marker JSON, taking a v2 layout from the layout
 * comment under the marker when the JSON does not carry it.
 *
 * @param {string} json
 * @param {string} raw the block's text, marker first
 * @returns {BlockConfig|null}
 */
function blockConfig(json, raw) {
    let input
    try {
        input = JSON.parse(json)
    } catch {
        return null
    }
    if (input?.v === 2 && input.layout === undefined) {
        const section = LAYOUT_SECTION.exec(raw)
        if (!section) return null
        input = { ...input, layout: section[1] }
    }
    return parseConfig(input)
}

/**
 * The sales order blocks in a Document, in order.
 *
 * @param {string} text
 * @returns {Block[]}
 */
export function findBlocks(text) {
    const value = String(text ?? '')
    const blocks = []
    let offset = 0
    let open = null
    for (const line of value.split('\n')) {
        const lineEnd = offset + line.length
        if (open) {
            if (END_LINE.test(line)) {
                blocks.push(finish(open, lineEnd, true))
                open = null
            } else if (START_LINE.test(line)) {
                // An unclosed block ends where the next one starts.
                blocks.push(finish(open, open.end, false))
                open = null
            }
        }
        if (!open) {
            const match = START_LINE.exec(line)
            if (match) open = { start: offset, end: lineEnd, json: match[1] }
        }
        offset = lineEnd + 1
    }
    if (open) blocks.push(finish(open, open.end, false))
    return blocks

    function finish({ start, json }, end, closed) {
        const raw = value.slice(start, end)
        return { start, end, raw, config: blockConfig(json, raw), closed }
    }
}

/**
 * Text from Odoo made safe for a Markdown table cell: no HTML, no inline
 * Markdown (emphasis, code, links, images), no cell break, no `{{ variable }}`;
 * line breaks become `<br>`. Only what could take effect is escaped, so the
 * text stays readable in the editor:
 * - `<` always (`&lt;`), so no HTML can start; `>` alone does nothing inline;
 * - `&` only before something that would read as an entity;
 * - `{` only as the first of `{{`;
 * - `_` only where it could open or close emphasis (`FURN_6667` stays as is);
 * - `]` only where a link, image or link definition would follow (`](`, `][`, `]:`);
 * - `\`, `` ` ``, `*`, `|` and `~` always.
 * Block syntax (`#`, `-`, `>`) means nothing inside a cell; layouts guard the
 * start of a line themselves.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function escapeCell(text) {
    const source = String(text ?? '')
    let out = ''
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]
        const next = source[index + 1] ?? ''
        switch (char) {
            case '<':
                out += '&lt;'
                break
            case '&':
                out += ENTITY_LIKE.test(source.slice(index, index + 40)) ? '&amp;' : '&'
                break
            case '{':
                out += next === '{' ? '&#123;' : '{'
                break
            case '_':
                out += ALPHANUMERIC.test(source[index - 1] ?? '') && ALPHANUMERIC.test(next) ? '_' : '\\_'
                break
            case ']':
                out += next === '(' || next === '[' || next === ':' ? '\\]' : ']'
                break
            case '\\':
            case '`':
            case '*':
            case '|':
            case '~':
                out += `\\${char}`
                break
            default:
                out += char
        }
    }
    return out
        .split(/\r\n?|\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('<br>')
}

/**
 * A typed cell from the API (spec §5) as text in the given locale.
 *
 * @param {object|null} cell
 * @param {{ locale?: string, timeZone?: string }} [options]
 * @returns {string}
 */
export function formatCell(cell, { locale, timeZone } = {}) {
    if (!cell) return ''
    switch (cell.type) {
        case 'text':
            return String(cell.value ?? '')
        case 'number':
            return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(cell.value)
        case 'monetary': {
            const decimals = cell.currency?.decimals ?? 2
            const amount = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(cell.value)
            const symbol = cell.currency?.symbol
            if (!symbol) return amount
            return cell.currency.position === 'after' ? `${amount}\u00a0${symbol}` : `${symbol}\u00a0${amount}`
        }
        case 'date':
            return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${cell.value}T00:00:00Z`))
        case 'datetime':
            return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(cell.value))
        case 'boolean':
            return cell.value ? 'Yes' : 'No'
        default:
            return ''
    }
}

/**
 * The settings comment, which must stay one line and can never close early.
 *
 * @param {BlockConfig} config
 * @returns {string}
 */
function startMarker({ id, ref, fields, columns, layout }) {
    const settings = layout === undefined ? { v: 1, id, ref, fields, columns } : { v: 2, id, ref }
    const json = JSON.stringify(settings).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    return `<!-- odoo:sale.order ${json} -->`
}

const row = (cells) => `| ${cells.join(' | ')} |`

/**
 * The whole block for a snapshot from `GET /addons/odoo/sale-orders/:id`.
 *
 * @param {object} snapshot `{ order, fields, columns, lines, truncated }`
 * @param {{ locale?: string, timeZone?: string, now?: Date, layout?: string }} [options]
 *   with `layout`, the block is drawn from that Markdown layout and carries it
 * @returns {string} Markdown, without a trailing newline
 * @throws {Error} when `layout` does not parse
 */
export function buildBlockMarkdown(snapshot, { locale, timeZone, now = new Date(), layout } = {}) {
    const format = (cell) => escapeCell(formatCell(cell, { locale, timeZone }))
    const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(now)
    if (layout !== undefined) {
        const body = renderLayout(layout, snapshot, { formatValue: format, escapeText: escapeCell, updated })
        return [
            startMarker({ id: snapshot.order.id, ref: snapshot.order.name, layout }),
            '<!-- odoo:layout',
            String(layout).replace(/\r\n?/g, '\n').replace(/\n+$/, ''),
            '-->',
            body,
            '<!-- /odoo:sale.order -->',
        ].join('\n')
    }
    const config = {
        id: snapshot.order.id,
        ref: snapshot.order.name,
        fields: snapshot.fields.map((field) => field.name),
        columns: snapshot.columns.map((column) => column.name),
    }
    const out = [startMarker(config)]

    out.push(row(['Sales order', `**${escapeCell(snapshot.order.name)}**`]), row(['---', '---']))
    for (const field of snapshot.fields) out.push(row([escapeCell(field.label), format(field.cell)]))

    const lines = snapshot.lines || []
    if (snapshot.columns.length && lines.length) {
        out.push('')
        out.push(row(snapshot.columns.map((column) => escapeCell(column.label))))
        out.push(row(snapshot.columns.map((column) => (NUMERIC_TYPES.has(column.type) ? '--:' : '---'))))
        const blanks = snapshot.columns.slice(1).map(() => '')
        for (const line of lines) {
            if (line.kind === 'line') {
                out.push(row(line.cells.map(format)))
                continue
            }
            const text = escapeCell(line.text)
            const styled = !text ? '' : line.kind === 'section' ? `**${text}**` : `*${text}*`
            out.push(row([styled, ...blanks]))
        }
    }

    const link = /^https?:\/\/[^\s()<>]+$/.test(snapshot.order.url || '') ? ` [Open in Odoo](${snapshot.order.url})` : ''
    const cut = snapshot.truncated ? ' Only the first 500 lines are shown.' : ''
    out.push('', `*From Odoo, updated ${updated}.*${cut}${link}`, '<!-- /odoo:sale.order -->')
    return out.join('\n')
}

/**
 * Insert a block after the line the cursor is on, as its own paragraph.
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {string} markdown from `buildBlockMarkdown`
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }}
 */
export function insertBlock(state, markdown) {
    const value = state.value
    const cursor = Math.min(Math.max(state.selectionEnd ?? value.length, 0), value.length)
    const lineEnd = value.indexOf('\n', cursor)
    const at = lineEnd === -1 ? value.length : lineEnd
    const before = value.slice(0, at)
    const after = value.slice(at)
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    const inserted = `${lead}${markdown}${after === '' ? '\n' : trail}`
    const caret = before.length + lead.length + markdown.length
    return { value: `${before}${inserted}${after}`, selectionStart: caret, selectionEnd: caret }
}

/**
 * Replace a block found earlier with new Markdown, if the Document still holds
 * it unchanged. Returns null when it does not (edited or removed meanwhile).
 *
 * @param {{ value: string, selectionStart: number, selectionEnd: number }} state
 * @param {Block} block as found before the refresh started
 * @param {string} markdown
 * @returns {{ value: string, selectionStart: number, selectionEnd: number }|null}
 */
export function replaceBlock(state, block, markdown) {
    if (!block.closed) return null
    const current = findBlocks(state.value).filter((candidate) => candidate.closed)
    const target = current.find((candidate) => candidate.start === block.start && candidate.raw === block.raw)
        || current.find((candidate) => candidate.raw === block.raw)
    if (!target) return null
    const delta = markdown.length - (target.end - target.start)
    const move = (position) => {
        if (position <= target.start) return position
        if (position >= target.end) return position + delta
        return target.start + markdown.length
    }
    return {
        value: `${state.value.slice(0, target.start)}${markdown}${state.value.slice(target.end)}`,
        selectionStart: move(state.selectionStart),
        selectionEnd: move(state.selectionEnd),
    }
}
