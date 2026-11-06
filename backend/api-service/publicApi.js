// /backend/api-service/publicApi.js
// The v1 API: Document-shaped endpoints for LLMs and scripts, authenticated by
// personal API keys (docs/specs/active/llm-api.md §7). Writes are ordinary
// CRR writes on the server's replica; devices pick them up on their next sync.
import express from 'express';
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import { getAuthDb, getDb, getUserDb, isDatabaseBusyError, respondDatabaseBusy } from './db.js';
import { authenticateApiKey, requireScope } from './apiKeys.js';
import {
    buildFolderIndex,
    decodeDocumentCursor,
    encodeDocumentCursor,
    makeSnippet,
    parseLimit,
    TRASH_FOLDER_NAME,
    validateName,
} from './apiKeyUtils.js';
import { createRevisionSnapshot } from './revision.js';
import { isSharedSpacesEnabled, listSpacesForUser, resolveSpaceAccess } from './spaces.js';
import { pokePersonalClients, pokeSpaceSubscribers } from './websocket.js';
import { runAddonHooks } from './addons/registry.js';
import { buildOpenApiDocument, API_USAGE_NOTE } from './publicApiSpec.js';

export const publicApiRoutes = express.Router();

/** Largest Document body the API will write, in bytes (UTF-8). */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const TREE_DOCUMENT_CAP = 5000;

class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Document not found.');
const spaceNotFound = () => new ApiError(404, 'SPACE_NOT_FOUND', 'Space not found.');

/* ------------------------------------------------------------------ *
 * Databases a key can reach
 * ------------------------------------------------------------------ */

function personalTarget(userId) {
    return { kind: 'personal', dbKey: `user:${userId}`, spaceId: null, name: 'Personal', role: 'owner', db: getUserDb(userId) };
}

/**
 * One database by `space` parameter: absent, '' or 'personal' is the personal
 * database. A space the key may not reach is indistinguishable from a missing one.
 */
function resolveOne(req, space) {
    const userId = req.user.user_id;
    if (space === undefined || space === null || space === '' || space === 'personal') return personalTarget(userId);
    if (typeof space !== 'string' || !validateUuid(space)) throw spaceNotFound();
    if (req.apiKey.spaceAccess !== 'all') throw spaceNotFound();
    const access = resolveSpaceAccess(space, userId);
    if (!access) throw spaceNotFound();
    const dbKey = `space:${access.spaceId}`;
    return { kind: 'space', dbKey, spaceId: access.spaceId, name: null, role: access.role, db: getDb(dbKey) };
}

/** Every database the key can reach, personal first. Space dbs open lazily. */
function reachableTargets(req) {
    const userId = req.user.user_id;
    const targets = [personalTarget(userId)];
    if (req.apiKey.spaceAccess !== 'all' || !isSharedSpacesEnabled()) return targets;
    for (const space of listSpacesForUser(userId).spaces) {
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

/** `space=all` (or absent, where allowed) means every reachable database. */
function resolveMany(req, space) {
    if (space === undefined || space === '' || space === 'all') return reachableTargets(req);
    return [resolveOne(req, space)];
}

/**
 * The database holding an existing Document. With `space` given it is that
 * database; without, the reachable databases are searched, so an agent can
 * address a Document by id alone.
 */
function locateDocument(req, space, noteId) {
    if (typeof noteId !== 'string' || !noteId || noteId.length > 200) throw notFound();
    const candidates = space === undefined || space === '' ? reachableTargets(req) : [resolveOne(req, space)];
    for (const target of candidates) {
        const note = readNote(target.db, noteId);
        if (note) return { target, note };
    }
    throw notFound();
}

function spaceParam(req) {
    const fromQuery = req.query.space;
    if (fromQuery !== undefined) return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    return req.body && typeof req.body === 'object' ? req.body.space : undefined;
}

/* ------------------------------------------------------------------ *
 * Reads
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

function wantsTrash(req) {
    return req.query.includeTrash === 'true' || req.query.includeTrash === '1';
}

/* ------------------------------------------------------------------ *
 * Writes
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
        throw new ApiError(409, 'VERSION_CONFLICT', 'The Document changed since you read it. Read it again and retry.');
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

/**
 * Record the stored body before an API write (unattributed: we do not know who
 * wrote it) and the body after (kind 'api', attributed to the key owner and
 * labelled with the key's name), so every API change can be undone from
 * revision history and traced to the key that made it.
 */
function snapshotBefore(db, note) {
    createRevisionSnapshot(db, {
        noteId: note.id, title: note.title, content: note.content ?? '', type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: false,
    });
}

function snapshotAfter(db, noteId, title, content, apiRequest) {
    createRevisionSnapshot(db, {
        noteId, title, content, type: 'auto',
        skipDuplicateCheck: false, enforceAutoThrottle: false, runPruneGate: true,
        actorUserId: apiRequest.user.user_id, actorKind: 'api', actorLabel: apiRequest.apiKey.name,
    });
}

/** Tell devices, live subscribers and add-ons that a database changed. */
function announce(req, target) {
    if (target.kind === 'space') pokeSpaceSubscribers(req.clients, target.dbKey, null);
    else pokePersonalClients(req.clients, req.user.user_id, null);
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
 * Routes
 * ------------------------------------------------------------------ */

function handler(fn) {
    return (req, res) => {
        try {
            fn(req, res);
        } catch (error) {
            if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
            if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
            console.error('[v1]', req.method, req.route?.path, error?.code || error?.message || 'unknown error');
            return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
        }
    };
}

// Public: lets tools load the description before they hold a key.
publicApiRoutes.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiDocument());
});

