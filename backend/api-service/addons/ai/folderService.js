// Folder and Trash operations of the v1 API (docs/specs/active/ai-integration.md §7,
// docs/specs/proposed/ai-api-expansion.md §4.2). Nothing here deletes: "trash"
// moves into the database's Trash folder, and restore moves back out.
//
// Where something was before the API trashed it is kept in the server-only
// table ai_trash_origins (schema.js), so a restore can put it back. Items moved
// into Trash any other way (in the app) have no row and restore to the top level.
//
// Folder writes are CRR writes like Document writes: on writableDb, in one
// transaction, announced after. Moving a folder changes no Document row, so a
// live session on a Document inside it does not block the move.
import { v4 as uuidv4 } from 'uuid';
import {
    ApiError,
    announce,
    assertFolder,
    assertNoLiveSession,
    documentSummary,
    fullDocument,
    locateDocument,
    notFound,
    reachableTargets,
    readFolders,
    readNote,
    requireAgentScope,
    requireName,
    resolveMany,
    resolveOne,
    TREE_DOCUMENT_CAP,
    updateNote,
    writableDb,
} from './serviceCore.js';
import { buildFolderIndex, parseLimit, TRASH_FOLDER_NAME } from './keyUtils.js';

/** Documents get_folder lists by title; the counts cover all of them. */
export const FOLDER_DOCUMENT_CAP = 200;
/** Subfolders get_folder lists by name. */
export const FOLDER_SUBFOLDER_CAP = 500;

/** Why a restore put something where it did. */
export const RESTORE_REASONS = Object.freeze([
    'requested',
    'previous-location',
    'previous-location-missing',
    'previous-location-in-trash',
    'no-record',
]);

const folderNotFound = () => new ApiError(404, 'FOLDER_NOT_FOUND', 'Folder not found.');
const destinationNotFound = () => new ApiError(400, 'FOLDER_NOT_FOUND', 'Folder not found in this database.');
const itemNotFound = () => new ApiError(404, 'ITEM_NOT_FOUND', 'No Document or folder with that id.');
const trashProtected = () => new ApiError(400, 'TRASH_FOLDER_PROTECTED',
    'The Trash folder itself cannot be renamed, moved or moved to Trash.');
const trashNameReserved = () => new ApiError(400, 'TRASH_NAME_RESERVED',
    'A folder at the top level cannot be called Trash: that name marks the Trash folder.');
const notInTrash = () => new ApiError(409, 'NOT_IN_TRASH', 'That Document or folder is not in Trash.');
const destinationInTrash = () => new ApiError(400, 'DESTINATION_IN_TRASH', 'The destination folder is in Trash.');

const isAbsent = (value) => value === undefined || value === null || value === '';
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

/** The name the Trash folder is recognised by (keyUtils.findTrashFolderId). */
function isTrashName(name) {
    return String(name || '').trim().toLowerCase() === TRASH_FOLDER_NAME.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Rows and lookups
 * ------------------------------------------------------------------ */

function readFolder(db, folderId) {
    return db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE id = ?').get(folderId) || null;
}

/**
 * The database holding an existing folder: that of `space` when given, else
 * the first reachable database that has it (personal first).
 */
export function locateFolder(ctx, space, folderId) {
    if (!validId(folderId)) throw folderNotFound();
    const candidates = isAbsent(space) ? reachableTargets(ctx) : [resolveOne(ctx, space)];
    for (const target of candidates) {
        const folder = readFolder(target.db, folderId);
        if (folder) return { target, folder };
    }
    throw folderNotFound();
}

/** Folder rows by parent id ('root' for the top level). */
function childrenByParent(folders) {
    const children = new Map();
    for (const folder of folders) {
        const key = folder.parent_id ?? 'root';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(folder);
    }
    return children;
}

/** The folder and every folder below it. Corrupted cycles stop the walk. */
function subtreeIds(folderId, children) {
    const seen = new Set([folderId]);
    const queue = [folderId];
    while (queue.length) {
        for (const child of children.get(queue.shift()) || []) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            queue.push(child.id);
        }
    }
    return seen;
}

