// Shared rules of the v1 operations (docs/specs/active/ai-integration.md §7): which
// databases an agent reaches, the row shapes, and the write rules (scope, live
// sessions, expected versions, size, revisions, announcing changes). The
// operations live in the *Service.js files; REST and MCP adapters live in api/.
// Writes are ordinary CRR writes on the server's replica; devices pick them up on
// their next sync.
//
// Every operation takes a context `{ userId, agent, clients }`:
//   agent   { kind: 'key' | 'app', id, name, scope: 'read' | 'write',
//             spaceAccess: 'all' | 'personal', expiresAt }
//   clients the WebSocket client map, for poking devices after a write
// and throws ApiError for anything the caller should report.
import { validate as validateUuid } from 'uuid';
import { getDb, getHealthyDb, getUserDb } from '../../db.js';
import { createRevisionSnapshot } from '../../revision.js';
import { isSharedSpacesEnabled, listSpacesForUser, resolveSpaceAccess } from '../../spaces.js';
import { pokePersonalClients, pokeSpaceSubscribers } from '../../websocket.js';
import { runAddonHooks } from '../registry.js';
import { scopeAllows, validateName } from './keyUtils.js';

/** Largest Document body the API will write, in bytes (UTF-8). */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const TREE_DOCUMENT_CAP = 5000;

export class ApiError extends Error {
    /**
     * @param {number} status HTTP status a REST caller answers with
     * @param {string} code closed error code
     * @param {string} message fixed, user-safe text
     * @param {object} [details] extra fields for the caller (never secrets)
     */
    constructor(status, code, message, details = undefined) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Document not found.');
export const spaceNotFound = () => new ApiError(404, 'SPACE_NOT_FOUND', 'Space not found.');

/**
 * @param {{ agent: { scope: string, kind: string } }} ctx
 * @param {'read'|'write'} scope
 */
export function requireAgentScope(ctx, scope) {
    if (scopeAllows(ctx.agent?.scope, scope)) return;
    const who = ctx.agent?.kind === 'app' ? 'This connected app has' : 'This API key has';
    throw new ApiError(403, 'INSUFFICIENT_SCOPE', `${who} read-only access.`);
}

/* ------------------------------------------------------------------ *
 * Databases an agent can reach
 * ------------------------------------------------------------------ */

export function personalTarget(userId) {
    return { kind: 'personal', dbKey: `user:${userId}`, spaceId: null, name: 'Personal', role: 'owner', db: getUserDb(userId) };
}

export function isPersonal(space) {
    return space === undefined || space === null || space === '' || space === 'personal';
}

/**
 * One database by `space`: absent, '' or 'personal' is the personal database.
 * A space the agent may not reach is indistinguishable from a missing one.
 */
export function resolveOne(ctx, space) {
    if (isPersonal(space)) return personalTarget(ctx.userId);
    if (typeof space !== 'string' || !validateUuid(space)) throw spaceNotFound();
    if (ctx.agent.spaceAccess !== 'all') throw spaceNotFound();
    const access = resolveSpaceAccess(space, ctx.userId);
    if (!access) throw spaceNotFound();
    const dbKey = `space:${access.spaceId}`;
    return { kind: 'space', dbKey, spaceId: access.spaceId, name: null, role: access.role, db: getDb(dbKey) };
}

/** Every database the agent can reach, personal first. Space databases open lazily. */
export function reachableTargets(ctx) {
    const targets = [personalTarget(ctx.userId)];
    if (ctx.agent.spaceAccess !== 'all' || !isSharedSpacesEnabled()) return targets;
    for (const space of listSpacesForUser(ctx.userId).spaces) {
        const dbKey = `space:${space.spaceId}`;
        targets.push({
            kind: 'space',
            dbKey,
            spaceId: space.spaceId,
            name: space.name,
            role: space.role,
            get db() { return getDb(dbKey); },
        });
    }
    return targets;
}

/** `space` 'all' (or absent) means every reachable database. */
export function resolveMany(ctx, space) {
    if (space === undefined || space === null || space === '' || space === 'all') return reachableTargets(ctx);
    return [resolveOne(ctx, space)];
}

/**
 * The database holding an existing Document. With `space` given it is that
 * database; without, the reachable databases are searched, so an agent can
 * address a Document by id alone.
 */
export function locateDocument(ctx, space, noteId) {
    if (typeof noteId !== 'string' || !noteId || noteId.length > 200) throw notFound();
    const candidates = space === undefined || space === null || space === '' ? reachableTargets(ctx) : [resolveOne(ctx, space)];
    for (const target of candidates) {
        const note = readNote(target.db, noteId);
        if (note) return { target, note };
    }
    throw notFound();
}

/* ------------------------------------------------------------------ *
 * Rows and shapes
 * ------------------------------------------------------------------ */

export function readNote(db, noteId) {
    return db.prepare(`
        SELECT id, title, content, folder_id, pinned, created_at, updated_at
          FROM notes WHERE id = ?
    `).get(noteId) || null;
}

export function readFolders(db) {
    return db.prepare('SELECT id, name, parent_id, created_at FROM folders').all();
}

export function documentSummary(row, target, folderIndex) {
    return {
        id: row.id,
        title: row.title,
        folderId: row.folder_id ?? null,
        folderPath: folderIndex.pathOf(row.folder_id),
        space: target.spaceId,
        updatedAt: row.updated_at,
        ...(folderIndex.isInTrash(row.folder_id) ? { inTrash: true } : {}),
    };
}

export function fullDocument(row, target, folderIndex) {
    return {
        ...documentSummary(row, target, folderIndex),
        content: row.content ?? '',
        pinned: Boolean(row.pinned),
        createdAt: row.created_at,
    };
}

/** Folder ids inside the database's Trash, for exclusion in SQL. */
export function trashFolderIds(folders, folderIndex) {
    if (!folderIndex.trashFolderId) return [];
    return folders.filter((folder) => folderIndex.isInTrash(folder.id)).map((folder) => folder.id);
}

/* ------------------------------------------------------------------ *
 * Write rules
 * ------------------------------------------------------------------ */

/**
 * The connection a write goes through. Writes change CRR tables, so they never
 * run on a cached handle whose CR-SQLite sync bit a failed merge left set: its
 * triggers would be suppressed and devices would never receive the change
 * (docs/architecture/crsqlite-sync.md, "The sync bit").
 */
export function writableDb(target, operation) {
    return getHealthyDb(target.dbKey, `ai-${operation}`);
}

export function assertNoLiveSession(db, target, noteId) {
    if (target.kind !== 'space') return;
    const open = db.prepare('SELECT 1 FROM collab_sessions WHERE note_id = ?').get(noteId);
    if (open) {
        throw new ApiError(409, 'DOCUMENT_IN_LIVE_SESSION',
            'This Document is open in a live session. Try again after the session ends.');
    }
}

export function assertExpected(note, expectedUpdatedAt) {
    if (expectedUpdatedAt === undefined || expectedUpdatedAt === null) return;
    if (typeof expectedUpdatedAt !== 'string' || note.updated_at !== expectedUpdatedAt) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The Document changed since you read it. Read it again and retry.',
            { currentUpdatedAt: note.updated_at });
    }
}

