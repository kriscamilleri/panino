/**
 * Odoo Knowledge syncs (docs/specs/active/odoo-integration.md §11): a folder, a
 * single Document or a whole space mirrored one way into Knowledge, under one
 * parent article. A run reads the server copy of the database, renders every
 * Document the way the Preview does (shared/markdownRender.js), hashes
 * name + parent + body + order, and writes only what changed. Deleted or moved-out
 * Documents are archived in Odoo, never deleted. Each record succeeds or fails on
 * its own; failures are retried by the next run. A link stores its hash only once
 * the article is complete, images included, so a run that fails halfway leaves the
 * record pending rather than looking done. The daily reconcile also compares
 * Odoo's side: an article body edited there, or a filed PDF deleted there, is put back.
 *
 * Everything written goes through `odoo_links` rows carrying `sync_id`, so the
 * ownership rule of §6 (only Panino's own records, checked by `create_date`) holds
 * for syncs unchanged. An article a person sent by hand before the sync existed
 * is adopted, not duplicated.
 */

import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { applyDocumentVariables, renderDocumentHtml } from '@panino/content-merge/markdown-render';
import { OdooError, odooUrlPath } from './client.js';
import { articleBody, bodySignature } from './knowledge.js';
import { internalImageSources, uploadArticleImages } from './articleImages.js';
import { sendPdfToDocuments } from './documents.js';
import { buildSyncPdfRequest } from './syncPdf.js';
import { dropLink, readLink, saveLink } from './links.js';

const MODEL = 'knowledge.article';
export const SYNC_SCOPES = Object.freeze(['space', 'folder', 'note']);
export const PAUSE_REASONS = Object.freeze(['key_rejected', 'not_connected', 'addon_disabled', 'left_space', 'manual']);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * @typedef {object} OdooSync
 * @property {string} id
 * @property {'space'|'folder'|'note'} scope
 * @property {string|null} source_id
 * @property {string} odoo_target
 * @property {number|null} parent_article_id
 * @property {number|null} documents_folder_id
 * @property {string} run_as
 * @property {'active'|'paused'} status
 * @property {string|null} paused_reason
 * @property {string|null} last_run_at
 * @property {string|null} last_reconcile_at
 * @property {string|null} last_result JSON
 * @property {string} created_by
 * @property {string} created_at
 */

/** @returns {OdooSync[]} */
export function listSyncs(db) {
    return db.prepare('SELECT * FROM odoo_syncs ORDER BY created_at').all();
}

/** @returns {OdooSync|null} */
export function readSync(db, id) {
    return db.prepare('SELECT * FROM odoo_syncs WHERE id = ?').get(id) || null;
}

/**
 * The sync covering a source, if any: its own, or one of a folder above it, or
 * the space's. Used to refuse a second sync inside a synced tree and to tell the
 * send sheet a Document is synced.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ sourceType: 'note'|'folder', sourceId: string }} source
 * @returns {OdooSync|null}
 */
export function syncCovering(db, { sourceType, sourceId }) {
    const syncs = listSyncs(db);
    if (syncs.length === 0) return null;
    const space = syncs.find((sync) => sync.scope === 'space');
    if (space) return space;
    if (sourceType === 'note') {
        const own = syncs.find((sync) => sync.scope === 'note' && sync.source_id === sourceId);
        if (own) return own;
    }
    const folderSyncs = syncs.filter((sync) => sync.scope === 'folder');
    if (folderSyncs.length === 0) return null;
    let folderId = sourceType === 'folder'
        ? sourceId
        : db.prepare('SELECT folder_id FROM notes WHERE id = ?').get(sourceId)?.folder_id ?? null;
    const seen = new Set();
    while (folderId && !seen.has(folderId)) {
        seen.add(folderId);
        const match = folderSyncs.find((sync) => sync.source_id === folderId);
        if (match) return match;
        folderId = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(folderId)?.parent_id ?? null;
    }
    return null;
}