/** @returns {Map<string, number>} Documents directly in each of these folders */
function documentCountsByFolder(db, folderIds) {
    const rows = db.prepare(`
        SELECT folder_id, COUNT(*) AS count FROM notes
         WHERE folder_id IN (SELECT value FROM json_each(?))
         GROUP BY folder_id
    `).all(JSON.stringify([...folderIds]));
    return new Map(rows.map((row) => [row.folder_id, row.count]));
}

function sumCounts(ids, counts) {
    let total = 0;
    for (const id of ids) total += counts.get(id) || 0;
    return total;
}

/** True when `candidateId` is `folderId` or lies below it. */
function isSelfOrBelow(candidateId, folderId, byId) {
    const seen = new Set();
    let current = candidateId;
    while (current && !seen.has(current)) {
        if (current === folderId) return true;
        seen.add(current);
        current = byId.get(current)?.parent_id ?? null;
    }
    return false;
}

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || a.id.localeCompare(b.id);

export function folderShape(folder, target, folderIndex) {
    return {
        id: folder.id,
        name: folder.name,
        path: folderIndex.pathOf(folder.id),
        parentId: folder.parent_id ?? null,
        parentPath: folderIndex.pathOf(folder.parent_id ?? null),
        space: target.spaceId,
        createdAt: folder.created_at ?? null,
        inTrash: folderIndex.isInTrash(folder.id),
        ...(folder.id === folderIndex.trashFolderId ? { isTrash: true } : {}),
    };
}

/* ------------------------------------------------------------------ *
 * Trash bookkeeping
 * ------------------------------------------------------------------ */

/** The database's Trash folder id, creating it at the top level on first use. */
function ensureTrashFolder(db, target, ctx, folderIndex, now) {
    if (folderIndex.trashFolderId) return folderIndex.trashFolderId;
    const trashId = uuidv4();
    if (target.kind === 'personal') {
        db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)')
            .run(trashId, ctx.userId, TRASH_FOLDER_NAME, now);
    } else {
        db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)')
            .run(trashId, TRASH_FOLDER_NAME, now);
    }
    return trashId;
}

function recordOrigin(db, itemId, kind, previousParentId, now) {
    db.prepare(`
        INSERT INTO ai_trash_origins (item_id, item_kind, previous_parent_id, trashed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET item_kind = excluded.item_kind,
            previous_parent_id = excluded.previous_parent_id, trashed_at = excluded.trashed_at
    `).run(itemId, kind, previousParentId, now);
}

function forgetOrigin(db, itemId) {
    db.prepare('DELETE FROM ai_trash_origins WHERE item_id = ?').run(itemId);
}

/** @returns {Map<string, { item_id: string, item_kind: string, previous_parent_id: string|null, trashed_at: string }>} */
function readOrigins(db, itemIds) {
    if (itemIds.length === 0) return new Map();
    const rows = db.prepare(`
        SELECT item_id, item_kind, previous_parent_id, trashed_at FROM ai_trash_origins
         WHERE item_id IN (SELECT value FROM json_each(?))
    `).all(JSON.stringify(itemIds));
    return new Map(rows.map((row) => [row.item_id, row]));
}

/**
 * Where a restore without an explicit destination puts an item. The record is
 * only trusted while the item sits directly in Trash, where the API put it; an
 * item that was moved since (or is inside a trashed folder) goes to the top level.
 */
