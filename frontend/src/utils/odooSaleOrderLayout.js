/**
 * Layouts for sales order blocks (docs/specs/active/odoo-sales-order-blocks.md
 * §4a): Markdown with placeholders for the order's values and a section
 * repeated for each order line. Pure functions: no stores, no network.
 *
 *   {{order.<field>}}            a value of the order
 *   {{#lines}} … {{/lines}}      repeated for each line, with inside it
 *     {{#product}} … {{/product}}  only for product lines
 *     {{#section}} … {{/section}}  only for section lines
 *     {{#note}} … {{/note}}        only for note lines
 *     {{line.<field>}}             a value of the line (`line.name` is a section's or note's text)
 *   {{odoo.updated}}             when the block was last read from Odoo
 *   {{odoo.url}}                 the order in Odoo
 *
 * Inside {{#lines}} without any of the three parts, the whole body is the
 * product part and section and note lines are left out. Any other `{{ … }}` is
 * left as written, so a Document's own variables still work in a layout. A tag
 * alone on its line takes the line with it, so tables stay unbroken.
 */

export const MAX_LAYOUT_LENGTH = 8000

const TAG = /\{\{\s*([#/]?)(lines|product|section|note|order\.[a-z_][a-z0-9_]*|line\.[a-z_][a-z0-9_]*|odoo\.(?:updated|url))\s*\}\}/g
const STANDALONE = /^[ \t]*(\{\{\s*[#/](?:lines|product|section|note)\s*\}\})[ \t]*(?:\r?\n|$)/gm
const KINDS = new Set(['product', 'section', 'note'])

/** The starter layouts every person has. */
export const BUILT_IN_LAYOUTS = Object.freeze([
    {
        id: 'builtin:quotation',
        name: 'Quotation',
        body: [
            '## Quotation {{order.name}}',
            '',
            '**{{order.partner_id}}**\\',
            'Quotation date: {{order.date_order}}\\',
            'Valid until: {{order.validity_date}}\\',
            'Salesperson: {{order.user_id}}',
            '',
            '| Description | Quantity | Unit price | Taxes | Amount |',
            '| --- | --: | --: | --- | --: |',
            '{{#lines}}',
            '{{#product}}',
            '| {{line.name}} | {{line.product_uom_qty}} {{line.product_uom_id}} | {{line.price_unit}} | {{line.tax_ids}} | {{line.price_subtotal}} |',
            '{{/product}}',
            '{{#section}}',
            '| **{{line.name}}** | | | | |',
            '{{/section}}',
            '{{#note}}',
            '| *{{line.name}}* | | | | |',
            '{{/note}}',
            '{{/lines}}',
            '',
            '| Summary | Amount |',
            '| --- | --: |',
            '| Untaxed amount | {{order.amount_untaxed}} |',
            '| Taxes | {{order.amount_tax}} |',
            '| **Total** | **{{order.amount_total}}** |',
            '',
            '*From Odoo, updated {{odoo.updated}}.*',
        ].join('\n'),
    },
    {
        id: 'builtin:lines',
        name: 'Lines only',
        body: [
            '| Description | Quantity | Unit price | Amount |',
            '| --- | --: | --: | --: |',
            '{{#lines}}',
            '| {{line.name}} | {{line.product_uom_qty}} | {{line.price_unit}} | {{line.price_subtotal}} |',
            '{{/lines}}',
        ].join('\n'),
    },
])

/**
 * Parse a layout into nodes, or say what is wrong with it.
 *
 * @param {string} body
 * @returns {{ ok: true, nodes: object[] } | { ok: false, error: string }}
 */
export function parseLayout(body) {
    const text = String(body ?? '').replace(/\r\n?/g, '\n')
    if (!text.trim()) return { ok: false, error: 'The layout is empty.' }
    if (text.length > MAX_LAYOUT_LENGTH) return { ok: false, error: `A layout holds at most ${MAX_LAYOUT_LENGTH} characters.` }
    if (text.includes('<!--') || text.includes('-->')) return { ok: false, error: 'A layout cannot contain HTML comments.' }

    const source = text.replace(STANDALONE, '$1')
    const root = { children: [] }
    const stack = [{ name: null, node: root }]
    const inside = (name) => stack.some((entry) => entry.name === name)
    let last = 0
    for (const match of source.matchAll(TAG)) {
        const [whole, sign, name] = match
        const current = stack[stack.length - 1].node
        if (match.index > last) current.children.push({ type: 'text', text: source.slice(last, match.index) })
        last = match.index + whole.length

        if (sign === '#') {
            if (name === 'lines' && inside('lines')) return { ok: false, error: '{{#lines}} cannot be inside another {{#lines}}.' }
            if (KINDS.has(name)) {
                if (!inside('lines')) return { ok: false, error: `{{#${name}}} only works inside {{#lines}}.` }
                if (stack.some((entry) => KINDS.has(entry.name))) return { ok: false, error: `{{#${name}}} cannot be inside another line part.` }
            }
            const node = { type: 'section', name, children: [] }
            current.children.push(node)
            stack.push({ name, node })
        } else if (sign === '/') {
            if (stack[stack.length - 1].name !== name) return { ok: false, error: `{{/${name}}} does not close an open {{#${name}}}.` }
            stack.pop()
        } else if (name.startsWith('line.')) {
            if (!inside('lines')) return { ok: false, error: `{{${name}}} only works inside {{#lines}}.` }
            current.children.push({ type: 'value', scope: 'line', field: name.slice(5) })
        } else if (name.startsWith('order.')) {
            current.children.push({ type: 'value', scope: 'order', field: name.slice(6) })
        } else {
            current.children.push({ type: 'value', scope: 'odoo', field: name.slice(5) })
        }
    }
    if (stack.length > 1) return { ok: false, error: `{{#${stack[stack.length - 1].name}}} is never closed with {{/${stack[stack.length - 1].name}}}.` }
    if (last < source.length) root.children.push({ type: 'text', text: source.slice(last) })
    return { ok: true, nodes: root.children }
}

/**
 * The order and line fields a layout uses, in order of first use: what to
 * ask Odoo for.
 *
 * @param {string} body
 * @returns {{ fields: string[], columns: string[] }}
 */
export function layoutFields(body) {
    const fields = []
    const columns = []
    for (const [, sign, name] of String(body ?? '').matchAll(TAG)) {
        if (sign) continue
        const [scope, field] = name.split('.')
        const list = scope === 'order' ? fields : scope === 'line' ? columns : null
        if (list && !list.includes(field)) list.push(field)
    }
    return { fields, columns }
}

/**
 * Text from Odoo made safe anywhere in a layout: the table-cell escaping, plus
 * a leading character that would start a heading, list, quote or rule at the
 * start of a line.
 */
function guardLineStart(text) {
    return text.replace(/^([#+=>-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2')
}

/**
 * Render a layout with a snapshot from `GET /addons/odoo/sale-orders/:id`.
 *
 * @param {string} body
 * @param {object} snapshot `{ order, fields, columns, lines }`
 * @param {{ formatValue: (cell: object|null) => string, escapeText: (text: string) => string, updated: string }} options
 *   `formatValue` formats and escapes a cell; `escapeText` escapes plain text
 * @returns {string} Markdown
 * @throws {Error} when the layout does not parse
 */
export function renderLayout(body, snapshot, { formatValue, escapeText, updated }) {
    const parsed = parseLayout(body)
    if (!parsed.ok) throw new Error(parsed.error)
    const orderCells = new Map(snapshot.fields.map((field) => [field.name, field.cell]))
    const columnIndex = new Map(snapshot.columns.map((column, index) => [column.name, index]))
    const url = /^https?:\/\/[^\s()<>]+$/.test(snapshot.order.url || '') ? snapshot.order.url : ''

    function value(node, line) {
        if (node.scope === 'odoo') return node.field === 'url' ? url : escapeText(updated)
        if (node.scope === 'order') {
            if (node.field === 'name' && !orderCells.has('name')) return guardLineStart(escapeText(snapshot.order.name))
            return guardLineStart(formatValue(orderCells.get(node.field) ?? null))
        }
        if (!line) return ''
        if (line.kind !== 'line') return node.field === 'name' ? guardLineStart(escapeText(line.text)) : ''
        const index = columnIndex.get(node.field)
        return index === undefined ? '' : guardLineStart(formatValue(line.cells[index] ?? null))
    }

    function render(nodes, line) {
        let out = ''
        for (const node of nodes) {
            if (node.type === 'text') out += node.text
            else if (node.type === 'value') out += value(node, line)
            else if (node.name === 'lines') {
                const hasParts = node.children.some((child) => child.type === 'section' && KINDS.has(child.name))
                for (const each of snapshot.lines || []) {
                    if (!hasParts && each.kind !== 'line') continue
                    out += render(node.children, each)
                }
            } else if (line) {
                const kind = line.kind === 'line' ? 'product' : line.kind
                if (node.name === kind) out += render(node.children, line)
            }
        }
        return out
    }

    return render(parsed.nodes, null).replace(/\n+$/, '')
}

/**
 * The table layout of a block's chosen values and columns, as editable Markdown.
 *
 * @param {string[]} fields order values
 * @param {string[]} columns line columns
 * @param {(scope: 'order'|'line', name: string) => { label: string, type?: string }} describe
 * @returns {string}
 */
export function tableLayout(fields, columns, describe) {
    const numeric = new Set(['integer', 'float', 'monetary'])
    const label = (scope, name) => String(describe(scope, name).label).replace(/\|/g, '\\|')
    const out = ['| Sales order | **{{order.name}}** |', '| --- | --- |']
    for (const name of fields) out.push(`| ${label('order', name)} | {{order.${name}}} |`)
    if (columns.length) {
        const blanks = columns.slice(1).map(() => ' ').join('|')
        out.push('', `| ${columns.map((name) => label('line', name)).join(' | ')} |`)
        out.push(`| ${columns.map((name) => (numeric.has(describe('line', name).type) ? '--:' : '---')).join(' | ')} |`)
        out.push('{{#lines}}', '{{#product}}', `| ${columns.map((name) => `{{line.${name}}}`).join(' | ')} |`, '{{/product}}')
        out.push('{{#section}}', `| **{{line.name}}** |${blanks}|`, '{{/section}}', '{{#note}}', `| *{{line.name}}* |${blanks}|`, '{{/note}}', '{{/lines}}')
    }
    out.push('', '*From Odoo, updated {{odoo.updated}}.* [Open in Odoo]({{odoo.url}})')
    return out.join('\n')
}