export function assertBodySize(content) {
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
        throw new ApiError(413, 'DOCUMENT_TOO_LARGE', 'Documents written through the API can be at most 2 MiB.');
    }
}

export function assertFolder(db, folderId, code = 'FOLDER_NOT_FOUND') {
    if (folderId === null) return;
    if (typeof folderId !== 'string' || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
        throw new ApiError(400, code, 'Folder not found in this database.');
    }
}

export function requireName(value, label) {
    const result = validateName(value, label);
    if (!result.ok) throw new ApiError(400, 'INVALID_INPUT', result.error);
    return result.value;
}

export function optionalText(value, label) {
    if (value !== undefined && typeof value !== 'string') throw new ApiError(400, 'INVALID_INPUT', `${label} must be text.`);
    return value;
}

/**
 * Record the stored body before an API write (unattributed: we do not know who
 * wrote it) and the body after (attributed to the owner and labelled with the
 * key's or app's name), so every change can be undone from revision history
 * and traced to the credential that made it.
 */
export function snapshotBefore(db, note) {
    createRevisionSnapshot(db, {
        noteId: note.id, title: note.title, content: note.content ?? '', type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: false,
    });
}

export function snapshotAfter(db, noteId, title, content, ctx) {
    createRevisionSnapshot(db, {
        noteId, title, content, type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: true,
        actorUserId: ctx.userId,
        actorKind: ctx.agent.kind === 'app' ? 'app' : 'api',
        actorLabel: ctx.agent.name,
    });
}

/** Tell devices, live subscribers and add-ons that a database changed. */
export function announce(ctx, target) {
    if (ctx.clients) {
        if (target.kind === 'space') pokeSpaceSubscribers(ctx.clients, target.dbKey, null);
        else pokePersonalClients(ctx.clients, ctx.userId, null);
    }
    runAddonHooks('afterChangesApplied', target.dbKey);
}

/** Apply a change to an existing note's columns and return the stored row. */
export function updateNote(db, noteId, changes) {
    const columns = Object.keys(changes);
    // Column names come from this module's fixed set, never from input.
    const allowed = new Set(['title', 'content', 'folder_id', 'pinned', 'updated_at']);
    for (const column of columns) if (!allowed.has(column)) throw new Error(`unexpected column ${column}`);
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE notes SET ${assignments} WHERE id = ?`).run(...columns.map((column) => changes[column]), noteId);
    return readNote(db, noteId);
}