function recordedDestination(origin, kind, currentParentId, folderIndex, byId) {
    if (!origin || origin.item_kind !== kind || currentParentId !== folderIndex.trashFolderId) {
        return { folderId: null, reason: 'no-record' };
    }
    const previous = origin.previous_parent_id ?? null;
    if (previous === null) return { folderId: null, reason: 'previous-location' };
    if (!byId.has(previous)) return { folderId: null, reason: 'previous-location-missing' };
    if (folderIndex.isInTrash(previous)) return { folderId: null, reason: 'previous-location-in-trash' };
    return { folderId: previous, reason: 'previous-location' };
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/** Move a Document into the database's Trash folder (created on first use). Nothing is deleted. */
export function trashDocument(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, 'trash-document');
    const result = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertNoLiveSession(db, target, current.id);
        const folderIndex = buildFolderIndex(readFolders(db));
        if (folderIndex.isInTrash(current.folder_id)) {
            return { row: current, previousFolderId: current.folder_id ?? null, alreadyInTrash: true };
        }
        const now = new Date().toISOString();
        const trashId = ensureTrashFolder(db, target, ctx, folderIndex, now);
        const row = updateNote(db, current.id, { folder_id: trashId, updated_at: now });
        recordOrigin(db, current.id, 'document', current.folder_id ?? null, now);
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
    const db = writableDb(target, 'create-folder');
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

/** One folder: where it is, what is directly in it (no bodies), and counts. */
export function getFolder(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, folder } = locateFolder(ctx, space, id);
    const db = target.db;
    const folders = readFolders(db);
    const folderIndex = buildFolderIndex(folders);
    const children = childrenByParent(folders);
    const below = subtreeIds(folder.id, children);
    const counts = documentCountsByFolder(db, below);
    const direct = [...(children.get(folder.id) || [])].filter((child) => child.id !== folder.id).sort(byName);

    const rows = db.prepare(`
        SELECT id, title, folder_id, updated_at FROM notes WHERE folder_id = ?
         ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?
    `).all(folder.id, FOLDER_DOCUMENT_CAP + 1);

    return {
        folder: folderShape(folder, target, folderIndex),
        subfolders: direct.slice(0, FOLDER_SUBFOLDER_CAP).map((child) => {
            const subtree = subtreeIds(child.id, children);
            return {
                id: child.id,
                name: child.name,
                path: folderIndex.pathOf(child.id),
                documentCount: sumCounts(subtree, counts),
                subfolderCount: (children.get(child.id) || []).length,
            };
        }),
        subfoldersTruncated: direct.length > FOLDER_SUBFOLDER_CAP,
        documents: rows.slice(0, FOLDER_DOCUMENT_CAP).map((row) => documentSummary(row, target, folderIndex)),
        documentsTruncated: rows.length > FOLDER_DOCUMENT_CAP,
        counts: {
            documents: counts.get(folder.id) || 0,
            subfolders: direct.length,
            allDocuments: sumCounts(below, counts),
        },
    };
}

/**
 * Rename and/or move a folder. `parentId` null, '' or 'root' is the top level;
 * undefined leaves the parent alone. A move into the Trash folder itself counts
 * as trashing (its previous place is recorded); any other move forgets a record.
 */
export function updateFolder(ctx, { id, space, name, parentId } = {}) {
    requireAgentScope(ctx, 'write');
    const changes = {};
    if (name !== undefined) changes.name = requireName(name, 'folder name');
    if (parentId !== undefined) {
        if (parentId !== null && typeof parentId !== 'string') {
            throw new ApiError(400, 'INVALID_INPUT', 'parentId must be a folder id, "root" or null.');
        }
        changes.parentId = parentId === null || parentId === '' || parentId === 'root' ? null : parentId;
    }
    if (Object.keys(changes).length === 0) {
        throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Send name, parentId or both.');
    }

    const { target } = locateFolder(ctx, space, id);
    const db = writableDb(target, 'update-folder');
    const result = db.transaction(() => {
        const current = readFolder(db, id);
        if (!current) throw folderNotFound();
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        if (current.id === folderIndex.trashFolderId) throw trashProtected();
        const byId = new Map(folders.map((folder) => [folder.id, folder]));

        const currentParent = current.parent_id ?? null;
        const nextName = changes.name ?? current.name;
        const nextParent = 'parentId' in changes ? changes.parentId : currentParent;
        if (nextParent !== null && nextParent !== currentParent) {
            if (!byId.has(nextParent)) throw new ApiError(400, 'PARENT_NOT_FOUND', 'Folder not found in this database.');
            if (isSelfOrBelow(nextParent, current.id, byId)) {
                throw new ApiError(400, 'FOLDER_CYCLE', 'A folder cannot be moved into itself or one of its own subfolders.');
            }
        }
        const nameChanged = nextName !== current.name;
        const parentChanged = nextParent !== currentParent;
        if (!nameChanged && !parentChanged) return { changed: false, previousParentId: currentParent };
        if (nextParent === null && isTrashName(nextName)) throw trashNameReserved();

        if (nameChanged) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(nextName, current.id);
        if (parentChanged) {
            db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(nextParent, current.id);
            forgetOrigin(db, current.id);
            if (nextParent === folderIndex.trashFolderId && !folderIndex.isInTrash(current.id)) {
                recordOrigin(db, current.id, 'folder', currentParent, new Date().toISOString());
            }
        }
        return { changed: true, previousParentId: currentParent };
    })();
    if (result.changed) announce(ctx, target);
    const folderIndex = buildFolderIndex(readFolders(db));
    return { folder: folderShape(readFolder(db, id), target, folderIndex), previousParentId: result.previousParentId, changed: result.changed };
}

