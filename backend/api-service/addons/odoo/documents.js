/**
 * Send a Document's PDF to Odoo Documents (docs/specs/active/odoo-integration.md
 * §5, §6). The first send creates a document in the chosen folder; later sends
 * overwrite that same document, and only after checking it is still the record
 * Panino created. Every upload is checked against Odoo's checksum.
 */

import { OdooError, fileField, odooUrlPath, verifyAttachment } from './client.js';
import { dropLink, readLink, saveLink } from './links.js';

const MODEL = 'documents.document';
const UPLOAD_LIMITS = { timeoutMs: 60000 };

/**
 * A file name Odoo and its users can live with: the title, without path or control
 * characters, ending in `.pdf`.
 *
 * @param {string} title
 * @returns {string}
 */
export function pdfFileName(title) {
    const base = String(title ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
        .replace(/\.pdf$/i, '');
    return `${base || 'Untitled'}.pdf`;
}

/**
 * @param {object} options
 * @param {ReturnType<import('./client.js').createOdooClient>} options.client the sender's
 * @param {string} options.odooTarget from `odooTarget(connection)`
 * @param {import('better-sqlite3').Database} options.db the Document's database
 * @param {string} options.noteId
 * @param {string} options.title
 * @param {Buffer} options.pdf
 * @param {number|null} options.folderId used only when creating
 * @param {string} options.userId the sender
 * @returns {Promise<{ created: boolean, recreated: boolean, recordId: number, urlPath: string|null }>}
 * @throws {OdooError}
 */
export async function sendPdfToDocuments({ client, odooTarget, db, noteId, title, pdf, folderId, userId }) {
    const name = pdfFileName(title);
    const content = pdf.toString('base64');
    const field = await fileField(client, odooTarget, MODEL);
    const key = { sourceId: noteId, destination: 'documents', odooTarget };
    const link = readLink(db, key);

    let recreated = false;
    if (link) {
        const rows = await client.call(MODEL, 'read', {
            ids: [link.odoo_record_id],
            fields: ['create_date', 'attachment_id', 'access_url'],
        });
        const record = Array.isArray(rows) ? rows[0] : null;
        // Gone in Odoo (`read` answers `[]`), or not the record Panino created: start
        // a new one and leave whatever has that id alone.
        const stillOurs = record && (!link.odoo_create_date || record.create_date === link.odoo_create_date);
        if (stillOurs) {
            await client.call(MODEL, 'write', { ids: [link.odoo_record_id], vals: { name, [field]: content } }, UPLOAD_LIMITS);
            const attachmentId = Array.isArray(record.attachment_id) ? record.attachment_id[0] : null;
            const urlPath = odooUrlPath(record.access_url) || link.odoo_url_path;
            saveLink(db, {
                ...key,
                recordId: link.odoo_record_id,
                createDate: record.create_date,
                urlPath,
                userId,
                now: new Date().toISOString(),
            });
            if (!attachmentId) throw new OdooError('upload_corrupt');
            await verifyAttachment(client, attachmentId, pdf);
            return { created: false, recreated: false, recordId: link.odoo_record_id, urlPath };
        }
        dropLink(db, key);
        recreated = true;
    }

    if (!Number.isInteger(folderId) || folderId <= 0) throw new OdooError('missing_folder');
    const ids = await client.call(MODEL, 'create', {
        vals_list: [{ name, folder_id: folderId, [field]: content, mimetype: 'application/pdf' }],
    }, UPLOAD_LIMITS);
    const recordId = Array.isArray(ids) ? ids[0] : null;
    if (!Number.isInteger(recordId)) throw new OdooError('odoo_error');

    // Record the link before checking the upload: the record is Panino's either way,
    // and a corrupt upload is fixed by sending again, which overwrites it.
    const rows = await client.call(MODEL, 'read', { ids: [recordId], fields: ['create_date', 'attachment_id', 'access_url'] });
    const record = Array.isArray(rows) ? rows[0] : null;
    const urlPath = odooUrlPath(record?.access_url);
    saveLink(db, {
        ...key,
        recordId,
        createDate: record?.create_date ?? null,
        urlPath,
        userId,
        now: new Date().toISOString(),
    });
    const attachmentId = Array.isArray(record?.attachment_id) ? record.attachment_id[0] : null;
    if (!attachmentId) throw new OdooError('upload_corrupt');
    await verifyAttachment(client, attachmentId, pdf);
    return { created: true, recreated, recordId, urlPath };
}

/**
 * Folders for the picker, matching `query` by name.
 *
 * @param {ReturnType<import('./client.js').createOdooClient>} client
 * @param {string} query
 * @returns {Promise<{ id: number, name: string, parentName: string|null }[]>}
 */
export async function searchFolders(client, query) {
    const domain = [['type', '=', 'folder']];
    if (query) domain.push(['name', 'ilike', query]);
    const rows = await client.call(MODEL, 'search_read', {
        domain,
        fields: ['name', 'folder_id'],
        limit: 30,
        order: 'name',
    });
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        name: String(row.name || '').slice(0, 200),
        parentName: Array.isArray(row.folder_id) ? String(row.folder_id[1] || '').slice(0, 200) : null,
    }));
}
