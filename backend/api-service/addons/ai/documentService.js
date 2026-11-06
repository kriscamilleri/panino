// The v1 Document operations, without HTTP (docs/specs/active/ai-integration.md §7).
// REST (restRoutes.js) and MCP (mcpTools.js) are two adapters over these
// functions, so every rule — scope, space reach, live sessions, Trash instead of
// delete, revisions, size — has one implementation. Writes are ordinary CRR
// writes on the server's replica; devices pick them up on their next sync.
//
// Every function takes a context `{ userId, agent, clients }`:
//   agent   { kind: 'key' | 'app', id, name, scope: 'read' | 'write',
//             spaceAccess: 'all' | 'personal', expiresAt }
//   clients the WebSocket client map, for poking devices after a write
// and throws ApiError for anything the caller should report.
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import { getAuthDb, getDb, getUserDb } from '../../db.js';
import { createRevisionSnapshot } from '../../revision.js';
import { isSharedSpacesEnabled, listSpacesForUser, resolveSpaceAccess } from '../../spaces.js';
import { pokePersonalClients, pokeSpaceSubscribers } from '../../websocket.js';
import { runAddonHooks } from '../registry.js';
import {
    buildFolderIndex,
    decodeDocumentCursor,
    encodeDocumentCursor,
    makeSnippet,
    parseLimit,
    scopeAllows,
    TRASH_FOLDER_NAME,
    validateName,
} from './keyUtils.js';

/** Largest Document body the API will write, in bytes (UTF-8). */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const TREE_DOCUMENT_CAP = 5000;

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

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Document not found.');
const spaceNotFound = () => new ApiError(404, 'SPACE_NOT_FOUND', 'Space not found.');

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

function personalTarget(userId) {
    return { kind: 'personal', dbKey: `user:${userId}`, spaceId: null, name: 'Personal', role: 'owner', db: getUserDb(userId) };
}

function isPersonal(space) {
    return space === undefined || space === null || space === '' || space === 'personal';
}

/**
 * One database by `space`: absent, '' or 'personal' is the personal database.
 * A space the agent may not reach is indistinguishable from a missing one.
 */
function resolveOne(ctx, space) {
    if (isPersonal(space)) return personalTarget(ctx.userId);
    if (typeof space !== 'string' || !validateUuid(space)) throw spaceNotFound();
    if (ctx.agent.spaceAccess !== 'all') throw spaceNotFound();
    const access = resolveSpaceAccess(space, ctx.userId);
    if (!access) throw spaceNotFound();
    const dbKey = `space:${access.spaceId}`;
    return { kind: 'space', dbKey, spaceId: access.spaceId, name: null, role: access.role, db: getDb(dbKey) };
}

/** Every database the agent can reach, personal first. Space databases open lazily. */
function reachableTargets(ctx) {
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
function resolveMany(ctx, space) {
    if (space === undefined || space === null || space === '' || space === 'all') return reachableTargets(ctx);
    return [resolveOne(ctx, space)];
}

/**
 * The database holding an existing Document. With `space` given it is that
 * database; without, the reachable databases are searched, so an agent can
 * address a Document by id alone.
 */
function locateDocument(ctx, space, noteId) {
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

function readNote(db, noteId) {
    return db.prepare(`
        SELECT id, title, content, folder_id, pinned, created_at, updated_at
          FROM notes WHERE id = ?
    `).get(noteId) || null;
}

function readFolders(db) {
    return db.prepare('SELECT id, name, parent_id, created_at FROM folders').all();
}

function documentSummary(row, target, folderIndex) {
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

function fullDocument(row, target, folderIndex) {
    return {
        ...documentSummary(row, target, folderIndex),
        content: row.content ?? '',
        pinned: Boolean(row.pinned),
        createdAt: row.created_at,
    };
}

/** Folder ids inside the database's Trash, for exclusion in SQL. */
function trashFolderIds(folders, folderIndex) {
    if (!folderIndex.trashFolderId) return [];
    return folders.filter((folder) => folderIndex.isInTrash(folder.id)).map((folder) => folder.id);
}

/* ------------------------------------------------------------------ *
 * Write rules
 * ------------------------------------------------------------------ */

function assertNoLiveSession(target, noteId) {
    if (target.kind !== 'space') return;
    const open = target.db.prepare('SELECT 1 FROM collab_sessions WHERE note_id = ?').get(noteId);
    if (open) {
        throw new ApiError(409, 'DOCUMENT_IN_LIVE_SESSION',
            'This Document is open in a live session. Try again after the session ends.');
    }
}

function assertExpected(note, expectedUpdatedAt) {
    if (expectedUpdatedAt === undefined || expectedUpdatedAt === null) return;
    if (typeof expectedUpdatedAt !== 'string' || note.updated_at !== expectedUpdatedAt) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The Document changed since you read it. Read it again and retry.',
            { currentUpdatedAt: note.updated_at });
    }
}

function assertBodySize(content) {
    if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
        throw new ApiError(413, 'DOCUMENT_TOO_LARGE', 'Documents written through the API can be at most 2 MiB.');
    }
}

