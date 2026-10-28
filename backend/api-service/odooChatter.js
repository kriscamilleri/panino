/**
 * Send a Document's PDF to the chatter of an opportunity or a sales order
 * (docs/specs/active/odoo-integration.md §5, §6). The PDF is posted as an
 * internal note, so the customer is never emailed. Sending again to the same
 * record overwrites the PDF on that note and posts a short "replaced" note.
 *
 * The opportunity or order itself is never written: the only calls on it are
 * `read` and `message_post`. What Panino creates, and may later overwrite, is
 * its own `ir.attachment`, under the same ownership check as every other link.
 */

import { OdooError, fileField, verifyAttachment } from './odooClient.js';
import { dropLink, readLink, saveLink } from './odooLinks.js';

/** The records that may receive a note, and the app each one needs. */
export const CHATTER_MODELS = Object.freeze({
    'crm.lead': 'crm',
    'sale.order': 'sales',
});

const ATTACHMENT = 'ir.attachment';
const UPLOAD_LIMITS = { timeoutMs: 60000 };
const PICKER_LIMIT = 10;

const ORDER_STATES = Object.freeze({
    draft: 'Quotation',
    sent: 'Quotation sent',
    sale: 'Sales order',
    cancel: 'Cancelled',
});

/**
 * @param {string} resModel
 * @param {number} resId
 * @returns {string} the link table's `target_key`, e.g. `crm.lead:42`
 */
export function chatterTargetKey(resModel, resId) {
    return `${resModel}:${resId}`;
}

/**
 * The path of a record in Odoo's web client (Odoo 17.2 and later; checked on 19).
 *
 * @param {string} resModel
 * @param {number} resId
 * @returns {string}
 */
export function recordUrlPath(resModel, resId) {
    return `/odoo/${resModel}/${resId}`;
}

/**
 * Validate what the client names as the record to post on.
 *
 * @param {unknown} input `{ resModel, resId }`
 * @returns {{ ok: true, resModel: string, resId: number } | { ok: false }}
 */
export function parseChatterTarget(input) {
    if (!input || typeof input !== 'object') return { ok: false };
    const resModel = typeof input.resModel === 'string' ? input.resModel : '';
    const resId = Number(input.resId);
    if (!Object.hasOwn(CHATTER_MODELS, resModel)) return { ok: false };
    if (!Number.isInteger(resId) || resId <= 0) return { ok: false };
    return { ok: true, resModel, resId };
}

function many2oneName(value) {
    return Array.isArray(value) ? String(value[1] || '').slice(0, 200) : null;
}

function pickerRow(resModel, row) {
    const status = resModel === 'crm.lead'
        ? many2oneName(row.stage_id)
        : (ORDER_STATES[row.state] || null);
    return {
        resModel,
        resId: row.id,
        name: String(row.name || '').slice(0, 200),
        partnerName: many2oneName(row.partner_id),
        status,
    };
}

/**
 * Opportunities and sales orders for the picker, matching `query` by reference,
 * name or customer. Only the models whose app this connection has are searched.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {string[]} apps the connection's apps
 * @param {string} query
 * @returns {Promise<{ resModel: string, resId: number, name: string, partnerName: string|null, status: string|null }[]>}
 */
export async function searchRecords(client, apps, query) {
    const available = new Set(Array.isArray(apps) ? apps : []);
    const results = [];
    if (available.has('crm')) {
        const domain = [['type', '=', 'opportunity']];
        if (query) domain.push('|', ['name', 'ilike', query], ['partner_id', 'ilike', query]);
        const rows = await client.call('crm.lead', 'search_read', {
            domain, fields: ['name', 'partner_id', 'stage_id'], limit: PICKER_LIMIT, order: 'write_date desc',
        });
        for (const row of Array.isArray(rows) ? rows : []) results.push(pickerRow('crm.lead', row));
    }
    if (available.has('sales')) {
        const domain = [];
        if (query) domain.push('|', ['name', 'ilike', query], ['partner_id', 'ilike', query]);
        const rows = await client.call('sale.order', 'search_read', {
            domain, fields: ['name', 'partner_id', 'state'], limit: PICKER_LIMIT, order: 'write_date desc',
        });
        for (const row of Array.isArray(rows) ? rows : []) results.push(pickerRow('sale.order', row));
    }
    return results;
}

/**
 * The records behind chatter links, so the picker can list them first. Records
 * that are gone, or that this Odoo user may not read, are left out.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {{ resModel: string, resId: number }[]} targets
 * @returns {Promise<ReturnType<typeof pickerRow>[]>}
 */
export async function readRecords(client, targets) {
    const results = [];
    for (const resModel of Object.keys(CHATTER_MODELS)) {
        const ids = targets.filter((t) => t.resModel === resModel).map((t) => t.resId);
        if (ids.length === 0) continue;
        const fields = resModel === 'crm.lead' ? ['name', 'partner_id', 'stage_id'] : ['name', 'partner_id', 'state'];
        let rows;
        try {
            rows = await client.call(resModel, 'read', { ids, fields });
        } catch (error) {
            if (error instanceof OdooError && ['access_denied', 'missing_app', 'record_gone'].includes(error.code)) continue;
            throw error;
        }
        for (const row of Array.isArray(rows) ? rows : []) results.push(pickerRow(resModel, row));
    }
    return results;
}