/**
 * Whether a new sync of `source` would overlap an existing one: the same source,
 * a sync above it, or (for a folder or space) a sync inside it.
 *
 * @returns {OdooSync|null} the sync in the way
 */
export function syncOverlapping(db, { scope, sourceId }) {
    const syncs = listSyncs(db);
    if (syncs.length === 0) return null;
    if (scope === 'space') return syncs[0];
    const above = syncCovering(db, { sourceType: scope, sourceId });
    if (above) return above;
    if (scope === 'note') return null;
    // Anything already synced below this folder.
    const inside = new Set(folderSubtree(db, sourceId));
    return syncs.find((sync) => {
        if (sync.scope === 'folder') return inside.has(sync.source_id);
        if (sync.scope === 'note') {
            const folderId = db.prepare('SELECT folder_id FROM notes WHERE id = ?').get(sync.source_id)?.folder_id ?? null;
            return folderId !== null && (folderId === sourceId || inside.has(folderId));
        }
        return false;
    }) || null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ scope: string, sourceId?: string|null, odooTarget: string, parentArticleId?: number|null, documentsFolderId?: number|null, runAs: string, createdBy: string }} values
 * @returns {OdooSync}
 */
export function createSync(db, values) {
    if (!SYNC_SCOPES.includes(values.scope)) throw new Error(`Not a sync scope: ${values.scope}`);
    const id = uuidv4();
    const now = new Date().toISOString();
    // The first run writes everything anyway, so the first daily reconcile is due a day later.
    db.prepare(`
        INSERT INTO odoo_syncs (id, scope, source_id, odoo_target, parent_article_id, documents_folder_id,
            run_as, status, paused_reason, last_reconcile_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)
    `).run(
        id, values.scope, values.scope === 'space' ? null : values.sourceId, values.odooTarget,
        values.parentArticleId ?? null, values.documentsFolderId ?? null,
        values.runAs, now, values.createdBy, now,
    );
    return readSync(db, id);
}

/**
 * Remove a sync. Its articles stay in Odoo as they are; the links lose their
 * `sync_id`, so a later manual send updates the same article instead of making
 * another.
 */
export function deleteSync(db, id) {
    db.prepare('UPDATE odoo_links SET sync_id = NULL, content_hash = NULL WHERE sync_id = ?').run(id);
    db.prepare('DELETE FROM odoo_syncs WHERE id = ?').run(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ status: 'active'|'paused', reason?: string|null, runAs?: string }} change
 */
export function setSyncStatus(db, id, { status, reason = null, runAs }) {
    db.prepare(`
        UPDATE odoo_syncs
           SET status = ?, paused_reason = ?, run_as = COALESCE(?, run_as)
         WHERE id = ?
    `).run(status, status === 'paused' ? reason : null, runAs ?? null, id);
}

/** Record a run's outcome. */
export function saveSyncRun(db, id, { result, reconcile = false, now = new Date().toISOString() }) {
    db.prepare(`
        UPDATE odoo_syncs
           SET last_run_at = ?, last_result = ?, last_reconcile_at = CASE WHEN ? THEN ? ELSE last_reconcile_at END
         WHERE id = ?
    `).run(now, JSON.stringify(result), reconcile ? 1 : 0, now, id);
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/** Every folder id below `folderId`, not including it. */
function folderSubtree(db, folderId) {
    const rows = db.prepare('SELECT id, parent_id FROM folders').all();
    const children = new Map();
    for (const row of rows) {
        const list = children.get(row.parent_id ?? null) || [];
        list.push(row.id);
        children.set(row.parent_id ?? null, list);
    }
    const result = [];
    const stack = [...(children.get(folderId) || [])];
    const seen = new Set();
    while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
        stack.push(...(children.get(id) || []));
    }
    return result;
}

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
    || String(a.sourceId).localeCompare(String(b.sourceId));

/**
 * @typedef {object} SyncRecord
 * @property {string} sourceId
 * @property {'note'|'folder'} sourceType
 * @property {string|null} parentSourceId null for a direct child of the sync's parent article
 * @property {string} name
 * @property {string|null} markdown notes only
 * @property {number} sequence order among siblings
 * @property {number} depth 0 for direct children of the parent article
 */

