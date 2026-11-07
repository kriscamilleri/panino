// The v1 Document operations, without HTTP (docs/specs/active/ai-integration.md §7):
// account, spaces, tree, search, list, read, create and edit. REST and MCP
// (api/documents.js) are two adapters over these functions, so every rule has
// one implementation; the shared rules are in serviceCore.js.
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb } from '../../db.js';
import {
    ApiError,
    announce,
    assertBodySize,
    assertExpected,
    assertFolder,
    assertNoLiveSession,
    fullDocument,
    documentSummary,
    locateDocument,
    notFound,
    optionalText,
    reachableTargets,
    readFolders,
    readNote,
    requireAgentScope,
    requireName,
    resolveMany,
    resolveOne,
    snapshotAfter,
    snapshotBefore,
    trashFolderIds,
    TREE_DOCUMENT_CAP,
    updateNote,
    writableDb,
} from './serviceCore.js';
import { buildFolderIndex, decodeDocumentCursor, encodeDocumentCursor, makeSnippet, parseLimit } from './keyUtils.js';

export { ApiError, MAX_DOCUMENT_BYTES, requireAgentScope } from './serviceCore.js';

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

    const db = writableDb(target, 'create-document');
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
    const db = writableDb(target, 'update-document');
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
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
    const db = writableDb(target, 'append-document');
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
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