publicApiRoutes.use(authenticateApiKey);

publicApiRoutes.get('/', requireScope('read'), handler((req, res) => {
    res.json({
        name: 'Panino API',
        version: 'v1',
        usage: API_USAGE_NOTE,
        openapi: 'openapi.json',
        routes: [
            'GET me', 'GET spaces', 'GET tree', 'GET search', 'GET documents', 'GET documents/{id}',
            'POST documents', 'PATCH documents/{id}', 'POST documents/{id}/append', 'DELETE documents/{id}',
            'POST folders',
        ],
    });
}));

publicApiRoutes.get('/me', requireScope('read'), handler((req, res) => {
    const user = getAuthDb().prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.user_id);
    const databases = reachableTargets(req).map((target) => ({
        id: target.spaceId ?? 'personal',
        kind: target.kind,
        name: target.name,
        role: target.role,
    }));
    res.json({
        user,
        key: {
            id: req.apiKey.id,
            name: req.apiKey.name,
            scope: req.apiKey.scope,
            spaceAccess: req.apiKey.spaceAccess,
            expiresAt: req.apiKey.expiresAt,
        },
        databases,
    });
}));

publicApiRoutes.get('/spaces', requireScope('read'), handler((req, res) => {
    const spaces = reachableTargets(req)
        .filter((target) => target.kind === 'space')
        .map((target) => ({ id: target.spaceId, name: target.name, role: target.role }));
    res.json({ spaces });
}));

publicApiRoutes.get('/tree', requireScope('read'), handler((req, res) => {
    const target = resolveOne(req, spaceParam(req));
    const folders = readFolders(target.db);
    const documents = target.db.prepare(`
        SELECT id, title, folder_id, updated_at FROM notes
         ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?
    `).all(TREE_DOCUMENT_CAP + 1);
    const truncated = documents.length > TREE_DOCUMENT_CAP;
    res.json({
        space: target.spaceId,
        folders: folders
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_id ?? null })),
        documents: documents.slice(0, TREE_DOCUMENT_CAP).map((row) => ({
            id: row.id, title: row.title, folderId: row.folder_id ?? null, updatedAt: row.updated_at,
        })),
        truncated,
    });
}));