/**
 * What the sync mirrors right now, level by level, siblings in title order.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {OdooSync} sync
 * @returns {SyncRecord[]}
 */
export function syncTree(db, sync) {
    if (sync.scope === 'note') {
        const note = db.prepare('SELECT id, title, content FROM notes WHERE id = ?').get(sync.source_id);
        if (!note) return [];
        return [{ sourceId: note.id, sourceType: 'note', parentSourceId: null, name: note.title || 'Untitled', markdown: note.content || '', sequence: 0, depth: 0 }];
    }

    let folderIds;
    let rootFolderId;
    if (sync.scope === 'folder') {
        rootFolderId = sync.source_id;
        if (!db.prepare('SELECT id FROM folders WHERE id = ?').get(rootFolderId)) return [];
        folderIds = new Set(folderSubtree(db, rootFolderId));
    } else {
        rootFolderId = null;
        folderIds = new Set(db.prepare('SELECT id FROM folders').all().map((row) => row.id));
    }

    const folders = db.prepare('SELECT id, name, parent_id FROM folders').all().filter((row) => folderIds.has(row.id));
    const notes = db.prepare('SELECT id, title, content, folder_id FROM notes').all()
        .filter((row) => (row.folder_id ?? null) === rootFolderId || folderIds.has(row.folder_id));

    const items = [
        ...folders.map((row) => ({
            sourceId: row.id, sourceType: 'folder', name: row.name || 'Untitled folder', markdown: null,
            parentSourceId: (row.parent_id ?? null) === rootFolderId ? null : row.parent_id,
        })),
        ...notes.map((row) => ({
            sourceId: row.id, sourceType: 'note', name: row.title || 'Untitled', markdown: row.content || '',
            parentSourceId: (row.folder_id ?? null) === rootFolderId ? null : row.folder_id,
        })),
    ];

    const siblings = new Map();
    for (const item of items) {
        const list = siblings.get(item.parentSourceId) || [];
        list.push(item);
        siblings.set(item.parentSourceId, list);
    }
    const result = [];
    const walk = (parentSourceId, depth) => {
        const list = (siblings.get(parentSourceId) || []).sort(byName);
        list.forEach((item, index) => {
            result.push({ ...item, sequence: index, depth });
            if (item.sourceType === 'folder') walk(item.sourceId, depth + 1);
        });
    };
    walk(null, 0);
    return result;
}

/**
 * The hash a link stores for what was last written.
 *
 * @param {{ name: string, parentArticleId: number|false|null, body: string, sequence: number }} values
 * @returns {string}
 */
export function contentHash({ name, parentArticleId, body, sequence }) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([name, parentArticleId || null, body, sequence]))
        .digest('hex');
}

// ---------------------------------------------------------------------------
// A run
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SyncRunResult
 * @property {number} created
 * @property {number} updated
 * @property {number} unchanged
 * @property {number} archived
 * @property {number} restored
 * @property {number} pdfs PDFs filed in Documents (Phase 12)
 * @property {{ sourceId: string, name: string, error: string, pdf?: boolean, images?: number }[]} failures
 *   `pdf`: the PDF, not the article; `images_failed` with `images`: uploads Odoo refused, retried next run
 * @property {string|null} paused the reason the run stopped the sync, if it did
 */

/**
 * Run one sync.
 *
 * @param {object} options
 * @param {import('better-sqlite3').Database} options.db the synced database
 * @param {OdooSync} options.sync
 * @param {ReturnType<import('./client.js').createOdooClient>} options.client the runner's
 * @param {string} options.odooTarget the runner's target; must equal `sync.odoo_target`
 * @param {string} options.userId the runner (for `last_sent_by`)
 * @param {(src: string) => object|null} [options.readImage]
 * @param {Map<string,string>|object} [options.globals] the account's global variables
 * @param {boolean} [options.reconcile] compare with Odoo's side too (daily)
 * @param {(request: object) => Promise<{ ok: boolean, pdf?: Buffer }>} [options.renderPdf]
 *   renders a Document's PDF for the sync's Documents folder (Phase 12); none: no PDFs
 * @param {Date} [options.now]
 * @returns {Promise<SyncRunResult>}
 */
