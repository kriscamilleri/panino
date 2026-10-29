/**
 * Sales order blocks (docs/specs/active/odoo-sales-order-blocks.md): read a
 * sales order and its lines from Odoo so the client can write them into a
 * Document as tables. Read only; nothing here writes to Odoo.
 *
 * The client chooses which order values and which line columns to show. Those
 * names are checked against a catalog built from `fields_get`, so only plain
 * value fields are ever read (never binary or HTML), and each value goes back
 * as a typed cell the client formats in the person's locale.
 */

import crypto from 'node:crypto';
import { getUserDb } from './db.js';
import { OdooError } from './odooClient.js';
import { recordUrlPath, searchRecords } from './odooChatter.js';
import { rememberConnectionError, senderConnection } from './odooConnection.js';

const ORDER = 'sale.order';
const LINE = 'sale.order.line';
const CURRENCY = 'res.currency';

const CATALOG_TYPES = new Set([
    'char', 'text', 'selection', 'many2one', 'many2many', 'integer', 'float', 'monetary', 'boolean', 'date', 'datetime',
]);
const HIDDEN_FIELD = /^(id|display_name|__.*|message_.*|activity_.*|access_.*|website_message_.*|my_activity_.*)$/;

export const DEFAULT_ORDER_FIELDS = Object.freeze([
    'partner_id', 'date_order', 'validity_date', 'user_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total',
]);
export const DEFAULT_LINE_COLUMNS = Object.freeze([
    'name', 'product_uom_qty', 'price_unit', 'discount', 'tax_ids', 'price_subtotal',
]);

export const MAX_CHOSEN_FIELDS = 30;
export const MAX_LINES = 500;
const MAX_RELATED_NAMES = 200;
const MAX_TEXT_LENGTH = 2000;

const SALES_MESSAGES = Object.freeze({
    access_denied: "Your Odoo user can't read this sales order.",
    missing_app: "Odoo Sales isn't installed in this Odoo, or your Odoo user can't use it.",
    record_gone: 'That sales order no longer exists in Odoo, or your Odoo user can no longer see it.',
});

export const MAX_LAYOUTS = 50;
export const MAX_LAYOUT_NAME = 80;
export const MAX_LAYOUT_BODY = 8000;

const catalogCache = new Map();
const CATALOG_TTL_MS = 60 * 60 * 1000;

/**
 * The fields of one model that may be shown, from its `fields_get`.
 *
 * @param {object} fieldsGet `{ name: { string, type, selection, relation } }`
 * @returns {Map<string, { name: string, label: string, type: string, selection?: Map<string,string>, relation?: string }>}
 *   sorted by label
 */
export function catalogFromFieldsGet(fieldsGet) {
    const entries = [];
    for (const [name, meta] of Object.entries(fieldsGet || {})) {
        if (!meta || !CATALOG_TYPES.has(meta.type) || HIDDEN_FIELD.test(name)) continue;
        const field = { name, label: String(meta.string || name).slice(0, 100), type: meta.type };
        if (meta.type === 'selection' && Array.isArray(meta.selection)) {
            field.selection = new Map(meta.selection.filter(Array.isArray).map(([key, label]) => [String(key), String(label)]));
        }
        if (meta.type === 'many2many' && typeof meta.relation === 'string') field.relation = meta.relation;
        entries.push(field);
    }
    entries.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    return new Map(entries.map((field) => [field.name, field]));
}

/**
 * The order and line catalogs of an Odoo database, cached for an hour.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {string} target from `odooTarget`
 * @returns {Promise<{ order: Map<string, object>, line: Map<string, object> }>}
 */
export async function saleOrderCatalog(client, target) {
    const cached = catalogCache.get(target);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog;
    const attributes = ['string', 'type', 'selection', 'relation'];
    const [orderFields, lineFields] = await Promise.all([
        client.call(ORDER, 'fields_get', { attributes }),
        client.call(LINE, 'fields_get', { attributes }),
    ]);
    const catalog = { order: catalogFromFieldsGet(orderFields), line: catalogFromFieldsGet(lineFields) };
    catalogCache.set(target, { catalog, at: Date.now() });
    return catalog;
}

/** Test seam: forget cached catalogs. */
export function resetSaleOrderCatalogCache() {
    catalogCache.clear();
}

/**
 * Keep the requested names the catalog has, in the order asked, once each.
 * `undefined` (nothing asked) gives the defaults the catalog has.
 *
 * @param {string[]|undefined} requested
 * @param {Map<string, object>} catalog
 * @param {readonly string[]} defaults
 * @returns {string[]}
 */
export function chooseFields(requested, catalog, defaults) {
    const source = requested === undefined ? defaults : requested;
    const chosen = [];
    for (const name of source) {
        if (catalog.has(name) && !chosen.includes(name)) chosen.push(name);
        if (chosen.length >= MAX_CHOSEN_FIELDS) break;
    }
    return chosen;
}