publicApiRoutes.get('/search', requireScope('read'), handler((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 200) {
        throw new ApiError(400, 'INVALID_INPUT', 'The search text (q) must be 2 to 200 characters.');
    }
    const limit = parseLimit(req.query.limit, 20, 100);
    const includeTrash = wantsTrash(req);
    const hits = [];
    for (const target of resolveMany(req, spaceParam(req))) {
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
        `).all(q, q, q, JSON.stringify(excluded), limit);
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
    res.json({ query: q, results: hits.slice(0, limit) });
}));

publicApiRoutes.get('/documents', requireScope('read'), handler((req, res) => {
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = req.query.cursor === undefined ? null : decodeDocumentCursor(req.query.cursor);
    if (req.query.cursor !== undefined && !cursor) throw new ApiError(400, 'INVALID_INPUT', 'The cursor is not valid.');
    const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : undefined;
    const includeTrash = wantsTrash(req) || folderId !== undefined;
    const targets = resolveMany(req, spaceParam(req));

    const items = [];
    for (const target of targets) {
        const db = target.db;
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const excluded = includeTrash ? [] : trashFolderIds(folders, folderIndex);
        const rows = db.prepare(`
            SELECT id, title, folder_id, updated_at FROM notes
             WHERE (? IS NULL OR coalesce(updated_at, '') < ? OR (coalesce(updated_at, '') = ? AND id < ?))
               AND (? IS NULL OR (CASE WHEN ? = 'root' THEN folder_id IS NULL ELSE folder_id = ? END))
               AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
             ORDER BY coalesce(updated_at, '') DESC, id DESC
             LIMIT ?
        `).all(
            cursor ? 1 : null, cursor?.updatedAt ?? '', cursor?.updatedAt ?? '', cursor?.id ?? '',
            folderId ?? null, folderId ?? null, folderId ?? null,
            JSON.stringify(excluded), limit + 1,
        );
        for (const row of rows) items.push({ row, summary: documentSummary(row, target, folderIndex) });
    }
    items.sort((a, b) => String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || ''))
        || (a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0));
    const page = items.slice(0, limit);
    const hasMore = items.length > limit;
    res.json({
        documents: page.map((item) => item.summary),
        nextCursor: hasMore ? encodeDocumentCursor(page[page.length - 1].row) : null,
    });
}));

function sendDocument(req, res, target, note) {
    const folderIndex = buildFolderIndex(readFolders(target.db));
    const accept = String(req.headers.accept || '');
    const asMarkdown = req.query.format === 'markdown'
        || (req.query.format === undefined && accept.includes('text/markdown') && !accept.includes('application/json'));
    if (asMarkdown) {
        res.setHeader('X-Panino-Document-Id', note.id);
        res.setHeader('X-Panino-Title', encodeURIComponent(note.title ?? ''));
        res.setHeader('X-Panino-Updated-At', note.updated_at ?? '');
        res.setHeader('X-Panino-Folder-Path', encodeURIComponent(folderIndex.pathOf(note.folder_id)));
        if (target.spaceId) res.setHeader('X-Panino-Space', target.spaceId);
        res.type('text/markdown; charset=utf-8');
        return res.send(note.content ?? '');
    }
    return res.json({ document: fullDocument(note, target, folderIndex) });
}

publicApiRoutes.get('/documents/:id', requireScope('read'), handler((req, res) => {
    const { target, note } = locateDocument(req, spaceParam(req), req.params.id);
    sendDocument(req, res, target, note);
}));

publicApiRoutes.post('/documents', requireScope('write'), handler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const target = resolveOne(req, spaceParam(req));
    const title = requireName(body.title, 'title');
    if (body.content !== undefined && typeof body.content !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'content must be text.');
    const content = body.content ?? `# ${title}\n\n`;
    assertBodySize(content);
    const folderId = body.folderId ?? null;

    const db = target.db;
    const id = uuidv4();
    const now = new Date().toISOString();
    const created = db.transaction(() => {
        assertFolder(db, folderId);
        if (target.kind === 'personal') {
            db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.user_id, folderId, title, content, now, now);
        } else {
            db.prepare(`INSERT INTO notes (id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)`).run(id, folderId, title, content, now, now);
        }
        snapshotAfter(db, id, title, content, req);
        return readNote(db, id);
    })();
    announce(req, target);
    res.status(201).json({ document: fullDocument(created, target, buildFolderIndex(readFolders(db))) });
}));

publicApiRoutes.patch('/documents/:id', requireScope('write'), handler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const changes = {};
    if (body.title !== undefined) changes.title = requireName(body.title, 'title');
    if (body.content !== undefined) {
        if (typeof body.content !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'content must be text.');
        assertBodySize(body.content);
        changes.content = body.content;
    }
    if (body.folderId !== undefined) changes.folder_id = body.folderId;
    if (body.pinned !== undefined) {
        if (typeof body.pinned !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'pinned must be true or false.');
        changes.pinned = body.pinned ? 1 : 0;
    }
    if (Object.keys(changes).length === 0) {
        throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Send at least one of title, content, folderId or pinned.');
    }

    const { target } = locateDocument(req, spaceParam(req), req.params.id);
    const db = target.db;
    const updated = db.transaction(() => {
        const current = readNote(db, req.params.id);
        if (!current) throw notFound();
        assertExpected(current, body.expectedUpdatedAt);
        assertNoLiveSession(target, current.id);
        if (changes.folder_id !== undefined) assertFolder(db, changes.folder_id);
        const textChanges = changes.title !== undefined || changes.content !== undefined;
        if (textChanges) snapshotBefore(db, current);
        const row = updateNote(db, current.id, { ...changes, updated_at: new Date().toISOString() });
        if (textChanges) snapshotAfter(db, row.id, row.title, row.content ?? '', req);
        return row;
    })();
    announce(req, target);
    res.json({ document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) });
}));

