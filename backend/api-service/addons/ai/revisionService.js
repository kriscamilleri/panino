// The v1 revision operations, without HTTP (docs/specs/proposed/ai-api-expansion.md
// §4.4): list, read, compare, save a checkpoint and restore. REST and MCP
// (api/revisions.js) are two adapters over these functions; the shared rules are in
// serviceCore.js, and the restore itself is core's restoreNoteRevision, which the
// app's restore route uses too.
import { createHash } from 'crypto';
import { getAuthDb } from '../../db.js';
import {
    createRevisionSnapshot,
    decodeRevisionContent,
    restoreNoteRevision,
    RevisionRestoreError,
} from '../../revision.js';
import { resolveSpaceAccess } from '../../spaces.js';
import { buildFolderIndex, parseLimit } from './keyUtils.js';
import { DiffTooLargeError, MAX_CONTEXT, MAX_DIFF_LINES, MAX_EDIT_DISTANCE, unifiedLineDiff } from './lineDiff.js';
import {
    ApiError,
    announce,
    assertExpected,
    assertNoLiveSession,
    fullDocument,
    locateDocument,
    notFound,
    readFolders,
    readNote,
    requireAgentScope,
    writableDb,
} from './serviceCore.js';

export const REVISION_PAGE_DEFAULT = 20;
export const REVISION_PAGE_MAX = 100;

export const revisionNotFound = () => new ApiError(404, 'REVISION_NOT_FOUND', 'Revision not found for this Document.');
const revisionCorrupt = () => new ApiError(422, 'REVISION_CORRUPT', 'This revision\'s stored text cannot be read.');

/* ------------------------------------------------------------------ *
 * Who made a revision
 * ------------------------------------------------------------------ */

/**
 * Names of the actors on a page of revisions, resolved only for the account
 * owner and, in a space, its current members. One auth-DB query per page.
 */
function actorNames(ctx, target, rows) {
    const ids = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))];
    const allowed = ids.filter((id) => id === ctx.userId
        || (target.kind === 'space' && resolveSpaceAccess(target.spaceId, id)));
    if (!allowed.length) return new Map();
    const users = getAuthDb()
        .prepare('SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(allowed));
    return new Map(users.map((user) => [user.id, user.name || null]));
}

/**
 * `who` of a revision row: a kind, the key's or app's label, the user when
 * known, and a sentence in the app's wording ("by Kris via Claude (API key)").
 */
export function describeActor(row, names) {
    const known = row.actor_user_id && names.has(row.actor_user_id);
    const userId = known ? row.actor_user_id : null;
    const userName = known ? names.get(row.actor_user_id) || null : null;
    const label = row.actor_label || null;
    const by = userName ? `by ${userName}` : null;
    const raw = row.actor_kind || null;
    let kind;
    let text;
    if (raw === 'api' || raw === 'app') {
        kind = raw;
        const via = !label ? 'via API' : raw === 'app' ? `via ${label} (connected app)` : `via ${label} (API key)`;
        text = by ? `${by} ${via}` : via;
    } else if (raw === 'sync') {
        kind = 'sync';
        text = `${by || 'by a former member'} (synced from a device)`;
    } else if (raw === 'collab') {
        kind = 'collab';
        text = `${by || 'by a former member'} (live session)`;
    } else if (row.actor_user_id) {
        // 'system' with a user is an action in the app: a saved version, a restore, a move.
        kind = 'user';
        text = by || 'by a former member';
    } else if (raw === 'system') {
        kind = 'system';
        text = 'by Panino';
    } else {
        kind = 'unknown';
        text = 'author not recorded';
    }
    return { kind, label, userId, userName, text };
}

function revisionSummary(row, names) {
    return {
        id: row.id,
        type: row.type,
        createdAt: row.created_at,
        title: row.title ?? null,
        size: row.uncompressed_bytes ?? null,
        who: describeActor(row, names),
    };
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

// Newest first. Ties on created_at (a before- and after-snapshot written in the
// same millisecond) fall back to insertion order, newest first.
const SUMMARY_COLUMNS = `rowid AS seq, id, note_id, title, type, created_at, uncompressed_bytes,
                         actor_user_id, actor_kind, actor_label`;

function encodeRevisionCursor(row) {
    return Buffer.from(JSON.stringify([row.created_at, row.seq]), 'utf8').toString('base64url');
}

function decodeRevisionCursor(value) {
    try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === 'string' && Number.isInteger(decoded[1])) {
            return { createdAt: decoded[0], seq: decoded[1] };
        }
    } catch {
        // fall through
    }
    return null;
}