/** A comma-separated query parameter as a list; `undefined` when absent. */
export function parseFieldList(value) {
    if (typeof value !== 'string') return undefined;
    return value.split(',').map((name) => name.trim()).filter(Boolean).slice(0, MAX_CHOSEN_FIELDS * 2);
}

const isEmpty = (value) => value === false || value === null || value === undefined;

/**
 * One value as a typed cell for the client to format, or null when Odoo has none.
 *
 * @param {{ type: string, selection?: Map<string,string>, relation?: string }} field
 * @param {unknown} value as `read` returns it
 * @param {{ names?: Map<string, Map<number,string>>, currency?: object|null }} [context]
 * @returns {object|null}
 */
export function cellFor(field, value, { names, currency = null } = {}) {
    if (field.type === 'boolean') return { type: 'boolean', value: value === true };
    if (isEmpty(value)) return null;
    const text = (string) => ({ type: 'text', value: String(string).slice(0, MAX_TEXT_LENGTH) });
    switch (field.type) {
        case 'char':
        case 'text':
            return text(value);
        case 'selection':
            return text(field.selection?.get(String(value)) ?? value);
        case 'many2one':
            return Array.isArray(value) ? text(value[1] ?? '') : null;
        case 'many2many': {
            if (!Array.isArray(value) || !value.length) return null;
            const known = names?.get(field.relation);
            const joined = value.map((id) => known?.get(id)).filter(Boolean).join(', ');
            return joined ? text(joined) : null;
        }
        case 'integer':
        case 'float':
            return typeof value === 'number' ? { type: 'number', value } : null;
        case 'monetary':
            return typeof value === 'number' ? { type: 'monetary', value, currency } : null;
        case 'date':
            return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? { type: 'date', value: String(value) } : null;
        case 'datetime': {
            const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(value));
            return match ? { type: 'datetime', value: `${match[1]}T${match[2]}Z` } : null;
        }
        default:
            return null;
    }
}

const recordId = (value) => (Array.isArray(value) && Number.isInteger(value[0]) ? value[0] : null);

/** Display names of the many2many ids the rows use, per related model. */
async function relatedNames(client, rows, fields) {
    const idsByRelation = new Map();
    for (const field of fields) {
        if (field.type !== 'many2many' || !field.relation) continue;
        const ids = idsByRelation.get(field.relation) || new Set();
        for (const row of rows) {
            for (const id of Array.isArray(row[field.name]) ? row[field.name] : []) {
                if (ids.size < MAX_RELATED_NAMES && Number.isInteger(id)) ids.add(id);
            }
        }
        idsByRelation.set(field.relation, ids);
    }
    const names = new Map();
    for (const [relation, ids] of idsByRelation) {
        if (!ids.size) continue;
        try {
            const read = await client.call(relation, 'read', { ids: [...ids], fields: ['display_name'] });
            names.set(relation, new Map((Array.isArray(read) ? read : []).map((row) => [row.id, String(row.display_name || '')])));
        } catch (error) {
            // A related model this Odoo user may not read leaves those cells empty.
            if (!(error instanceof OdooError) || !['access_denied', 'missing_app'].includes(error.code)) throw error;
        }
    }
    return names;
}

/** Symbol, position and decimals of the currencies used, by id. */
async function currencies(client, ids) {
    const wanted = [...new Set(ids.filter(Number.isInteger))];
    if (!wanted.length) return new Map();
    const rows = await client.call(CURRENCY, 'read', { ids: wanted, fields: ['name', 'symbol', 'position', 'decimal_places'] });
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, {
        code: String(row.name || '').slice(0, 10),
        symbol: String(row.symbol || row.name || '').slice(0, 10),
        position: row.position === 'after' ? 'after' : 'before',
        decimals: Number.isInteger(row.decimal_places) && row.decimal_places >= 0 && row.decimal_places <= 6 ? row.decimal_places : 2,
    }]));
}

/** `display_type` on Odoo 19 and 20: false, `line_section`, `line_subsection` or `line_note`. */
function lineKind(displayType) {
    if (displayType === 'line_note') return 'note';
    if (displayType === 'line_section' || displayType === 'line_subsection') return 'section';
    return 'line';
}

/**
 * Read a sales order and its lines with the chosen values and columns.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {{ order: Map<string, object>, line: Map<string, object> }} catalog
 * @param {number} orderId
 * @param {{ fields: string[], columns: string[], baseUrl: string }} choice already checked with `chooseFields`
 * @returns {Promise<object>} the snapshot (spec §5)
 * @throws {OdooError} `record_gone` when the order cannot be read
 */
