/**
 * A stand-in Odoo for the integration tests, behaving as Odoo 19 and 20 did in
 * Phase 0 (docs/specs/active/odoo-integration.md §4):
 * - v19 takes base64 in `datas`; v20 has no `datas` and takes base64 in `raw`;
 *   the wrong field is accepted and stores nothing (Odoo 20) or the base64 text (Odoo 19);
 * - `read` of a missing id answers `[]`;
 * - `access_url` is built on Odoo's own `web.base.url`;
 * - a staged chatter attachment (`mail.compose.message`, 0) is relinked to the
 *   record by `message_post`, which answers `[message id]`.
 *
 * `state` is mutable so a test can change the version, reject the key, drop
 * content, slow a create down, or make notes fail.
 */

import crypto from 'node:crypto';
import http from 'node:http';

export const API_KEY = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';

const sha1 = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');

/** The demo records the fake starts with (`resetFakeOdoo` restores them). */
function demoRecords() {
    return {
        leads: new Map([
            [1, { id: 1, name: 'Club Office Furnitures', type: 'opportunity', partner_id: [7, 'Azure Interior'], stage_id: [2, 'Qualified'] }],
            [2, { id: 2, name: 'Website quote request', type: 'lead', partner_id: false, stage_id: [1, 'New'] }],
            [3, { id: 3, name: 'Modern Open Space', type: 'opportunity', partner_id: [9, 'Deco Addict'], stage_id: [3, 'Proposition'] }],
        ]),
        orders: new Map([
            [1, { id: 1, name: 'S00001', partner_id: [7, 'Azure Interior'], state: 'sale' }],
            [2, { id: 2, name: 'S00002', partner_id: [9, 'Deco Addict'], state: 'draft' }],
        ]),
    };
}

/** Put `state` back to a fresh Odoo 20 with the demo records. */
export function resetFakeOdoo(state) {
    Object.assign(state, {
        version: 20, keyValid: true, ignoreContent: false, createDelayMs: 0, failNotes: false, failArticleCreates: false,
        failArticleNames: new Set(),
        apps: ['documents', 'knowledge', 'crm', 'sales'],
        nextId: 100, requests: [], messages: [],
        docs: new Map(), attachments: new Map(), attachmentMeta: new Map(),
        articles: new Map([
            [10, { id: 10, name: 'Company handbook', parent_id: false, body: '<p>Welcome</p>', create_date: '2026-01-01 08:00:00' }],
            [11, { id: 11, name: 'Sales playbook', parent_id: [10, 'Company handbook'], body: '<p>Sell</p>', create_date: '2026-01-02 08:00:00' }],
        ]),
        ...demoRecords(),
    });
}

function matches(row, domain) {
    // Only the shapes the client sends: `['field', 'ilike', q]`, `['type', '=', v]` and `'|'`.
    const terms = domain.filter((term) => Array.isArray(term));
    const or = domain.includes('|');
    const checks = terms.map(([field, op, value]) => {
        const actual = Array.isArray(row[field]) ? row[field][1] : row[field];
        if (op === '=') return actual === value;
        if (op === 'ilike') return String(actual || '').toLowerCase().includes(String(value).toLowerCase());
        return false;
    });
    if (!or) return checks.every(Boolean);
    // The first term is the hard one (`type`); the rest are the `|` alternatives.
    const hasType = terms[0]?.[1] === '=';
    const hard = hasType ? checks[0] : true;
    const soft = hasType ? checks.slice(1) : checks;
    return hard && (soft.length === 0 || soft.some(Boolean));
}

/**
 * @returns {Promise<{ server: http.Server, state: object, port: number }>}
 */