function assertFolder(db, folderId, code = 'FOLDER_NOT_FOUND') {
    if (folderId === null) return;
    if (typeof folderId !== 'string' || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
        throw new ApiError(400, code, 'Folder not found in this database.');
    }
}

function requireName(value, label) {
    const result = validateName(value, label);
    if (!result.ok) throw new ApiError(400, 'INVALID_INPUT', result.error);
    return result.value;
}

function optionalText(value, label) {
    if (value !== undefined && typeof value !== 'string') throw new ApiError(400, 'INVALID_INPUT', `${label} must be text.`);
    return value;
}

/**
 * Record the stored body before an API write (unattributed: we do not know who
 * wrote it) and the body after (attributed to the owner and labelled with the
 * key's or app's name), so every change can be undone from revision history
 * and traced to the credential that made it.
 */
function snapshotBefore(db, note) {
    createRevisionSnapshot(db, {
        noteId: note.id, title: note.title, content: note.content ?? '', type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: false,
    });
}

function snapshotAfter(db, noteId, title, content, ctx) {
    createRevisionSnapshot(db, {
        noteId, title, content, type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: true,
        actorUserId: ctx.userId,
        actorKind: ctx.agent.kind === 'app' ? 'app' : 'api',
        actorLabel: ctx.agent.name,
    });
}

/** Tell devices, live subscribers and add-ons that a database changed. */
function announce(ctx, target) {
    if (ctx.clients) {
        if (target.kind === 'space') pokeSpaceSubscribers(ctx.clients, target.dbKey, null);
        else pokePersonalClients(ctx.clients, ctx.userId, null);
    }
    runAddonHooks('afterChangesApplied', target.dbKey);
}

