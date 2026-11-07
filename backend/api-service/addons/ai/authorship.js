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
    const rows = target.db.prepare(`
        SELECT note_id, actor_user_id, actor_kind, actor_label, created_at, first_rank, last_rank FROM (
            SELECT note_id, actor_user_id, actor_kind, actor_label, created_at,
                   ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY created_at ASC, rowid ASC) AS first_rank,
                   CASE WHEN actor_kind IS NULL AND actor_user_id IS NULL THEN NULL
                        ELSE ROW_NUMBER() OVER (
                            PARTITION BY note_id, (actor_kind IS NULL AND actor_user_id IS NULL)
                            ORDER BY created_at DESC, rowid DESC)
                   END AS last_rank
              FROM note_revisions
             WHERE note_id IN (SELECT value FROM json_each(?))
        )
         WHERE first_rank = 1 OR last_rank = 1
    `).all(JSON.stringify(ids));
    const names = actorNames(ctx, target, rows);
    const firsts = new Map();
    const lasts = new Map();
    for (const row of rows) {
        if (row.first_rank === 1) firsts.set(row.note_id, row);
        if (row.last_rank === 1) lasts.set(row.note_id, row);
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