publicApiRoutes.post('/documents/:id/append', requireScope('write'), handler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.content !== 'string' || !body.content) {
        throw new ApiError(400, 'INVALID_INPUT', 'content must be non-empty text.');
    }
    if (body.separator !== undefined && (typeof body.separator !== 'string' || body.separator.length > 100)) {
        throw new ApiError(400, 'INVALID_INPUT', 'separator must be text of at most 100 characters.');
    }

    const { target } = locateDocument(req, spaceParam(req), req.params.id);
    const db = target.db;
    const updated = db.transaction(() => {
        const current = readNote(db, req.params.id);
        if (!current) throw notFound();
        assertExpected(current, body.expectedUpdatedAt);
        assertNoLiveSession(target, current.id);
        const existing = current.content ?? '';
        let next;
        if (!existing.trim()) next = body.content;
        else if (body.separator !== undefined) next = existing + body.separator + body.content;
        else next = `${existing.replace(/\s+$/, '')}\n\n${body.content}`;
        assertBodySize(next);
        snapshotBefore(db, current);
        const row = updateNote(db, current.id, { content: next, updated_at: new Date().toISOString() });
        snapshotAfter(db, row.id, row.title, row.content ?? '', req);
        return row;
    })();
    announce(req, target);
    res.json({ document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) });
}));

publicApiRoutes.delete('/documents/:id', requireScope('write'), handler((req, res) => {
    const { target } = locateDocument(req, spaceParam(req), req.params.id);
    const db = target.db;
    const result = db.transaction(() => {
        const current = readNote(db, req.params.id);
        if (!current) throw notFound();
        assertNoLiveSession(target, current.id);
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        if (folderIndex.isInTrash(current.folder_id)) {
            return { row: current, previousFolderId: current.folder_id ?? null, alreadyInTrash: true };
        }
        let trashId = folderIndex.trashFolderId;
        if (!trashId) {
            trashId = uuidv4();
            const now = new Date().toISOString();
            if (target.kind === 'personal') {
                db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)')
                    .run(trashId, req.user.user_id, TRASH_FOLDER_NAME, now);
            } else {
                db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)')
                    .run(trashId, TRASH_FOLDER_NAME, now);
            }
        }
        const row = updateNote(db, current.id, { folder_id: trashId, updated_at: new Date().toISOString() });
        return { row, previousFolderId: current.folder_id ?? null, alreadyInTrash: false };
    })();
    if (!result.alreadyInTrash) announce(req, target);
    res.json({
        document: fullDocument(result.row, target, buildFolderIndex(readFolders(db))),
        previousFolderId: result.previousFolderId,
        alreadyInTrash: result.alreadyInTrash,
    });
}));

publicApiRoutes.post('/folders', requireScope('write'), handler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const target = resolveOne(req, spaceParam(req));
    const name = requireName(body.name, 'folder name');
    const parentId = body.parentId ?? null;
    const db = target.db;
    const id = uuidv4();
    const now = new Date().toISOString();
    db.transaction(() => {
        assertFolder(db, parentId, 'PARENT_NOT_FOUND');
        if (target.kind === 'personal') {
            db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id, req.user.user_id, name, parentId, now);
        } else {
            db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
                .run(id, name, parentId, now);
        }
    })();
    announce(req, target);
    const folderIndex = buildFolderIndex(readFolders(db));
    res.status(201).json({ folder: { id, name, parentId, path: folderIndex.pathOf(id), space: target.spaceId } });
}));

publicApiRoutes.use((req, res) => {
    res.status(404).json({ error: 'No such API route. See GET /v1 or /v1/openapi.json.', code: 'NO_ROUTE' });
});