/**
 * @param {object} options
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} options.client the sender's
 * @param {string} options.odooTarget from `odooTarget(connection)`
 * @param {import('better-sqlite3').Database} options.db the Document's database
 * @param {string} options.noteId
 * @param {string} options.fileName the PDF's name, from `pdfFileName`
 * @param {Buffer} options.pdf
 * @param {string} options.resModel one of `CHATTER_MODELS`
 * @param {number} options.resId
 * @param {string} options.userId the sender
 * @returns {Promise<{ created: boolean, recreated: boolean, noteMissing: boolean, attachmentId: number, urlPath: string }>}
 * @throws {OdooError}
 */
export async function sendPdfToChatter({ client, odooTarget, db, noteId, fileName, pdf, resModel, resId, userId }) {
    if (!Object.hasOwn(CHATTER_MODELS, resModel)) throw new Error(`Not a chatter model: ${resModel}`);
    const content = pdf.toString('base64');
    const urlPath = recordUrlPath(resModel, resId);
    const key = { sourceId: noteId, destination: 'chatter', odooTarget, targetKey: chatterTargetKey(resModel, resId) };

    // The record must exist and be readable; `read` answers `[]` for a deleted id.
    const records = await client.call(resModel, 'read', { ids: [resId], fields: ['name'] });
    if (!Array.isArray(records) || records.length === 0) throw new OdooError('record_gone');

    const field = await fileField(client, odooTarget, ATTACHMENT);
    const link = readLink(db, key);
    let recreated = false;
    if (link) {
        const rows = await client.call(ATTACHMENT, 'read', {
            ids: [link.odoo_record_id],
            fields: ['create_date', 'res_model', 'res_id'],
        });
        const attachment = Array.isArray(rows) ? rows[0] : null;
        // Still the attachment Panino staged, and still on this record: anything else
        // (deleted, a different database, moved to another record) is left alone.
        const stillOurs = attachment
            && (!link.odoo_create_date || attachment.create_date === link.odoo_create_date)
            && attachment.res_model === resModel
            && Number(attachment.res_id) === resId;
        if (stillOurs) {
            await client.call(ATTACHMENT, 'write', {
                ids: [link.odoo_record_id],
                vals: { name: fileName, [field]: content },
            }, UPLOAD_LIMITS);
            const now = new Date().toISOString();
            saveLink(db, { ...key, recordId: link.odoo_record_id, createDate: attachment.create_date, urlPath, userId, now });
            await verifyAttachment(client, link.odoo_record_id, pdf);
            // The overwrite stands even if this note fails; the result says it is missing.
            let noteMissing = false;
            try {
                await postNote(client, resModel, resId, `${fileName} was replaced with a new version from Panino.`);
            } catch (error) {
                if (!(error instanceof OdooError)) throw error;
                noteMissing = true;
            }
            return { created: false, recreated: false, noteMissing, attachmentId: link.odoo_record_id, urlPath };
        }
        dropLink(db, key);
        recreated = true;
    }

    // Stage the attachment as the web client does, check it, then post the note that
    // takes it over. A failed post leaves an attachment linked to nothing, which Odoo
    // vacuums; Panino never deletes in Odoo.
    const ids = await client.call(ATTACHMENT, 'create', {
        vals_list: [{
            name: fileName,
            [field]: content,
            mimetype: 'application/pdf',
            res_model: 'mail.compose.message',
            res_id: 0,
        }],
    }, UPLOAD_LIMITS);
    const attachmentId = Array.isArray(ids) ? ids[0] : null;
    if (!Number.isInteger(attachmentId)) throw new OdooError('odoo_error');
    await verifyAttachment(client, attachmentId, pdf);

    const messageId = await postNote(client, resModel, resId, `${fileName} (PDF from Panino)`, [attachmentId]);

    const rows = await client.call(ATTACHMENT, 'read', { ids: [attachmentId], fields: ['create_date'] });
    saveLink(db, {
        ...key,
        recordId: attachmentId,
        messageId,
        createDate: rows?.[0]?.create_date ?? null,
        urlPath,
        userId,
        now: new Date().toISOString(),
    });
    return { created: true, recreated, noteMissing: false, attachmentId, urlPath };
}

/**
 * Post an internal note. The subtype is fixed here, never taken from the client.
 *
 * @returns {Promise<number|null>} the message id
 */
async function postNote(client, resModel, resId, body, attachmentIds = []) {
    const result = await client.call(resModel, 'message_post', {
        ids: [resId],
        body,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
        ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
    });
    const id = Array.isArray(result) ? result[0] : result;
    return Number.isInteger(id) ? id : null;
}