/** Move a folder, with everything in it, into the Trash folder. Nothing is deleted. */
export function trashFolder(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateFolder(ctx, space, id);
    const db = writableDb(target, 'trash-folder');
    const result = db.transaction(() => {
        const current = readFolder(db, id);
        if (!current) throw folderNotFound();
        const folderIndex = buildFolderIndex(readFolders(db));
        if (current.id === folderIndex.trashFolderId) throw trashProtected();
        const previousParentId = current.parent_id ?? null;
        if (folderIndex.isInTrash(current.id)) return { alreadyInTrash: true, previousParentId };
        const now = new Date().toISOString();
        const trashId = ensureTrashFolder(db, target, ctx, folderIndex, now);
        db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(trashId, current.id);
        recordOrigin(db, current.id, 'folder', previousParentId, now);
        return { alreadyInTrash: false, previousParentId };
    })();
    if (!result.alreadyInTrash) announce(ctx, target);
    const folders = readFolders(db);
    const subtree = subtreeIds(id, childrenByParent(folders));
    return {
        folder: folderShape(readFolder(db, id), target, buildFolderIndex(folders)),
        previousParentId: result.previousParentId,
        alreadyInTrash: result.alreadyInTrash,
        documentCount: sumCounts(subtree, documentCountsByFolder(db, subtree)),
    };
}

function parseOffset(value) {
    if (isAbsent(value)) return 0;
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(number) || number < 0 || number > 1_000_000) {
        throw new ApiError(400, 'INVALID_INPUT', 'offset must be a whole number, 0 or more.');
    }
    return number;
}

/**
 * The folders and Documents directly inside Trash, in every database `space`
 * selects (all reachable by default): newest trashed first, then those with no
 * record of when, folders before Documents. Each says where a restore would put it.
 */
export function listTrash(ctx, { space, limit, offset } = {}) {
    requireAgentScope(ctx, 'read');
    const max = parseLimit(limit, 50, 200);
    const skip = parseOffset(offset);
    const items = [];
    let truncated = false;
    for (const target of resolveMany(ctx, space)) {
        const db = target.db;
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const trashId = folderIndex.trashFolderId;
        if (!trashId) continue;
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const children = childrenByParent(folders);
        const trashedFolders = (children.get(trashId) || []).filter((folder) => folder.id !== trashId);
        const trashedDocuments = db.prepare(`
            SELECT id, title, folder_id, updated_at FROM notes WHERE folder_id = ?
             ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?
        `).all(trashId, TREE_DOCUMENT_CAP + 1);
        if (trashedDocuments.length > TREE_DOCUMENT_CAP) {
            truncated = true;
            trashedDocuments.length = TREE_DOCUMENT_CAP;
        }
        const origins = readOrigins(db, [...trashedFolders.map((f) => f.id), ...trashedDocuments.map((d) => d.id)]);
        const subtrees = new Map(trashedFolders.map((folder) => [folder.id, subtreeIds(folder.id, children)]));
        const counts = documentCountsByFolder(db, new Set([...subtrees.values()].flatMap((ids) => [...ids])));
        const restoresTo = (itemId, kind) => {
            const { folderId, reason } = recordedDestination(origins.get(itemId), kind, trashId, folderIndex, byId);
            return { folderId, path: folderIndex.pathOf(folderId), reason };
        };
        const base = { space: target.spaceId, spaceName: target.name };
        for (const folder of trashedFolders) {
            const origin = origins.get(folder.id);
            items.push({
                kind: 'folder',
                id: folder.id,
                name: folder.name,
                ...base,
                trashedAt: origin?.item_kind === 'folder' ? origin.trashed_at : null,
                documentCount: sumCounts(subtrees.get(folder.id), counts),
                subfolderCount: (children.get(folder.id) || []).length,
                restoresTo: restoresTo(folder.id, 'folder'),
            });
        }
        for (const row of trashedDocuments) {
            const origin = origins.get(row.id);
            items.push({
                kind: 'document',
                id: row.id,
                title: row.title,
                ...base,
                updatedAt: row.updated_at,
                trashedAt: origin?.item_kind === 'document' ? origin.trashed_at : null,
                restoresTo: restoresTo(row.id, 'document'),
            });
        }
    }
    items.sort((a, b) => {
        if (a.trashedAt && b.trashedAt && a.trashedAt !== b.trashedAt) return b.trashedAt.localeCompare(a.trashedAt);
        if (Boolean(a.trashedAt) !== Boolean(b.trashedAt)) return a.trashedAt ? -1 : 1;
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return String(a.name ?? a.title ?? '').localeCompare(String(b.name ?? b.title ?? '')) || a.id.localeCompare(b.id);
    });
    const page = items.slice(skip, skip + max);
    return { items: page, total: items.length, nextOffset: skip + max < items.length ? skip + max : null, truncated };
}

