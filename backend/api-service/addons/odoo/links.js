/**
 * The `odoo_links` table: which Odoo record Panino made for which Document, per
 * destination and Odoo database. It is the only source of record ids Panino may
 * write to (docs/specs/active/odoo-integration.md §6). Rows live in the database
 * the Document lives in (personal or space), so a space shares them.
 */

/**
 * @typedef {object} OdooLink
 * @property {string} source_id
 * @property {string} destination
 * @property {string} odoo_target
 * @property {string} target_key
 * @property {number} odoo_record_id
 * @property {number|null} odoo_message_id
 * @property {string|null} odoo_create_date
 * @property {string|null} odoo_url_path
 * @property {string|null} sync_id the sync that owns this record, if one does
 * @property {string|null} content_hash sync only: what was last written
 * @property {string|null} archived_at sync only: archived in Odoo after a delete or move-out
 * @property {string} first_sent_by
 * @property {string} last_sent_at
 * @property {string} last_sent_by
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ sourceId: string, destination: string, odooTarget: string, targetKey?: string }} key
 * @returns {OdooLink|null}
 */
export function readLink(db, { sourceId, destination, odooTarget, targetKey = '' }) {
    return db.prepare(`
        SELECT * FROM odoo_links
         WHERE source_id = ? AND destination = ? AND odoo_target = ? AND target_key = ?
    `).get(sourceId, destination, odooTarget, targetKey) || null;
}

/**
 * Every link for one Document, newest send first.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sourceId
 * @returns {OdooLink[]}
 */
export function listLinks(db, sourceId) {
    return db.prepare('SELECT * FROM odoo_links WHERE source_id = ? ORDER BY last_sent_at DESC').all(sourceId);
}

/**
 * Record a record Panino created, or a later send to it. A manual send leaves
 * `syncId`, `contentHash` and `archivedAt` out and keeps whatever a sync stored;
 * a sync passes all three.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} link
 */
export function saveLink(db, link) {
    const syncFields = 'syncId' in link;
    db.prepare(`
        INSERT INTO odoo_links (source_id, source_type, destination, odoo_target, target_key, odoo_record_id,
            odoo_message_id, odoo_create_date, odoo_url_path, sync_id, content_hash, archived_at,
            first_sent_by, last_sent_at, last_sent_by)
        VALUES (@sourceId, @sourceType, @destination, @odooTarget, @targetKey, @recordId,
            @messageId, @createDate, @urlPath, @syncId, @contentHash, @archivedAt, @userId, @now, @userId)
        ON CONFLICT (source_id, destination, odoo_target, target_key) DO UPDATE SET
            odoo_record_id = excluded.odoo_record_id,
            odoo_message_id = COALESCE(excluded.odoo_message_id, odoo_links.odoo_message_id),
            odoo_create_date = COALESCE(excluded.odoo_create_date, odoo_links.odoo_create_date),
            odoo_url_path = COALESCE(excluded.odoo_url_path, odoo_links.odoo_url_path),
            sync_id = CASE WHEN @syncFields THEN excluded.sync_id ELSE odoo_links.sync_id END,
            content_hash = CASE WHEN @syncFields THEN excluded.content_hash ELSE NULL END,
            archived_at = CASE WHEN @syncFields THEN excluded.archived_at ELSE odoo_links.archived_at END,
            first_sent_by = CASE WHEN odoo_links.odoo_record_id = excluded.odoo_record_id
                                 THEN odoo_links.first_sent_by ELSE excluded.first_sent_by END,
            last_sent_at = excluded.last_sent_at,
            last_sent_by = excluded.last_sent_by
    `).run({
        sourceId: link.sourceId,
        sourceType: link.sourceType || 'note',
        destination: link.destination,
        odooTarget: link.odooTarget,
        targetKey: link.targetKey || '',
        recordId: link.recordId,
        messageId: link.messageId ?? null,
        createDate: link.createDate ?? null,
        urlPath: link.urlPath ?? null,
        syncId: link.syncId ?? null,
        contentHash: link.contentHash ?? null,
        archivedAt: link.archivedAt ?? null,
        syncFields: syncFields ? 1 : 0,
        userId: link.userId,
        now: link.now,
    });
}

/**
 * Forget a link (the record is gone, or is not the one Panino made).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ sourceId: string, destination: string, odooTarget: string, targetKey?: string }} key
 */
export function dropLink(db, { sourceId, destination, odooTarget, targetKey = '' }) {
    db.prepare(`
        DELETE FROM odoo_links WHERE source_id = ? AND destination = ? AND odoo_target = ? AND target_key = ?
    `).run(sourceId, destination, odooTarget, targetKey);
}

/**
 * The remembered folder and parent for new records in one Odoo database.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} odooTarget
 * @returns {{ folderId: number|null, parentArticleId: number|null }}
 */
export function readDefaults(db, odooTarget) {
    const row = db.prepare('SELECT folder_id, parent_article_id FROM odoo_defaults WHERE odoo_target = ?').get(odooTarget);
    return { folderId: row?.folder_id ?? null, parentArticleId: row?.parent_article_id ?? null };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} odooTarget
 * @param {{ folderId?: number, parentArticleId?: number }} values only the given ones change
 */
export function saveDefaults(db, odooTarget, { folderId, parentArticleId }) {
    db.prepare(`
        INSERT INTO odoo_defaults (odoo_target, folder_id, parent_article_id) VALUES (?, ?, ?)
        ON CONFLICT (odoo_target) DO UPDATE SET
            folder_id = COALESCE(excluded.folder_id, odoo_defaults.folder_id),
            parent_article_id = COALESCE(excluded.parent_article_id, odoo_defaults.parent_article_id)
    `).run(odooTarget, folderId ?? null, parentArticleId ?? null);
}