/** Apply a change to an existing note's columns and return the stored row. */
function updateNote(db, noteId, changes) {
    const columns = Object.keys(changes);
    // Column names come from this module's fixed set, never from input.
    const allowed = new Set(['title', 'content', 'folder_id', 'pinned', 'updated_at']);
    for (const column of columns) if (!allowed.has(column)) throw new Error(`unexpected column ${column}`);
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE notes SET ${assignments} WHERE id = ?`).run(...columns.map((column) => changes[column]), noteId);
    return readNote(db, noteId);
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/** Who the credential belongs to, its access, and the databases it reaches. */
export function getAccount(ctx) {
    requireAgentScope(ctx, 'read');
    const user = getAuthDb().prepare('SELECT id, name, email FROM users WHERE id = ?').get(ctx.userId);
    const databases = reachableTargets(ctx).map((target) => ({
        id: target.spaceId ?? 'personal',
        kind: target.kind,
        name: target.name,
        role: target.role,
    }));
    const { kind, id, name, scope, spaceAccess, expiresAt } = ctx.agent;
    return { user, agent: { kind, id, name, scope, spaceAccess, expiresAt: expiresAt ?? null }, databases };
}

/** Shared spaces the agent can reach. */
export function listSpaces(ctx) {
    requireAgentScope(ctx, 'read');
    const spaces = reachableTargets(ctx)
        .filter((target) => target.kind === 'space')
        .map((target) => ({ id: target.spaceId, name: target.name, role: target.role }));
    return { spaces };
}

/** Folders and Document titles of one database, no bodies. */
export function getTree(ctx, { space } = {}) {
    requireAgentScope(ctx, 'read');
    const target = resolveOne(ctx, space);
    const folders = readFolders(target.db);
    const documents = target.db.prepare(`
        SELECT id, title, folder_id, updated_at FROM notes
         ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?
    `).all(TREE_DOCUMENT_CAP + 1);
    const truncated = documents.length > TREE_DOCUMENT_CAP;
    return {
        space: target.spaceId,
        folders: folders
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_id ?? null })),
        documents: documents.slice(0, TREE_DOCUMENT_CAP).map((row) => ({
            id: row.id, title: row.title, folderId: row.folder_id ?? null, updatedAt: row.updated_at,
        })),
        truncated,
    };
}

/** Case-insensitive search of titles and bodies across databases; title matches first. */
export function searchDocuments(ctx, { query, space, limit, includeTrash = false } = {}) {
    requireAgentScope(ctx, 'read');
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length < 2 || q.length > 200) {
        throw new ApiError(400, 'INVALID_INPUT', 'The search text must be 2 to 200 characters.');
    }
    const max = parseLimit(limit, 20, 100);
    const hits = [];
    for (const target of resolveMany(ctx, space)) {
        const db = target.db;
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const excluded = includeTrash ? [] : trashFolderIds(folders, folderIndex);
        const rows = db.prepare(`
            SELECT id, title, folder_id, updated_at, content,
                   CASE WHEN instr(lower(coalesce(title, '')), lower(?)) > 0 THEN 1 ELSE 0 END AS title_hit
              FROM notes
             WHERE (instr(lower(coalesce(title, '')), lower(?)) > 0
                    OR instr(lower(coalesce(content, '')), lower(?)) > 0)
               AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
             ORDER BY title_hit DESC, updated_at DESC, id DESC
             LIMIT ?
        `).all(q, q, q, JSON.stringify(excluded), max);
        for (const row of rows) {
            hits.push({
                ...documentSummary(row, target, folderIndex),
                spaceName: target.name,
                matchedTitle: row.title_hit === 1,
                snippet: makeSnippet(row.content, q),
            });
        }
    }
    hits.sort((a, b) => Number(b.matchedTitle) - Number(a.matchedTitle)
        || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { query: q, results: hits.slice(0, max) };
}

/** Documents, most recently updated first (metadata only), with cursor paging. */
export function listDocuments(ctx, { space, folderId, limit, cursor, includeTrash = false } = {}) {
    requireAgentScope(ctx, 'read');
    const max = parseLimit(limit, 50, 200);
    const position = cursor === undefined || cursor === null || cursor === '' ? null : decodeDocumentCursor(cursor);
    if (cursor && !position) throw new ApiError(400, 'INVALID_INPUT', 'The cursor is not valid.');
    const folder = typeof folderId === 'string' && folderId ? folderId : undefined;
    const withTrash = includeTrash || folder !== undefined;

    const items = [];
    for (const target of resolveMany(ctx, space)) {
        const db = target.db;
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const excluded = withTrash ? [] : trashFolderIds(folders, folderIndex);
        const rows = db.prepare(`
            SELECT id, title, folder_id, updated_at FROM notes
             WHERE (? IS NULL OR coalesce(updated_at, '') < ? OR (coalesce(updated_at, '') = ? AND id < ?))
               AND (? IS NULL OR (CASE WHEN ? = 'root' THEN folder_id IS NULL ELSE folder_id = ? END))
               AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
             ORDER BY coalesce(updated_at, '') DESC, id DESC
             LIMIT ?
        `).all(
            position ? 1 : null, position?.updatedAt ?? '', position?.updatedAt ?? '', position?.id ?? '',
            folder ?? null, folder ?? null, folder ?? null,
            JSON.stringify(excluded), max + 1,
        );
        for (const row of rows) items.push({ row, summary: documentSummary(row, target, folderIndex) });
    }
    items.sort((a, b) => String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || ''))
        || (a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0));
    const page = items.slice(0, max);
    return {
        documents: page.map((item) => item.summary),
        nextCursor: items.length > max ? encodeDocumentCursor(page[page.length - 1].row) : null,
    };
}

/** One Document with its Markdown body. */
export function getDocument(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, note } = locateDocument(ctx, space, id);
    return { document: fullDocument(note, target, buildFolderIndex(readFolders(target.db))) };
}

/** Create a Document; the body defaults to a heading with the title. */
export function createDocument(ctx, { space, title, content, folderId } = {}) {
    requireAgentScope(ctx, 'write');
    const target = resolveOne(ctx, space);
    const name = requireName(title, 'title');
    const body = optionalText(content, 'content') ?? `# ${name}\n\n`;
    assertBodySize(body);
    const folder = folderId === undefined || folderId === '' || folderId === 'root' ? null : folderId;

    const db = target.db;
    const id = uuidv4();
    const now = new Date().toISOString();
    const created = db.transaction(() => {
        assertFolder(db, folder);
        if (target.kind === 'personal') {
            db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.userId, folder, name, body, now, now);
        } else {
            db.prepare(`INSERT INTO notes (id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)`).run(id, folder, name, body, now, now);
        }
        snapshotAfter(db, id, name, body, ctx);
        return readNote(db, id);
    })();
    announce(ctx, target);
    return { document: fullDocument(created, target, buildFolderIndex(readFolders(db))) };
}