export async function readSaleOrder(client, catalog, orderId, { fields, columns, baseUrl }) {
    const orderFields = fields.map((name) => catalog.order.get(name));
    const lineColumns = columns.map((name) => catalog.line.get(name));

    const [order] = await client.call(ORDER, 'read', {
        ids: [orderId],
        fields: [...new Set(['name', 'currency_id', 'order_line', ...fields])],
    }) || [];
    if (!order) throw new OdooError('record_gone');

    const lineIds = (Array.isArray(order.order_line) ? order.order_line : []).filter(Number.isInteger);
    const lines = lineColumns.length && lineIds.length
        ? await client.call(LINE, 'read', {
            ids: lineIds.slice(0, MAX_LINES),
            fields: [...new Set(['display_type', 'name', 'currency_id', ...columns])],
        }, { maxBytes: 4 * 1024 * 1024 })
        : [];
    const lineRows = Array.isArray(lines) ? lines : [];

    const [orderNames, lineNames, currencyById] = await Promise.all([
        relatedNames(client, [order], orderFields),
        relatedNames(client, lineRows, lineColumns),
        currencies(client, [recordId(order.currency_id), ...lineRows.map((row) => recordId(row.currency_id))]),
    ]);
    const orderCurrency = currencyById.get(recordId(order.currency_id)) || null;

    return {
        order: {
            id: order.id,
            name: String(order.name || '').slice(0, 200),
            url: `${baseUrl}${recordUrlPath(ORDER, order.id)}`,
        },
        fields: orderFields.map((field) => ({
            name: field.name,
            label: field.label,
            cell: cellFor(field, order[field.name], { names: orderNames, currency: orderCurrency }),
        })),
        columns: lineColumns.map(({ name, label, type }) => ({ name, label, type })),
        lines: lineRows.map((row) => {
            const kind = lineKind(row.display_type);
            if (kind !== 'line') return { kind, text: String(row.name || '').slice(0, MAX_TEXT_LENGTH) };
            const currency = currencyById.get(recordId(row.currency_id)) || orderCurrency;
            return { kind, cells: lineColumns.map((field) => cellFor(field, row[field.name], { names: lineNames, currency })) };
        }),
        truncated: lineIds.length > MAX_LINES,
    };
}

/**
 * Check a saved layout as sent by the client. The body is the person's own
 * Markdown; it only has to fit, and must not hold an HTML comment, which could
 * end the block's marker early.
 *
 * @param {unknown} body request body `{ name, body }`
 * @returns {{ ok: true, name: string, body: string } | { ok: false, message: string }}
 */
export function parseLayoutInput(body) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const text = typeof body?.body === 'string' ? body.body.replace(/\r\n?/g, '\n') : '';
    if (!name || name.length > MAX_LAYOUT_NAME) return { ok: false, message: `Give the layout a name of at most ${MAX_LAYOUT_NAME} characters.` };
    if (!text.trim() || text.length > MAX_LAYOUT_BODY) return { ok: false, message: `A layout holds between 1 and ${MAX_LAYOUT_BODY} characters.` };
    if (text.includes('<!--') || text.includes('-->')) return { ok: false, message: 'A layout cannot contain HTML comments.' };
    return { ok: true, name, body: text };
}

const layoutPayload = (row) => ({ id: row.id, name: row.name, body: row.body, updatedAt: row.updated_at });

const publicCatalog = (catalog) => [...catalog.values()].map(({ name, label, type }) => ({ name, label, type }));

/**
 * Add the sales order block routes to the Odoo router, after its add-on gate.
 *
 * @param {import('express').Router} router `odooRoutes`
 * @param {{ messages: object, logFailure: (event: string, userId: string, error: unknown) => void }} helpers
 *   the router's fixed error messages and its log line
 */