export function startFakeOdoo() {
    const state = {};
    resetFakeOdoo(state);
    const fileFieldName = () => (state.version >= 20 ? 'raw' : 'datas');
    const store = (vals) => {
        const field = fileFieldName();
        if (state.ignoreContent || !(field in vals)) return Buffer.alloc(0);
        return Buffer.from(vals[field], 'base64');
    };
    const createDate = (id) => `2026-10-27 09:00:${String(id % 60).padStart(2, '0')}`;
    const fieldsGet = () => (state.version >= 20 ? { raw: { type: 'binary' } } : { datas: { type: 'binary' }, raw: { type: 'binary' } });
    const recordsOf = (model) => (model === 'crm.lead' ? state.leads : state.orders);

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            const params = body ? JSON.parse(body) : {};
            state.requests.push({ url: req.url, params });
            const send = (status, value) => {
                res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(value));
            };
            const odooError = (name, message = 'error') => send(500, { name, message, debug: 'Traceback (most recent call last)…' });
            if (req.url === '/web/version') return send(200, { version_info: [state.version, 0, 0, 'final', 0, 'e'], version: `${state.version}.0+e` });
            if (req.headers.authorization !== `bearer ${API_KEY}` || !state.keyValid) {
                return send(401, { name: 'werkzeug.exceptions.Unauthorized', message: 'Invalid apikey', debug: 'Traceback…' });
            }
            const [, , , model, method] = req.url.split('?')[0].split('/');
            const appOf = { 'documents.document': 'documents', 'knowledge.article': 'knowledge', 'crm.lead': 'crm', 'sale.order': 'sales' };
            if (appOf[model] && !state.apps.includes(appOf[model])) {
                return send(404, { name: 'werkzeug.exceptions.NotFound', message: `the model '${model}' does not exist` });
            }

            switch (`${model}/${method}`) {
                case 'res.users/context_get': return send(200, { uid: 2 });
                case 'res.users/read': return send(200, [{ id: 2, name: 'Mitchell Admin', partner_id: [3, 'Mitchell Admin'] }]);
                case 'documents.document/search_count':
                case 'knowledge.article/search_count':
                case 'crm.lead/search_count':
                case 'sale.order/search_count': return send(200, 0);
                case 'documents.document/fields_get':
                case 'ir.attachment/fields_get': return send(200, fieldsGet());

                case 'documents.document/search_read':
                    return send(200, [{ id: 2, name: 'Inbox', folder_id: false }, { id: 41, name: 'Sales', folder_id: [3, 'Finance'] }]);
                case 'documents.document/create': {
                    if (state.createDelayMs) await new Promise((r) => setTimeout(r, state.createDelayMs));
                    const ids = params.vals_list.map((vals) => {
                        const id = state.nextId++;
                        const attachmentId = state.nextId++;
                        state.attachments.set(attachmentId, store(vals));
                        state.docs.set(id, { id, name: vals.name, folder_id: vals.folder_id, attachment_id: attachmentId, create_date: createDate(id) });
                        return id;
                    });
                    return send(200, ids);
                }
                case 'documents.document/read':
                    return send(200, params.ids.filter((id) => state.docs.has(id)).map((id) => {
                        const doc = state.docs.get(id);
                        return { id, create_date: doc.create_date, attachment_id: [doc.attachment_id, doc.name], access_url: `http://localhost:8069/odoo/documents/tok${id}` };
                    }));
                case 'documents.document/write':
                    for (const id of params.ids) {
                        const doc = state.docs.get(id);
                        if (!doc) return odooError('odoo.exceptions.MissingError', 'gone');
                        if (params.vals.name) doc.name = params.vals.name;
                        state.attachments.set(doc.attachment_id, store(params.vals));
                    }
                    return send(200, true);

                case 'knowledge.article/search_read':
                    return send(200, [...state.articles.values()]
                        .filter((row) => matches(row, (params.domain || []).filter((t) => !(Array.isArray(t) && t[0] === 'is_template'))))
                        .slice(0, params.limit || 80)
                        .map(({ id, name, parent_id }) => ({ id, name, parent_id })));
                case 'knowledge.article/create': {
                    if (state.failArticleCreates) return odooError('odoo.exceptions.UserError', 'Creating is failing today');
                    if (params.vals_list.some((vals) => state.failArticleNames.has(vals.name))) return odooError('odoo.exceptions.ValidationError', 'That name is refused');
                    const ids = params.vals_list.map((vals) => {
                        const id = state.nextId++;
                        const parent = vals.parent_id ? state.articles.get(vals.parent_id) : null;
                        if (vals.parent_id && !parent) return null;
                        state.articles.set(id, {
                            id, name: vals.name, body: vals.body, parent_id: parent ? [parent.id, parent.name] : false,
                            sequence: vals.sequence ?? 0, active: true,
                            internal_permission: vals.internal_permission ?? (parent ? parent.internal_permission : 'write'),
                            members: vals.article_member_ids || [],
                            create_date: createDate(id),
                        });
                        return id;
                    });
                    if (ids.includes(null)) return odooError('odoo.exceptions.MissingError', 'parent gone');
                    return send(200, ids);
                }
                case 'knowledge.article/read':
                    return send(200, params.ids.filter((id) => state.articles.has(id)).map((id) => {
                        const a = state.articles.get(id);
                        return {
                            id, create_date: a.create_date, article_url: `http://localhost:8069/knowledge/article/${id}`,
                            name: a.name, body: a.body, parent_id: a.parent_id, sequence: a.sequence ?? 0, active: a.active !== false,
                        };
                    }));
                case 'knowledge.article/write':
                    for (const id of params.ids) {
                        const a = state.articles.get(id);
                        if (!a) return odooError('odoo.exceptions.MissingError', 'gone');
                        const vals = { ...params.vals };
                        if ('parent_id' in vals) {
                            const parent = vals.parent_id ? state.articles.get(vals.parent_id) : null;
                            if (vals.parent_id && !parent) return odooError('odoo.exceptions.MissingError', 'parent gone');
                            vals.parent_id = parent ? [parent.id, parent.name] : false;
                        }
                        Object.assign(a, vals);
                    }
                    return send(200, true);

                case 'ir.attachment/create': {
                    const ids = params.vals_list.map((vals) => {
                        const id = state.nextId++;
                        state.attachments.set(id, store(vals));
                        state.attachmentMeta.set(id, { name: vals.name, res_model: vals.res_model, res_id: vals.res_id, create_date: createDate(id) });
                        return id;
                    });
                    return send(200, ids);
                }
                case 'ir.attachment/write':
                    for (const id of params.ids) {
                        if (!state.attachments.has(id)) return odooError('odoo.exceptions.MissingError', 'gone');
                        const meta = state.attachmentMeta.get(id);
                        if (meta && params.vals.name) meta.name = params.vals.name;
                        if (fileFieldName() in params.vals || 'datas' in params.vals || 'raw' in params.vals) {
                            state.attachments.set(id, store(params.vals));
                        }
                    }
                    return send(200, true);
                case 'ir.attachment/search_read': {
                    const want = Object.fromEntries((params.domain || []).filter(Array.isArray).map(([f, , v]) => [f, v]));
                    const rows = [...state.attachmentMeta.entries()]
                        .filter(([id, meta]) => meta.res_model === want.res_model && meta.res_id === want.res_id && sha1(state.attachments.get(id)) === want.checksum)
                        .map(([id]) => ({ id }));
                    return send(200, rows.slice(0, params.limit || 80));
                }
                case 'ir.attachment/read':
                    return send(200, params.ids.filter((id) => state.attachments.has(id)).map((id) => ({
                        id,
                        checksum: sha1(state.attachments.get(id)),
                        ...(state.attachmentMeta.get(id) || {}),
                    })));

                case 'crm.lead/read':
                case 'sale.order/read':
                    return send(200, params.ids.filter((id) => recordsOf(model).has(id)).map((id) => recordsOf(model).get(id)));
                case 'crm.lead/search_read':
                case 'sale.order/search_read':
                    return send(200, [...recordsOf(model).values()].filter((row) => matches(row, params.domain || [])).slice(0, params.limit || 80));
                case 'crm.lead/message_post':
                case 'sale.order/message_post': {
                    const [resId] = params.ids;
                    if (!recordsOf(model).has(resId)) return odooError('odoo.exceptions.MissingError', 'Record does not exist or has been deleted.');
                    if (state.failNotes) return odooError('odoo.exceptions.UserError', 'Notes are failing today');
                    const id = state.nextId++;
                    for (const attachmentId of params.attachment_ids || []) {
                        const meta = state.attachmentMeta.get(attachmentId);
                        if (meta) Object.assign(meta, { res_model: model, res_id: resId });
                    }
                    state.messages.push({ id, model, res_id: resId, body: params.body, message_type: params.message_type, subtype_xmlid: params.subtype_xmlid, attachment_ids: params.attachment_ids || [] });
                    return send(200, [id]);
                }
                case 'crm.lead/write':
                case 'sale.order/write':
                case 'crm.lead/unlink':
                case 'sale.order/unlink':
                    return send(200, true);

                default:
                    return send(404, { name: 'werkzeug.exceptions.NotFound', message: 'the model does not exist' });
            }
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}
