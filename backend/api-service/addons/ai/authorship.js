// Who created and who last changed a Document (docs/specs/proposed/ai-api-expansion.md
// §4.6). Documents have no author columns; revision history records who made each
// revision (actor_user_id, actor_kind, actor_label), so the oldest revision names the
// creator and the newest attributed one the last editor, in the wording of the app's
// history. The oldest revision may have been pruned, or a Document may predate
// revision history, so createdBy is the earliest recorded author. In the personal database only the owner can write, so the owner stands
// in when history says nothing.
import { getAuthDb } from '../../db.js';
import { actorNames, describeActor } from './revisionService.js';

const MAX_IDS = 5000;

function ownerActor(ctx) {
    const user = getAuthDb().prepare('SELECT name FROM users WHERE id = ?').get(ctx.userId);
    const name = user?.name || null;
    return { kind: 'user', label: null, userId: ctx.userId, userName: name, text: name ? `by ${name}` : 'by the account owner', inferred: true };
}

/**
 * @param {object} ctx operation context
 * @param {{ kind: string, db: import('better-sqlite3').Database }} target
 * @param {string[]} noteIds
 * @returns {Map<string, { createdBy: object|null, modifiedBy: object|null, modifiedByAt: string|null }>}
 */
export function documentAuthorship(ctx, target, noteIds) {
    const ids = [...new Set(noteIds)].slice(0, MAX_IDS);
    const result = new Map();
    if (!ids.length) return result;
    // Per Document, its oldest revision and its newest attributed one, each found by a seek
    // on idx_note_revisions_note_created: no sort of the whole history, which a window over
    // every revision of thousands of Documents needed.
    const rows = target.db.prepare(`
        WITH picks AS (
            SELECT j.value AS note_id,
                   (SELECT r.rowid FROM note_revisions r WHERE r.note_id = j.value
                     ORDER BY r.created_at ASC, r.rowid ASC LIMIT 1) AS first_row,
                   (SELECT r.rowid FROM note_revisions r WHERE r.note_id = j.value
                       AND (r.actor_kind IS NOT NULL OR r.actor_user_id IS NOT NULL)
                     ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS last_row
              FROM json_each(?) j
        )
        SELECT r.note_id, r.actor_user_id, r.actor_kind, r.actor_label, r.created_at,
               r.rowid = p.first_row AS is_first, r.rowid = p.last_row AS is_last
          FROM picks p JOIN note_revisions r ON r.rowid IN (p.first_row, p.last_row)
    `).all(JSON.stringify(ids));
    const names = actorNames(ctx, target, rows);
    const firsts = new Map();
    const lasts = new Map();
    for (const row of rows) {
        if (row.is_first) firsts.set(row.note_id, row);
        if (row.is_last) lasts.set(row.note_id, row);
    }
    const owner = target.kind === 'personal' ? ownerActor(ctx) : null;
    const attributed = (row) => row && (row.actor_kind || row.actor_user_id);
    for (const id of ids) {
        const first = firsts.get(id);
        const last = lasts.get(id);
        let createdBy = attributed(first) ? describeActor(first, names) : null;
        let modifiedBy = last ? describeActor(last, names) : null;
        if (target.kind === 'personal') {
            // A personal Document is only ever written by its owner, through the app,
            // a key or a connected app; history may just not say which.
            if (!createdBy) createdBy = owner;
            if (!modifiedBy) modifiedBy = owner;
        }
        result.set(id, {
            createdBy,
            modifiedBy,
            modifiedByAt: last?.created_at ?? null,
        });
    }
    return result;
}