export function registerSaleOrderBlockRoutes(router, { messages, logFailure }) {
    const salesMessages = { ...messages, ...SALES_MESSAGES };

    function fail(res, error) {
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        return res.status(400).json({ error: code, message: salesMessages[code] || messages.odoo_error });
    }

    /** The caller's connection with Sales, or an answer already sent. */
    function salesConnection(req, res) {
        let sender;
        try {
            sender = senderConnection(req.user.user_id);
        } catch (error) {
            fail(res, error);
            return null;
        }
        if (!sender) {
            res.status(404).json({ error: 'not_connected', message: 'Connect Odoo in Settings first.' });
            return null;
        }
        if (!sender.apps.includes('sales')) {
            fail(res, new OdooError('missing_app'));
            return null;
        }
        return sender;
    }

    async function answer(req, res, event, work) {
        const sender = salesConnection(req, res);
        if (!sender) return;
        try {
            res.json(await work(sender));
        } catch (error) {
            logFailure(event, req.user.user_id, error);
            rememberConnectionError(sender.userDb, error);
            if (!(error instanceof OdooError)) console.error(`[odoo] Unexpected error (${event}):`, error);
            fail(res, error);
        }
    }

    // Saved layouts are text the person keeps for reuse; they need no Odoo connection.
    router.get('/addons/odoo/sale-order-layouts', (req, res) => {
        try {
            const rows = getUserDb(req.user.user_id)
                .prepare("SELECT * FROM odoo_block_layouts WHERE model = 'sale.order' ORDER BY name COLLATE NOCASE, created_at")
                .all();
            res.json({ layouts: rows.map(layoutPayload) });
        } catch (error) {
            console.error('[odoo] Failed to list layouts:', error);
            res.status(500).json({ error: 'Failed to load layouts' });
        }
    });

    router.post('/addons/odoo/sale-order-layouts', (req, res) => {
        const input = parseLayoutInput(req.body);
        if (!input.ok) return res.status(400).json({ error: 'invalid', message: input.message });
        try {
            const db = getUserDb(req.user.user_id);
            const { count } = db.prepare('SELECT COUNT(*) AS count FROM odoo_block_layouts').get();
            if (count >= MAX_LAYOUTS) {
                return res.status(400).json({ error: 'invalid', message: `You can keep at most ${MAX_LAYOUTS} layouts. Delete one first.` });
            }
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            db.prepare(`INSERT INTO odoo_block_layouts (id, model, name, body, created_at, updated_at)
                VALUES (?, 'sale.order', ?, ?, ?, ?)`).run(id, input.name, input.body, now, now);
            return res.status(201).json(layoutPayload(db.prepare('SELECT * FROM odoo_block_layouts WHERE id = ?').get(id)));
        } catch (error) {
            console.error('[odoo] Failed to save a layout:', error);
            return res.status(500).json({ error: 'Failed to save the layout' });
        }
    });

    router.put('/addons/odoo/sale-order-layouts/:layoutId', (req, res) => {
        const input = parseLayoutInput(req.body);
        if (!input.ok) return res.status(400).json({ error: 'invalid', message: input.message });
        try {
            const db = getUserDb(req.user.user_id);
            const { changes } = db.prepare('UPDATE odoo_block_layouts SET name = ?, body = ?, updated_at = ? WHERE id = ?')
                .run(input.name, input.body, new Date().toISOString(), req.params.layoutId);
            if (!changes) return res.status(404).json({ error: 'not_found', message: 'That layout no longer exists.' });
            return res.json(layoutPayload(db.prepare('SELECT * FROM odoo_block_layouts WHERE id = ?').get(req.params.layoutId)));
        } catch (error) {
            console.error('[odoo] Failed to update a layout:', error);
            return res.status(500).json({ error: 'Failed to save the layout' });
        }
    });

    router.delete('/addons/odoo/sale-order-layouts/:layoutId', (req, res) => {
        try {
            getUserDb(req.user.user_id).prepare('DELETE FROM odoo_block_layouts WHERE id = ?').run(req.params.layoutId);
            res.status(204).end();
        } catch (error) {
            console.error('[odoo] Failed to delete a layout:', error);
            res.status(500).json({ error: 'Failed to delete the layout' });
        }
    });

    router.get('/addons/odoo/sale-orders', (req, res) => answer(req, res, 'sale_orders_failed', async (sender) => {
        const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        const records = await searchRecords(sender.client, ['sales'], query);
        return { orders: records.map(({ resId, name, partnerName, status }) => ({ id: resId, name, partnerName, status })) };
    }));

    router.get('/addons/odoo/sale-orders/fields', (req, res) => answer(req, res, 'sale_order_fields_failed', async (sender) => {
        const catalog = await saleOrderCatalog(sender.client, sender.target);
        return {
            order: publicCatalog(catalog.order),
            line: publicCatalog(catalog.line),
            defaults: {
                fields: chooseFields(undefined, catalog.order, DEFAULT_ORDER_FIELDS),
                columns: chooseFields(undefined, catalog.line, DEFAULT_LINE_COLUMNS),
            },
        };
    }));

    router.get('/addons/odoo/sale-orders/:id', (req, res) => {
        const orderId = Number(req.params.id);
        if (!/^\d{1,12}$/.test(req.params.id) || !Number.isSafeInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ error: 'invalid', message: 'Choose a sales order.' });
        }
        return answer(req, res, 'sale_order_failed', async (sender) => {
            const catalog = await saleOrderCatalog(sender.client, sender.target);
            return readSaleOrder(sender.client, catalog, orderId, {
                fields: chooseFields(parseFieldList(req.query.fields), catalog.order, DEFAULT_ORDER_FIELDS),
                columns: chooseFields(parseFieldList(req.query.columns), catalog.line, DEFAULT_LINE_COLUMNS),
                baseUrl: sender.row.base_url,
            });
        });
    });
}