export async function runSync({ db, sync, client, odooTarget, userId, readImage = null, globals = {}, reconcile = false, renderPdf = null, now = new Date() }) {
    if (odooTarget !== sync.odoo_target) throw new OdooError('access_denied');
    const result = { created: 0, updated: 0, unchanged: 0, archived: 0, restored: 0, pdfs: 0, failures: [], paused: null };
    const fail = (record, error) => {
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        if (!(error instanceof OdooError)) console.error('[odoo-sync] Unexpected error:', error);
        result.failures.push({ sourceId: record.sourceId, name: record.name, error: code });
        return code;
    };
    const stop = (code) => {
        if (['key_rejected', 'not_odoo', 'unreachable', 'blocked'].includes(code)) {
            result.paused = code === 'key_rejected' ? 'key_rejected' : null;
            return true;
        }
        return false;
    };

    const tree = syncTree(db, sync);
    const present = new Set(tree.map((record) => record.sourceId));
    const links = new Map();
    for (const link of db.prepare(`
        SELECT * FROM odoo_links WHERE destination = 'knowledge' AND odoo_target = ? AND (sync_id = ? OR sync_id IS NULL)
    `).all(odooTarget, sync.id)) {
        // A manual send's link is adopted only for a note that is now in the tree.
        if (link.sync_id === sync.id || (link.source_type === 'note' && present.has(link.source_id))) {
            links.set(link.source_id, link);
        }
    }
    const articleIds = new Map();
    for (const [sourceId, link] of links) if (!link.archived_at) articleIds.set(sourceId, link.odoo_record_id);

    let memberPartnerId = null;
    const rootPermissions = async () => {
        if (memberPartnerId !== null) return memberPartnerId;
        const context = await client.call('res.users', 'context_get');
        const rows = await client.call('res.users', 'read', { ids: [context.uid], fields: ['partner_id'] });
        memberPartnerId = Array.isArray(rows?.[0]?.partner_id) ? rows[0].partner_id[0] : false;
        return memberPartnerId;
    };

    const nowIso = now.toISOString();
    /** Save the link for an article; `hash: null` marks one whose body is not complete yet. */
    const saveFor = (record, { recordId, createDate, urlPath, hash }) => {
        saveLink(db, {
            sourceId: record.sourceId, sourceType: record.sourceType, destination: 'knowledge', odooTarget,
            recordId, createDate, urlPath, userId, now: nowIso, syncId: sync.id, contentHash: hash, archivedAt: null,
        });
        articleIds.set(record.sourceId, recordId);
    };
    /** An upload Odoo refused is a failure of the record, retried by the next run. */
    const noteImages = (record, images) => {
        if (images.failed > 0) result.failures.push({ sourceId: record.sourceId, name: record.name, error: 'images_failed', images: images.failed });
    };
    /** Whether the PDF a link points at is still in Odoo, and still the record Panino made. */
    const pdfStillFiled = async (link) => {
        const rows = await client.call('documents.document', 'read', { ids: [link.odoo_record_id], fields: ['create_date'] });
        const doc = Array.isArray(rows) ? rows[0] : null;
        return Boolean(doc) && (!link.odoo_create_date || doc.create_date === link.odoo_create_date);
    };

    /**
     * File the Document's PDF in the sync's Documents folder when the sync asks for it
     * and the PDF would differ from the one filed last. Returns a failure code to stop on,
     * or '' (a lost PDF never stops the articles).
     */
    const filePdf = async (record) => {
        if (!renderPdf || !sync.documents_folder_id || record.sourceType !== 'note') return '';
        const note = db.prepare('SELECT id, title, content, folder_id FROM notes WHERE id = ?').get(record.sourceId);
        if (!note) return '';
        let built;
        try {
            built = buildSyncPdfRequest({ db, note, globals, now });
        } catch (error) {
            console.error('[odoo-sync] Could not build a PDF request:', error);
            result.failures.push({ sourceId: record.sourceId, name: record.name, error: 'odoo_error', pdf: true });
            return '';
        }
        const key = { sourceId: record.sourceId, destination: 'documents', odooTarget };
        try {
            const existing = readLink(db, key);
            if (existing && existing.sync_id === sync.id && existing.content_hash === built.hash) {
                // The hash says this PDF is filed; the daily pass also checks it still is.
                if (!reconcile || await pdfStillFiled(existing)) return '';
            }
            const rendered = await renderPdf(built.request);
            if (!rendered?.ok) {
                result.failures.push({ sourceId: record.sourceId, name: record.name, error: 'pdf_failed', pdf: true });
                return '';
            }
            await sendPdfToDocuments({
                client, odooTarget, db, noteId: record.sourceId, title: record.name, pdf: rendered.pdf,
                folderId: sync.documents_folder_id, userId,
            });
            db.prepare('UPDATE odoo_links SET sync_id = ?, content_hash = ? WHERE source_id = ? AND destination = ? AND odoo_target = ? AND target_key = ?')
                .run(sync.id, built.hash, record.sourceId, 'documents', odooTarget, '');
            result.pdfs += 1;
            return '';
        } catch (error) {
            const code = error instanceof OdooError ? error.code : 'odoo_error';
            if (!(error instanceof OdooError)) console.error('[odoo-sync] Unexpected error filing a PDF:', error);
            result.failures.push({ sourceId: record.sourceId, name: record.name, error: code, pdf: true });
            return ['key_rejected', 'not_odoo', 'unreachable', 'blocked'].includes(code) ? code : '';
        }
    };

    const depths = [...new Set(tree.map((record) => record.depth))].sort((a, b) => a - b);
    for (const depth of depths) {
        const level = tree.filter((record) => record.depth === depth);
        const toCreate = [];
        for (const record of level) {
            const parentArticleId = record.parentSourceId === null
                ? (sync.parent_article_id || false)
                : (articleIds.get(record.parentSourceId) ?? null);
            if (parentArticleId === null) {
                result.failures.push({ sourceId: record.sourceId, name: record.name, error: 'parent_failed' });
                continue;
            }
            const body = record.sourceType === 'note'
                ? articleBody(renderDocumentHtml(applyDocumentVariables(record.markdown, { globals, now })), record.name, { keepInternalImages: true })
                : '';
            const hash = contentHash({ name: record.name, parentArticleId, body, sequence: record.sequence });
            const link = links.get(record.sourceId);
            const prepared = { record, parentArticleId, body, hash, link };

            if (!link) {
                toCreate.push(prepared);
                continue;
            }
            if (!reconcile && !link.archived_at && link.sync_id === sync.id && link.content_hash === hash) {
                result.unchanged += 1;
                if (stop(await filePdf(record))) return result;
                continue;
            }
            try {
                const { outcome, images } = await updateArticle({ client, db, odooTarget, prepared, readImage, reconcile, saveFor });
                if (outcome === 'gone') toCreate.push(prepared);
                else if (outcome === 'unchanged') result.unchanged += 1;
                else {
                    result.updated += 1;
                    if (link.archived_at) result.restored += 1;
                    noteImages(record, images);
                }
                if (outcome !== 'gone' && stop(await filePdf(record))) return result;
            } catch (error) {
                if (stop(fail(record, error))) return result;
            }
        }

        if (toCreate.length === 0) continue;
        let permissions = {};
        if (depth === 0 && sync.scope !== 'note') {
            try {
                const partnerId = await rootPermissions();
                permissions = partnerId
                    ? { internal_permission: 'read', article_member_ids: [[0, 0, { partner_id: partnerId, permission: 'write' }]] }
                    : {};
            } catch (error) {
                if (stop(fail(toCreate[0].record, error))) return result;
            }
        }
        const batches = toCreate.length > 1 ? [toCreate] : [toCreate];
        for (const batch of batches) {
            const vals = batch.map(({ record, parentArticleId, body }) => ({
                name: record.name,
                body: placeholderBody(body),
                parent_id: parentArticleId,
                sequence: record.sequence,
                ...(record.parentSourceId === null ? permissions : {}),
            }));
            let ids;
            try {
                ids = await client.call(MODEL, 'create', { vals_list: vals });
            } catch (error) {
                const code = error instanceof OdooError ? error.code : 'odoo_error';
                if (batch.length === 1 || ['key_rejected', 'not_odoo', 'unreachable', 'blocked'].includes(code)) {
                    if (stop(fail(batch[0].record, error))) return result;
                    continue;
                }
                // One record can spoil the batch; the others still deserve a try, one by one.
                for (const [index, prepared] of batch.entries()) {
                    try {
                        const [id] = await client.call(MODEL, 'create', { vals_list: [vals[index]] });
                        const images = await finishCreate({ client, db, odooTarget, prepared, id, readImage, saveFor });
                        result.created += 1;
                        noteImages(prepared.record, images);
                    } catch (inner) {
                        if (stop(fail(prepared.record, inner))) return result;
                        continue;
                    }
                    if (stop(await filePdf(prepared.record))) return result;
                }
                continue;
            }
            for (const [index, prepared] of batch.entries()) {
                const id = Array.isArray(ids) ? ids[index] : null;
                if (!Number.isInteger(id)) {
                    result.failures.push({ sourceId: prepared.record.sourceId, name: prepared.record.name, error: 'odoo_error' });
                    continue;
                }
                try {
                    const images = await finishCreate({ client, db, odooTarget, prepared, id, readImage, saveFor });
                    result.created += 1;
                    noteImages(prepared.record, images);
                } catch (error) {
                    if (stop(fail(prepared.record, error))) return result;
                }
                if (stop(await filePdf(prepared.record))) return result;
            }
        }
    }

    // Gone from the tree: archive in Odoo, keep the link so a comeback restores it. The
    // daily reconcile also re-archives what someone unarchived in Odoo.
    for (const [sourceId, link] of links) {
        if (present.has(sourceId) || link.sync_id !== sync.id) continue;
        if (link.archived_at && !reconcile) continue;
        const record = { sourceId, name: link.source_type === 'folder' ? 'Folder' : 'Document' };
        try {
            const rows = await client.call(MODEL, 'read', { ids: [link.odoo_record_id], fields: ['create_date', 'active'], context: { active_test: false } });
            const article = Array.isArray(rows) ? rows[0] : null;
            const ours = article && (!link.odoo_create_date || article.create_date === link.odoo_create_date);
            if (ours && article.active !== false) {
                await client.call(MODEL, 'write', { ids: [link.odoo_record_id], vals: { active: false } });
                result.archived += 1;
            }
            if (!link.archived_at) {
                db.prepare('UPDATE odoo_links SET archived_at = ? WHERE source_id = ? AND destination = ? AND odoo_target = ? AND target_key = ?')
                    .run(nowIso, sourceId, 'knowledge', odooTarget, '');
            }
        } catch (error) {
            if (stop(fail(record, error))) return result;
        }
    }
    return result;
}