/** Change title, body, folder or pin. */
export function updateDocument(ctx, { id, space, title, content, folderId, pinned, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    const changes = {};
    if (title !== undefined) changes.title = requireName(title, 'title');
    if (content !== undefined) {
        optionalText(content, 'content');
        assertBodySize(content);
        changes.content = content;
    }
    if (folderId !== undefined) changes.folder_id = folderId === 'root' || folderId === '' ? null : folderId;
    if (pinned !== undefined) {
        if (typeof pinned !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'pinned must be true or false.');
        changes.pinned = pinned ? 1 : 0;
    }
    if (Object.keys(changes).length === 0) {
        throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Send at least one of title, content, folderId or pinned.');
    }

    const { target } = locateDocument(ctx, space, id);
    const db = target.db;
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(target, current.id);
        if (changes.folder_id !== undefined) assertFolder(db, changes.folder_id);
        const textChanges = changes.title !== undefined || changes.content !== undefined;
        if (textChanges) snapshotBefore(db, current);
        const row = updateNote(db, current.id, { ...changes, updated_at: new Date().toISOString() });
        if (textChanges) snapshotAfter(db, row.id, row.title, row.content ?? '', ctx);
        return row;
    })();
    announce(ctx, target);
    return { document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) };
}

/** Append Markdown to the end of a Document (a blank line apart by default). */
export function appendToDocument(ctx, { id, space, content, separator, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    if (typeof content !== 'string' || !content) {
        throw new ApiError(400, 'INVALID_INPUT', 'content must be non-empty text.');
    }
    if (separator !== undefined && (typeof separator !== 'string' || separator.length > 100)) {
        throw new ApiError(400, 'INVALID_INPUT', 'separator must be text of at most 100 characters.');
    }

    const { target } = locateDocument(ctx, space, id);
    const db = target.db;
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(target, current.id);
        const existing = current.content ?? '';
        let next;
        if (!existing.trim()) next = content;
        else if (separator !== undefined) next = existing + separator + content;
        else next = `${existing.replace(/\s+$/, '')}\n\n${content}`;
        assertBodySize(next);
        snapshotBefore(db, current);
        const row = updateNote(db, current.id, { content: next, updated_at: new Date().toISOString() });
        snapshotAfter(db, row.id, row.title, row.content ?? '', ctx);
        return row;
    })();
    announce(ctx, target);
    return { document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) };
}

/** Move a Document into the database's Trash folder (created on first use). Nothing is deleted. */
export function trashDocument(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateDocument(ctx, space, id);
    const db = target.db;
    const result = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertNoLiveSession(target, current.id);
        const folderIndex = buildFolderIndex(readFolders(db));
        if (folderIndex.isInTrash(current.folder_id)) {
            return { row: current, previousFolderId: current.folder_id ?? null, alreadyInTrash: true };
        }
        let trashId = folderIndex.trashFolderId;
        if (!trashId) {
            trashId = uuidv4();
            const now = new Date().toISOString();
            if (target.kind === 'personal') {
                db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)')
                    .run(trashId, ctx.userId, TRASH_FOLDER_NAME, now);
            } else {
                db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)')
                    .run(trashId, TRASH_FOLDER_NAME, now);
            }
        }
        const row = updateNote(db, current.id, { folder_id: trashId, updated_at: new Date().toISOString() });
        return { row, previousFolderId: current.folder_id ?? null, alreadyInTrash: false };
    })();
    if (!result.alreadyInTrash) announce(ctx, target);
    return {
        document: fullDocument(result.row, target, buildFolderIndex(readFolders(db))),
        previousFolderId: result.previousFolderId,
        alreadyInTrash: result.alreadyInTrash,
    };
}

/** Create a folder, at the top level or inside `parentId`. */
export function createFolder(ctx, { space, name, parentId } = {}) {
    requireAgentScope(ctx, 'write');
    const target = resolveOne(ctx, space);
    const folderName = requireName(name, 'folder name');
    const parent = parentId === undefined || parentId === '' || parentId === 'root' ? null : parentId;
    const db = target.db;
    const id = uuidv4();
    const now = new Date().toISOString();
    db.transaction(() => {
        assertFolder(db, parent, 'PARENT_NOT_FOUND');
        if (target.kind === 'personal') {
            db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id, ctx.userId, folderName, parent, now);
        } else {
            db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
                .run(id, folderName, parent, now);
        }
    })();
    announce(ctx, target);
    const folderIndex = buildFolderIndex(readFolders(db));
    return { folder: { id, name: folderName, parentId: parent, path: folderIndex.pathOf(id), space: target.spaceId } };
}
