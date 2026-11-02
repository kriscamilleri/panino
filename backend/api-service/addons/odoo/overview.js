/**
 * The Odoo overview (docs/specs/proposed/odoo-overview.md): every Document with a
 * record in Odoo, per database, with the state the overview page sorts and filters
 * by. Read-only; the route gathers the caller's databases and calls this per database.
 */

import crypto from 'node:crypto';
import { listSyncs } from './sync.js';

/** The states, most urgent first; a Document with several records takes the first that applies. */
export const OVERVIEW_STATES = Object.freeze([
    'sync_failed', 'sync_paused', 'changed', 'synced', 'current', 'deleted', 'other_odoo',
]);
/** States that put a Document under "Needs attention". */
export const ATTENTION_STATES = Object.freeze(['sync_failed', 'sync_paused', 'changed']);

/**
 * What a manual send stores in `odoo_links.sent_hash`: the Document's title and
 * content as the server holds them.
 *
 * @param {{ title?: string|null, content?: string|null }} note
 * @returns {string}
 */
export function sentHashOf(note) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([note?.title ?? '', note?.content ?? '']))
        .digest('hex');
}

/**
 * Record what a manual send sent, on that destination's link.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ noteId: string, destination: 'documents'|'knowledge', odooTarget: string, hash: string }} input
 */
export function stampSentHash(db, { noteId, destination, odooTarget, hash }) {
    db.prepare(`
        UPDATE odoo_links SET sent_hash = ?
         WHERE source_id = ? AND destination = ? AND odoo_target = ? AND target_key = ''
    `).run(hash, noteId, destination, odooTarget);
}

const CHATTER_LABELS = Object.freeze({ 'crm.lead': 'Opportunity', 'sale.order': 'Sales order' });

/** @returns {string} what the Open menu calls a record */
function recordLabel(link) {
    if (link.destination === 'documents') return 'Documents PDF';
    if (link.destination === 'knowledge') return 'Knowledge article';
    const [model, id] = String(link.target_key || '').split(':');
    return `Internal note on ${CHATTER_LABELS[model] || 'record'} #${id || '?'}`;
}

/** Whether a manual Documents or Knowledge link is behind its Document. */
function linkChanged(link, note, hash) {
    if (link.sent_hash) return link.sent_hash !== hash;
    // Sent before sent_hash existed: the edit time is the best there is.
    return Boolean(note.updated_at && link.last_sent_at && note.updated_at > link.last_sent_at);
}

function parseResult(sync) {
    try {
        return sync.last_result ? JSON.parse(sync.last_result) : null;
    } catch {
        return null;
    }
}

/**
 * One database's part of the overview.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} input
 * @param {string} input.dbKey
 * @param {string|null} input.odooTarget the caller's Odoo, or null when not connected
 * @param {boolean} input.canEdit owner of `user:`; owner or editor of a space
 * @param {(code: string) => string} input.failureMessage the fixed message for a failure code
 * @returns {object[]} documents, unsorted
 */
export function overviewDocuments(db, { dbKey, odooTarget, canEdit, failureMessage }) {
    const rows = db.prepare(`
        SELECT l.*, n.id AS note_id, n.title AS note_title, n.content AS note_content, n.updated_at AS note_updated_at
          FROM odoo_links l
          LEFT JOIN notes n ON n.id = l.source_id
         WHERE l.source_type = 'note'
    `).all();
    if (rows.length === 0) return [];

    const syncs = new Map(listSyncs(db).map((sync) => [sync.id, { sync, result: parseResult(sync) }]));
    const failures = new Map();
    for (const { sync, result } of syncs.values()) {
        for (const failure of result?.failures || []) {
            if (failure?.sourceId && !failures.has(failure.sourceId)) failures.set(failure.sourceId, { ...failure, syncId: sync.id });
        }
    }

    const bySource = new Map();
    for (const row of rows) {
        if (!bySource.has(row.source_id)) bySource.set(row.source_id, []);
        bySource.get(row.source_id).push(row);
    }

    const documents = [];
    for (const [noteId, links] of bySource) {
        const first = links[0];
        const present = Boolean(first.note_id);
        const note = present ? { title: first.note_title, content: first.note_content, updated_at: first.note_updated_at } : null;
        const hash = present ? sentHashOf(note) : null;
        const same = links.filter((link) => odooTarget && link.odoo_target === odooTarget);
        const latest = links.reduce((a, b) => (String(b.last_sent_at) > String(a.last_sent_at) ? b : a));

        const states = new Set();
        let failure = null;
        if (!present) states.add('deleted');
        else if (same.length === 0) states.add('other_odoo');
        else {
            for (const link of same) {
                const owner = link.sync_id ? syncs.get(link.sync_id) : null;
                if (owner) {
                    states.add(owner.sync.status === 'paused' ? 'sync_paused' : 'synced');
                } else if (link.destination !== 'chatter' && linkChanged(link, note, hash)) {
                    states.add('changed');
                } else {
                    states.add('current');
                }
            }
            const failed = failures.get(noteId);
            if (failed && same.some((link) => link.sync_id === failed.syncId)) {
                states.add('sync_failed');
                failure = { error: failed.error, message: failureMessage(failed.error) };
            }
        }
        const state = OVERVIEW_STATES.find((candidate) => states.has(candidate));
        const resendable = same.some((link) => link.destination !== 'chatter' && !link.sync_id);

        documents.push({
            dbKey,
            noteId,
            title: present ? (note.title || 'Untitled') : null,
            state,
            canSend: Boolean(canEdit && present && odooTarget && resendable),
            lastSentAt: latest.last_sent_at,
            lastSentById: latest.last_sent_by,
            records: links.map((link) => ({
                destination: link.destination,
                key: link.destination === 'chatter' ? link.target_key : link.destination,
                label: recordLabel(link),
                sameOdoo: Boolean(odooTarget && link.odoo_target === odooTarget),
                urlPath: link.odoo_url_path || null,
                odooTarget: link.odoo_target,
                syncId: link.sync_id || null,
            })),
            failure,
        });
    }
    return documents;
}

/** Sort for the overview: needs attention first, by urgency then oldest send; the rest newest first. */
export function sortOverview(documents) {
    const rank = (doc) => {
        const index = ATTENTION_STATES.indexOf(doc.state);
        return index === -1 ? ATTENTION_STATES.length : index;
    };
    return [...documents].sort((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        if (ATTENTION_STATES.includes(a.state)) return String(a.lastSentAt).localeCompare(String(b.lastSentAt));
        return String(b.lastSentAt).localeCompare(String(a.lastSentAt));
    });
}