function readRevision(db, noteId, revisionId) {
    if (typeof revisionId !== 'string' || !revisionId || revisionId.length > 200) return null;
    return db.prepare(`SELECT ${SUMMARY_COLUMNS}, content_gzip FROM note_revisions WHERE note_id = ? AND id = ?`)
        .get(noteId, revisionId) || null;
}

function revisionBody(row) {
    try {
        return decodeRevisionContent(row.content_gzip);
    } catch {
        throw revisionCorrupt();
    }
}

function documentRef(note, target) {
    return { id: note.id, title: note.title, space: target.spaceId, updatedAt: note.updated_at };
}

function sliceLines(content, startLine, endLine) {
    if (startLine === undefined && endLine === undefined) return null;
    const lines = content.split('\n');
    const total = lines.length;
    const from = startLine ?? 1;
    const to = Math.min(endLine ?? total, total);
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < from) {
        throw new ApiError(400, 'INVALID_INPUT', 'start_line and end_line must be whole numbers from 1, with end_line not before start_line.');
    }
    return { startLine: from, endLine: to, lineCount: total, content: lines.slice(from - 1, to).join('\n') };
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/** A Document's revisions, newest first, paged by `cursor` or by `before` (a time). */
export function listRevisions(ctx, { id, space, limit, cursor, before } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, note } = locateDocument(ctx, space, id);
    const max = parseLimit(limit, REVISION_PAGE_DEFAULT, REVISION_PAGE_MAX);
    let position = null;
    if (cursor !== undefined && cursor !== null && cursor !== '') {
        position = typeof cursor === 'string' ? decodeRevisionCursor(cursor) : null;
        if (!position) throw new ApiError(400, 'INVALID_INPUT', 'The cursor is not valid.');
    }
    let beforeTime = null;
    if (!position && before !== undefined && before !== null && before !== '') {
        if (typeof before !== 'string' || Number.isNaN(Date.parse(before))) {
            throw new ApiError(400, 'INVALID_INPUT', 'before must be an ISO 8601 time.');
        }
        beforeTime = new Date(before).toISOString();
    }

    const rows = target.db.prepare(`
        SELECT ${SUMMARY_COLUMNS} FROM note_revisions
         WHERE note_id = ?
           AND (? IS NULL OR created_at < ?)
           AND (? IS NULL OR created_at < ? OR (created_at = ? AND rowid < ?))
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?
    `).all(
        note.id,
        beforeTime, beforeTime,
        position ? 1 : null, position?.createdAt ?? '', position?.createdAt ?? '', position?.seq ?? 0,
        max + 1,
    );
    const page = rows.slice(0, max);
    const names = actorNames(ctx, target, page);
    const total = target.db.prepare('SELECT COUNT(*) AS n FROM note_revisions WHERE note_id = ?').get(note.id).n;
    return {
        document: documentRef(note, target),
        revisions: page.map((row) => revisionSummary(row, names)),
        total,
        nextCursor: rows.length > max ? encodeRevisionCursor(page[page.length - 1]) : null,
    };
}

/** One revision with its body (or a range of its lines). */
export function getRevision(ctx, { id, space, revisionId, startLine, endLine } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, note } = locateDocument(ctx, space, id);
    const row = readRevision(target.db, note.id, revisionId);
    if (!row) throw revisionNotFound();
    const content = revisionBody(row);
    const range = sliceLines(content, startLine, endLine);
    return {
        document: documentRef(note, target),
        revision: {
            ...revisionSummary(row, actorNames(ctx, target, [row])),
            content: range ? range.content : content,
            ...(range ? { startLine: range.startLine, endLine: range.endLine, lineCount: range.lineCount } : {}),
        },
    };
}

/**
 * A unified line diff from one revision to the current body (`against`
 * 'current', the default) or to another revision of the same Document.
 */