/**
 * Bring a Document or folder (with its contents) out of Trash: to `folderId`
 * when given ('root' for the top level); else to where the API trashed it from,
 * if that folder still exists outside Trash; else to the top level.
 */
export function restoreFromTrash(ctx, { id, space, folderId } = {}) {
    requireAgentScope(ctx, 'write');
    if (!validId(id)) throw itemNotFound();
    const requested = !isAbsent(folderId);
    if (requested && typeof folderId !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'folderId must be a folder id or "root".');

    let found = null;
    for (const target of isAbsent(space) ? reachableTargets(ctx) : [resolveOne(ctx, space)]) {
        if (readNote(target.db, id)) found = { target, kind: 'document' };
        else if (readFolder(target.db, id)) found = { target, kind: 'folder' };
        if (found) break;
    }
    if (!found) throw itemNotFound();
    const { target, kind } = found;

    const db = writableDb(target, 'restore-from-trash');
    const destination = db.transaction(() => {
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        let currentParent;
        let name;
        if (kind === 'document') {
            const note = readNote(db, id);
            if (!note) throw itemNotFound();
            if (!folderIndex.isInTrash(note.folder_id)) throw notInTrash();
            assertNoLiveSession(db, target, note.id);
            currentParent = note.folder_id;
        } else {
            const folder = readFolder(db, id);
            if (!folder) throw itemNotFound();
            if (folder.id === folderIndex.trashFolderId) throw trashProtected();
            if (!folderIndex.isInTrash(folder.id)) throw notInTrash();
            currentParent = folder.parent_id ?? null;
            name = folder.name;
        }

        let chosen;
        if (requested) {
            const wanted = folderId === 'root' ? null : folderId;
            if (wanted !== null) {
                if (!byId.has(wanted)) throw destinationNotFound();
                if (folderIndex.isInTrash(wanted)) throw destinationInTrash();
            }
            chosen = { folderId: wanted, reason: 'requested' };
        } else {
            chosen = recordedDestination(readOrigins(db, [id]).get(id), kind, currentParent, folderIndex, byId);
        }
        // A top-level folder called Trash could become the Trash folder.
        if (kind === 'folder' && chosen.folderId === null && isTrashName(name)) throw trashNameReserved();

        if (kind === 'document') updateNote(db, id, { folder_id: chosen.folderId, updated_at: new Date().toISOString() });
        else db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(chosen.folderId, id);
        forgetOrigin(db, id);
        return chosen;
    })();
    announce(ctx, target);

    const folderIndex = buildFolderIndex(readFolders(db));
    const item = kind === 'document'
        ? documentSummary(readNote(db, id), target, folderIndex)
        : folderShape(readFolder(db, id), target, folderIndex);
    return {
        kind,
        [kind]: item,
        destination: { folderId: destination.folderId, path: folderIndex.pathOf(destination.folderId) },
        reason: destination.reason,
    };
}