/** The body written before the images are up: Panino URLs never reach Odoo. */
function placeholderBody(body) {
    if (!internalImageSources(body).length) return body;
    return body.replace(/<img\b[^>]*>/gi, (tag) => {
        const alt = /\balt="([^"]*)"/i.exec(tag)?.[1];
        return `<span class="o_panino_image_placeholder">${alt ? `Image not sent: ${alt}` : 'Image not sent'}</span>`;
    });
}

/** Upload the body's images and write the body that points at them. */
async function writeImages({ client, odooTarget, articleId, body, readImage }) {
    const images = await uploadArticleImages({ client, odooTarget, articleId, body, readImage });
    await client.call(MODEL, 'write', { ids: [articleId], vals: { body: images.body } });
    return images;
}

/**
 * The link of an article whose name, parent and placeholder body are written, then its
 * images. The link carries the article from the start, so a failure never leads to a
 * second one, but its hash only once the body is complete: a write that fails, or an
 * upload Odoo refused, leaves the record pending for the next run to finish.
 *
 * @returns {Promise<{ failed: number, missing: number }>} the images that did not go up
 */
async function completeArticle({ client, odooTarget, prepared, identity, readImage, saveFor }) {
    const { record, body, hash } = prepared;
    const pending = Boolean(readImage) && internalImageSources(body).length > 0;
    saveFor(record, { ...identity, hash: pending ? null : hash });
    if (!pending) return { failed: 0, missing: 0 };
    const images = await writeImages({ client, odooTarget, articleId: identity.recordId, body, readImage });
    if (images.failed === 0) saveFor(record, { ...identity, hash });
    return { failed: images.failed, missing: images.missing };
}