export function compareRevisions(ctx, { id, space, revisionId, against, context } = {}) {
    requireAgentScope(ctx, 'read');
    if (context !== undefined && (!Number.isInteger(context) || context < 0 || context > MAX_CONTEXT)) {
        throw new ApiError(400, 'INVALID_INPUT', `context must be a whole number from 0 to ${MAX_CONTEXT}.`);
    }
    const { target, note } = locateDocument(ctx, space, id);
    const fromRow = readRevision(target.db, note.id, revisionId);
    if (!fromRow) throw revisionNotFound();
    const toCurrent = against === undefined || against === null || against === '' || against === 'current';
    const toRow = toCurrent ? null : readRevision(target.db, note.id, against);
    if (!toCurrent && !toRow) throw revisionNotFound();

    const names = actorNames(ctx, target, toRow ? [fromRow, toRow] : [fromRow]);
    const from = { ...revisionSummary(fromRow, names), content: revisionBody(fromRow) };
    const to = toRow
        ? { ...revisionSummary(toRow, names), content: revisionBody(toRow) }
        : { id: 'current', type: 'current', createdAt: note.updated_at, title: note.title, content: note.content ?? '' };

    let result;
    try {
        result = unifiedLineDiff(from.content, to.content, {
            context,
            fromLabel: `revision ${from.id} (${from.createdAt})`,
            toLabel: toRow ? `revision ${to.id} (${to.createdAt})` : `current (updated ${note.updated_at})`,
        });
    } catch (error) {
        if (error instanceof DiffTooLargeError) {
            throw new ApiError(422, 'DIFF_TOO_LARGE',
                `These versions are too far apart to compare (at most ${MAX_DIFF_LINES} lines each and ${MAX_EDIT_DISTANCE} changed lines).`);
        }
        throw error;
    }
    const strip = ({ content: _content, ...rest }) => rest;
    return {
        document: documentRef(note, target),
        from: strip(from),
        to: strip(to),
        titleChanged: (from.title ?? null) !== (to.title ?? null),
        identical: result.identical && (from.title ?? null) === (to.title ?? null),
        added: result.added,
        removed: result.removed,
        hunks: result.hunks,
        diff: result.diff,
        truncated: result.truncated,
    };
}

function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A manual checkpoint of the current title and body, attributed to the key or app. */
export function saveRevision(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, 'save-revision');
    const outcome = db.transaction(() => {
        const note = readNote(db, id);
        if (!note) throw notFound();
        // In a live session the stored body lags the session's, so a checkpoint would be stale.
        assertNoLiveSession(db, target, note.id);
        const content = note.content ?? '';
        const title = note.title ?? null;
        // The newest revision by insertion order (core's own check orders by
        // the second, so it can miss an after-snapshot written in the same one).
        const latest = db.prepare(`
            SELECT ${SUMMARY_COLUMNS}, content_sha256 FROM note_revisions
             WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(note.id);
        if (latest && latest.content_sha256 === sha256(content) && (latest.title ?? null) === title) {
            return { note, created: false, row: latest };
        }
        const made = createRevisionSnapshot(db, {
            noteId: note.id, title, content, type: 'manual',
            skipDuplicateCheck: true, enforceAutoThrottle: false, runPruneGate: true,
            actorUserId: ctx.userId,
            actorKind: ctx.agent.kind === 'app' ? 'app' : 'api',
            actorLabel: ctx.agent.name,
        });
        return { note, created: true, row: readRevision(db, note.id, made.revisionId) };
    })();
    if (outcome.created) announce(ctx, target);
    const names = actorNames(ctx, target, [outcome.row]);
    return {
        document: documentRef(outcome.note, target),
        created: outcome.created,
        ...(outcome.created ? {} : { reason: 'duplicate-latest' }),
        revision: revisionSummary(outcome.row, names),
    };
}

/**
 * Restore a Document to a revision. The current title and body are saved first
 * as a `pre-restore` revision, so restoring that one undoes this; the restored
 * body is then recorded as a revision attributed to the key or app.
 */
export function restoreRevision(ctx, { id, space, revisionId, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateDocument(ctx, space, id);
    if (typeof revisionId !== 'string' || !revisionId || revisionId.length > 200) throw revisionNotFound();
    const db = writableDb(target, 'restore-revision');
    const result = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
        try {
            return restoreNoteRevision(db, {
                noteId: current.id,
                revisionId,
                // Unattributed, like every before-snapshot of an API write: who wrote that text is not known.
                preRestoreActor: {},
                afterActor: { userId: ctx.userId, kind: ctx.agent.kind === 'app' ? 'app' : 'api', label: ctx.agent.name },
            });
        } catch (error) {
            if (error instanceof RevisionRestoreError) {
                if (error.code === 'REVISION_NOT_FOUND') throw revisionNotFound();
                if (error.code === 'CORRUPT_REVISION') throw revisionCorrupt();
                if (error.code === 'NOTE_NOT_FOUND') throw notFound();
            }
            throw error;
        }
    })();
    announce(ctx, target);
    const row = readNote(db, id);
    return {
        document: fullDocument(row, target, buildFolderIndex(readFolders(db))),
        restoredFrom: revisionId,
        preRestoreRevisionId: result.preRestoreRevisionId,
        revisionId: result.afterRevisionId,
    };
}