async function finishCreate({ client, db, odooTarget, prepared, id, readImage, saveFor }) {
    if (prepared.link) dropLink(db, { sourceId: prepared.record.sourceId, destination: 'knowledge', odooTarget });
    // Remembered before anything else can fail: the article exists now.
    saveFor(prepared.record, { recordId: id, createDate: null, urlPath: `/knowledge/article/${id}`, hash: null });
    const rows = await client.call(MODEL, 'read', { ids: [id], fields: ['create_date', 'article_url'] });
    const article = Array.isArray(rows) ? rows[0] : null;
    const identity = {
        recordId: id,
        createDate: article?.create_date ?? null,
        urlPath: odooUrlPath(article?.article_url) || `/knowledge/article/${id}`,
    };
    return completeArticle({ client, odooTarget, prepared, identity, readImage, saveFor });
}

/**
 * @returns {Promise<{ outcome: 'updated'|'unchanged'|'gone', images: { failed: number, missing: number } }>}
 */
async function updateArticle({ client, db, odooTarget, prepared, readImage, reconcile, saveFor }) {
    const { record, parentArticleId, body, hash, link } = prepared;
    const none = { failed: 0, missing: 0 };
    // Complete and unchanged on Panino's side: the daily pass compares Odoo's side, body included.
    const compare = reconcile && Boolean(link.sync_id) && link.content_hash === hash && !link.archived_at;
    const rows = await client.call(MODEL, 'read', {
        ids: [link.odoo_record_id],
        fields: ['create_date', 'article_url', 'active', 'name', 'parent_id', 'sequence', ...(compare ? ['body'] : [])],
        context: { active_test: false },
    });
    const article = Array.isArray(rows) ? rows[0] : null;
    const stillOurs = article && (!link.odoo_create_date || article.create_date === link.odoo_create_date);
    if (!stillOurs) {
        dropLink(db, { sourceId: record.sourceId, destination: 'knowledge', odooTarget });
        return { outcome: 'gone', images: none };
    }
    if (compare) {
        const parentInOdoo = Array.isArray(article.parent_id) ? article.parent_id[0] : false;
        const same = article.active === true && article.name === record.name
            && parentInOdoo === (parentArticleId || false) && Number(article.sequence) === record.sequence
            && bodySignature(article.body) === bodySignature(body);
        if (same) return { outcome: 'unchanged', images: none };
    }
    await client.call(MODEL, 'write', {
        ids: [link.odoo_record_id],
        vals: { name: record.name, body: placeholderBody(body), parent_id: parentArticleId, sequence: record.sequence, active: true },
    });
    const identity = {
        recordId: link.odoo_record_id,
        createDate: article.create_date,
        urlPath: odooUrlPath(article.article_url) || link.odoo_url_path,
    };
    const images = await completeArticle({ client, odooTarget, prepared, identity, readImage, saveFor });
    return { outcome: 'updated', images };
}
