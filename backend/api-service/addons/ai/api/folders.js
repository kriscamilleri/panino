// Folders and Trash in the v1 API, as MCP tools, REST routes and OpenAPI paths
// (docs/specs/active/ai-integration.md §5.3, docs/specs/proposed/ai-api-expansion.md
// §4.2). The rules are in folderService.js.
import {
    createFolder,
    getFolder,
    listTrash,
    restoreFromTrash,
    RESTORE_REASONS,
    trashDocument,
    trashFolder,
    updateFolder,
} from '../folderService.js';
import { documentSummary, errorSchema, errors, fullDocument, idPath, json, jsonBody, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, handler, spaceParam } from './restKit.js';
import { ADDITIVE, ID_HINT, int, object, READ, reader, REPLACING, SPACE_FOR_EXISTING, SPACE_FOR_NEW, str } from './toolKit.js';

/** A write that changes something existing but loses nothing, and gives the same result when repeated. */
const REVERSIBLE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const FOLDER_ID_HINT = 'Folder id, as returned by list_folders, get_folder or create_folder.';
const SPACE_FOR_FOLDER = 'Optional. Space id from list_spaces. Leave out: the folder is found in any database this connection can reach.';
const SPACE_FOR_TRASH_ITEM = 'Optional. Space id from list_spaces. Leave out: the item is found in any database this connection can reach.';

/* ------------------------------------------------------------------ *
 * Result text
 * ------------------------------------------------------------------ */

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const place = (path) => (path ? `folder ${path}` : 'the top level');
const folderLabel = (folder) => folder.path || folder.name || '(unnamed)';

const REASON_TEXT = {
    'requested': 'as asked',
    'previous-location': 'where it was before it was moved to Trash',
    'previous-location-missing': 'its previous folder no longer exists',
    'previous-location-in-trash': 'its previous folder is in Trash too',
    'no-record': 'there is no record of where it was before Trash',
};

function folderText(result) {
    const { folder, counts } = result;
    const lines = [
        `Folder: ${folderLabel(folder)}`,
        `id: ${folder.id}`,
        `space: ${folder.space || 'personal'}`,
        `parent: ${folder.parentId ? `${folder.parentPath || '(unnamed)'} (folder id ${folder.parentId})` : '(top level)'}`,
        `created_at: ${folder.createdAt || 'unknown'}`,
        ...(folder.isTrash ? ['This is the Trash folder. Use list_trash and restore_from_trash for what is in it.'] : []),
        ...(folder.inTrash && !folder.isTrash ? ['in Trash: yes (restore_from_trash brings it back)'] : []),
        `Counts: ${plural(counts.documents, 'Document')} directly here, ${plural(counts.subfolders, 'subfolder')}, ${plural(counts.allDocuments, 'Document')} in all including subfolders.`,
    ];
    if (result.subfolders.length) {
        lines.push('', 'Subfolders:');
        result.subfolders.forEach((sub, index) => {
            lines.push(`${index + 1}. ${sub.name || '(unnamed)'}/ — folder id ${sub.id} — ${plural(sub.documentCount, 'Document')}`);
        });
        if (result.subfoldersTruncated) lines.push('(More subfolders not shown; use list_folders for the whole tree.)');
    }
    if (result.documents.length) {
        lines.push('', 'Documents:');
        result.documents.forEach((doc, index) => {
            lines.push(`${index + 1}. ${doc.title || '(untitled)'} — id ${doc.id} — updated ${doc.updatedAt || 'unknown'}`);
        });
        if (result.documentsTruncated) lines.push('(More Documents not shown; use list_documents with folder_id to page through all.)');
    }
    return lines.join('\n');
}

function trashLine(item, index) {
    const label = item.kind === 'folder'
        ? `[folder] ${item.name || '(unnamed)'}/ — id ${item.id} — ${plural(item.documentCount, 'Document')}`
        : `[Document] ${item.title || '(untitled)'} — id ${item.id}`;
    const space = item.space ? ` — space ${item.spaceName || item.space}` : '';
    const when = item.trashedAt ? `trashed ${item.trashedAt}` : 'trashed at an unknown time';
    return `${index + 1}. ${label}${space} — ${when} — restores to ${place(item.restoresTo.path)}`;
}

/* ------------------------------------------------------------------ *
 * MCP tools
 * ------------------------------------------------------------------ */

export const tools = [
    {
        name: 'move_document_to_trash',
        title: 'Move a Document to Trash',
        description: 'Move a Document into the Trash folder. Nothing is deleted: restore_from_trash brings it back to the folder it came from. Use only when the user asks to delete or discard a Document.',
        access: 'write',
        annotations: REVERSIBLE,
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = trashDocument(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const text = result.alreadyInTrash
                ? `"${result.document.title}" was already in Trash.`
                : `Moved "${result.document.title}" to Trash (id ${result.document.id}). It can be moved back with restore_from_trash.`;
            return { text, structured: { document: result.document, previous_folder_id: result.previousFolderId, already_in_trash: result.alreadyInTrash } };
        },
    },
    {
        name: 'create_folder',
        title: 'Create a folder',
        description: 'Create a folder at the top level or inside another folder. Returns its id.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            name: str('Folder name, one line.'),
            parent_id: str('Optional. Parent folder id from list_folders, or "root" (default) for the top level.'),
            space: str(SPACE_FOR_NEW),
        }, ['name']),
        run(ctx, args) {
            const get = reader(args);
            const { folder } = createFolder(ctx, {
                name: get('name', 'string', { required: true }),
                parentId: get('parent_id', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Created folder "${folder.path || folder.name}" (folder id ${folder.id}).`, structured: { folder } };
        },
    },
    {
        name: 'get_folder',
        title: 'Get a folder',
        description: 'One folder: its path and parent, its subfolders, the Documents directly in it (titles and ids, no text, up to 200) and counts. Find folder ids with list_folders.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ id: str(FOLDER_ID_HINT), space: str(SPACE_FOR_FOLDER) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = getFolder(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            return {
                text: folderText(result),
                structured: {
                    folder: result.folder,
                    subfolders: result.subfolders,
                    subfolders_truncated: result.subfoldersTruncated,
                    documents: result.documents,
                    documents_truncated: result.documentsTruncated,
                    counts: result.counts,
                },
            };
        },
    },
    {
        name: 'rename_folder',
        title: 'Rename a folder',
        description: 'Give a folder a new name. Its Documents and subfolders stay inside it. The Trash folder cannot be renamed.',
        access: 'write',
        annotations: REPLACING,
        inputSchema: object({
            id: str(FOLDER_ID_HINT),
            name: str('New folder name, one line.'),
            space: str(SPACE_FOR_FOLDER),
        }, ['id', 'name']),
        run(ctx, args) {
            const get = reader(args);
            const { folder, changed } = updateFolder(ctx, {
                id: get('id', 'string', { required: true }),
                name: get('name', 'string', { required: true }),
                space: get('space', 'string'),
            });
            const text = changed
                ? `Renamed the folder to "${folder.name}" (folder id ${folder.id}); its path is now ${folderLabel(folder)}.`
                : `The folder is already called "${folder.name}" (folder id ${folder.id}).`;
            return { text, structured: { folder, changed } };
        },
    },
    {
        name: 'move_folder',
        title: 'Move a folder',
        description: 'Move a folder, with everything in it, into another folder or to the top level. A folder cannot move into itself or one of its own subfolders, and the Trash folder cannot move. To delete a folder use move_folder_to_trash instead.',
        access: 'write',
        annotations: REVERSIBLE,
        inputSchema: object({
            id: str(FOLDER_ID_HINT),
            parent_id: str('The folder to move it into (id from list_folders), or "root" for the top level.'),
            space: str(SPACE_FOR_FOLDER),
        }, ['id', 'parent_id']),
        run(ctx, args) {
            const get = reader(args);
            const { folder, changed } = updateFolder(ctx, {
                id: get('id', 'string', { required: true }),
                parentId: get('parent_id', 'string', { required: true }),
                space: get('space', 'string'),
            });
            const text = changed
                ? `Moved folder "${folder.name}" to ${place(folder.parentPath)} (folder id ${folder.id}).`
                : `Folder "${folder.name}" is already in ${place(folder.parentPath)} (folder id ${folder.id}).`;
            return { text, structured: { folder, changed } };
        },
    },
    {
        name: 'move_folder_to_trash',
        title: 'Move a folder to Trash',
        description: 'Move a folder, with all its subfolders and Documents, into the Trash folder. Nothing is deleted: restore_from_trash brings it back to where it was. Use only when the user asks to delete or discard a folder.',
        access: 'write',
        annotations: REVERSIBLE,
        inputSchema: object({ id: str(FOLDER_ID_HINT), space: str(SPACE_FOR_FOLDER) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = trashFolder(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const { folder } = result;
            const text = result.alreadyInTrash
                ? `Folder "${folder.name}" was already in Trash.`
                : `Moved folder "${folder.name}" (with ${plural(result.documentCount, 'Document')}) to Trash. Nothing is deleted: restore_from_trash with id ${folder.id} brings it back.`;
            return {
                text,
                structured: { folder, previous_parent_id: result.previousParentId, already_in_trash: result.alreadyInTrash, document_count: result.documentCount },
            };
        },
    },
    {
        name: 'list_trash',
        title: 'List what is in Trash',
        description: 'The folders and Documents directly inside Trash, newest trashed first, with where restore_from_trash would put each one back. Covers every database this connection can reach unless "space" is given.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str('Optional. "personal" or a space id from list_spaces. Leave out (or "all") for every database.'),
            limit: int('Optional. Page size, 1 to 200. Default 50.'),
            offset: int('Optional. next_offset from the previous call. Default 0.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const result = listTrash(ctx, { space: get('space', 'string'), limit: get('limit', 'integer'), offset: get('offset', 'integer') });
            const lines = result.items.map(trashLine);
            const text = [
                lines.length ? lines.join('\n') : 'Trash is empty.',
                ...(result.nextOffset !== null ? [`next_offset: ${result.nextOffset}`] : []),
            ].join('\n');
            return { text, structured: { items: result.items, total: result.total, next_offset: result.nextOffset, truncated: result.truncated } };
        },
    },
    {
        name: 'restore_from_trash',
        title: 'Restore from Trash',
        description: 'Bring a Document, or a folder with everything in it, back out of Trash. Without folder_id it returns to where it was when it was moved to Trash through this API, if that folder still exists outside Trash; otherwise to the top level. Find ids with list_trash.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            id: str('Id of a Document or folder in Trash, from list_trash.'),
            folder_id: str('Optional. Folder to restore into (id from list_folders, not in Trash), or "root" for the top level. Leave out to restore to where it was.'),
            space: str(SPACE_FOR_TRASH_ITEM),
        }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = restoreFromTrash(ctx, {
                id: get('id', 'string', { required: true }),
                folderId: get('folder_id', 'string'),
                space: get('space', 'string'),
            });
            const item = result[result.kind];
            const label = result.kind === 'folder' ? `folder "${item.name}"` : `"${item.title}"`;
            const text = `Restored ${label} (id ${item.id}) to ${place(result.destination.path)}: ${REASON_TEXT[result.reason]}.`;
            return { text, structured: { kind: result.kind, [result.kind]: item, destination: result.destination, reason: result.reason } };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    PARENT_NOT_FOUND: 'No folder with that id in this database. Use list_folders to find folder ids.',
    FOLDER_CYCLE: 'A folder cannot be moved into itself or one of its own subfolders. Choose a parent outside it, or "root" for the top level.',
    TRASH_FOLDER_PROTECTED: 'The Trash folder itself cannot be renamed, moved or trashed. To act on what is inside it, use list_trash and restore_from_trash.',
    TRASH_NAME_RESERVED: 'A top-level folder cannot be called Trash. Choose another name, or keep it inside another folder (restore_from_trash takes folder_id for that).',
    NOT_IN_TRASH: 'That Document or folder is not in Trash, so there is nothing to restore. Use list_trash to see what is in Trash.',
    DESTINATION_IN_TRASH: 'The folder you chose is itself in Trash. Choose a folder outside Trash with list_folders, or "root" for the top level.',
    ITEM_NOT_FOUND: 'No Document or folder with that id is reachable. Use list_trash to find the ids of what is in Trash.',
};

/* ------------------------------------------------------------------ *
 * REST
 * ------------------------------------------------------------------ */

/** @param {import('express').Router} router */
export function routes(router) {
    router.delete('/documents/:id', handler((req, res) => {
        res.json(trashDocument(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.post('/folders', handler((req, res) => {
        const input = body(req);
        res.status(201).json(createFolder(context(req), { space: spaceParam(req), name: input.name, parentId: input.parentId ?? null }));
    }));

    router.get('/folders/:id', handler((req, res) => {
        res.json(getFolder(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.patch('/folders/:id', handler((req, res) => {
        const input = body(req);
        res.json(updateFolder(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            name: input.name,
            parentId: Object.hasOwn(input, 'parentId') ? input.parentId : undefined,
        }));
    }));

    router.delete('/folders/:id', handler((req, res) => {
        res.json(trashFolder(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.get('/trash', handler((req, res) => {
        res.json(listTrash(context(req), { space: spaceParam(req), limit: first(req.query.limit), offset: first(req.query.offset) }));
    }));

    router.post('/trash/:id/restore', handler((req, res) => {
        const input = body(req);
        res.json(restoreFromTrash(context(req), { id: req.params.id, space: spaceParam(req), folderId: input.folderId ?? undefined }));
    }));
}

/* ------------------------------------------------------------------ *
 * OpenAPI
 * ------------------------------------------------------------------ */

const folderSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string', description: 'Slash-joined folder names from the root' },
        parentId: { type: ['string', 'null'], description: 'Parent folder id, or null at the top level' },
        parentPath: { type: 'string', description: 'The parent\'s path; empty at the top level' },
        space: { type: ['string', 'null'], description: 'Space id, or null for the personal database' },
        createdAt: { type: ['string', 'null'], format: 'date-time' },
        inTrash: { type: 'boolean', description: 'The folder is the Trash folder or inside it' },
        isTrash: { type: 'boolean', description: 'Present and true on the Trash folder itself' },
    },
};

const location = {
    type: 'object',
    properties: {
        folderId: { type: ['string', 'null'], description: 'null is the top level' },
        path: { type: 'string', description: 'Empty at the top level' },
    },
};

const reason = {
    type: 'string',
    enum: [...RESTORE_REASONS],
    description: 'requested: the folderId you sent. previous-location: where it was when the API trashed it. previous-location-missing / previous-location-in-trash: that folder is gone or in Trash, so the top level. no-record: not trashed through the API, so the top level.',
};

const trashItem = {
    type: 'object',
    properties: {
        kind: { type: 'string', enum: ['folder', 'document'] },
        id: { type: 'string' },
        name: { type: 'string', description: 'Folders' },
        title: { type: 'string', description: 'Documents' },
        space: { type: ['string', 'null'] },
        spaceName: { type: ['string', 'null'] },
        updatedAt: { type: 'string', format: 'date-time', description: 'Documents' },
        trashedAt: { type: ['string', 'null'], format: 'date-time', description: 'When the API trashed it; null when not recorded' },
        documentCount: { type: 'integer', description: 'Folders: Documents inside, at any depth' },
        subfolderCount: { type: 'integer', description: 'Folders: direct subfolders' },
        restoresTo: { allOf: [location, { type: 'object', properties: { reason } }] },
    },
};

const errorResponse = (description) => ({ description, content: { 'application/json': { schema: errorSchema } } });

const folderErrors = {
    ...errors,
    400: errorResponse('Invalid input, PARENT_NOT_FOUND, FOLDER_CYCLE, TRASH_FOLDER_PROTECTED or TRASH_NAME_RESERVED'),
    404: errorResponse('FOLDER_NOT_FOUND, or SPACE_NOT_FOUND'),
};

const restoreErrors = {
    ...writeErrors,
    400: errorResponse('Invalid input, FOLDER_NOT_FOUND or DESTINATION_IN_TRASH (folderId), TRASH_FOLDER_PROTECTED or TRASH_NAME_RESERVED'),
    404: errorResponse('ITEM_NOT_FOUND, or SPACE_NOT_FOUND'),
    409: errorResponse('NOT_IN_TRASH, or DOCUMENT_IN_LIVE_SESSION (a space Document open in a live session)'),
};

export const paths = {
    '/documents/{id}': {
        delete: {
            operationId: 'trashDocument',
            summary: 'Move a Document to the Trash folder (soft delete; POST /trash/{id}/restore brings it back)',
            parameters: [idPath, spaceQuery],
            responses: { 200: json({ type: 'object', properties: { document: fullDocument, previousFolderId: { type: ['string', 'null'] }, alreadyInTrash: { type: 'boolean' } } }), ...writeErrors },
        },
    },
    '/folders': {
        post: {
            operationId: 'createFolder',
            summary: 'Create a folder',
            parameters: [spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: ['string', 'null'] } } } } } },
            responses: {
                201: json({ type: 'object' }, 'Created'),
                ...writeErrors,
                400: errorResponse('Invalid input, PARENT_NOT_FOUND, or TRASH_NAME_RESERVED (a top-level folder named Trash)'),
            },
        },
    },
    '/folders/{id}': {
        get: {
            operationId: 'getFolder',
            summary: 'A folder, its subfolders, the Documents directly in it (no bodies, at most 200) and counts',
            parameters: [idPath, spaceQuery],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        folder: folderSchema,
                        subfolders: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' },
                                    documentCount: { type: 'integer', description: 'Documents inside, at any depth' },
                                    subfolderCount: { type: 'integer' },
                                },
                            },
                        },
                        subfoldersTruncated: { type: 'boolean' },
                        documents: { type: 'array', items: documentSummary },
                        documentsTruncated: { type: 'boolean', description: 'More Documents than listed; page with GET /documents?folderId=' },
                        counts: {
                            type: 'object',
                            properties: {
                                documents: { type: 'integer', description: 'Directly in the folder' },
                                subfolders: { type: 'integer', description: 'Direct subfolders' },
                                allDocuments: { type: 'integer', description: 'In the folder and every subfolder' },
                            },
                        },
                    },
                }),
                ...errors,
                404: errorResponse('FOLDER_NOT_FOUND, or SPACE_NOT_FOUND'),
            },
        },
        patch: {
            operationId: 'updateFolder',
            summary: 'Rename and/or move a folder (parentId null or "root" is the top level)',
            parameters: [idPath, spaceQuery],
            requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, parentId: { type: ['string', 'null'] } } }),
            responses: {
                200: json({ type: 'object', properties: { folder: folderSchema, previousParentId: { type: ['string', 'null'] }, changed: { type: 'boolean' } } }),
                ...folderErrors,
            },
        },
        delete: {
            operationId: 'trashFolder',
            summary: 'Move a folder, with everything in it, to the Trash folder (nothing is deleted)',
            parameters: [idPath, spaceQuery],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        folder: folderSchema,
                        previousParentId: { type: ['string', 'null'] },
                        alreadyInTrash: { type: 'boolean' },
                        documentCount: { type: 'integer', description: 'Documents inside, at any depth' },
                    },
                }),
                ...folderErrors,
            },
        },
    },
    '/trash': {
        get: {
            operationId: 'listTrash',
            summary: 'Folders and Documents directly in Trash, newest trashed first, with where each would be restored to',
            parameters: [
                { ...spaceQuery, description: '"personal" or a space id. Omit (or "all") for every reachable database.' },
                { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
                { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
            ],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        items: { type: 'array', items: trashItem },
                        total: { type: 'integer' },
                        nextOffset: { type: ['integer', 'null'] },
                        truncated: { type: 'boolean', description: 'A Trash folder held more Documents than are scanned (5000)' },
                    },
                }),
                ...errors,
            },
        },
    },
    '/trash/{id}/restore': {
        post: {
            operationId: 'restoreFromTrash',
            summary: 'Move a Document or folder out of Trash: to folderId, else where the API trashed it from, else the top level',
            parameters: [{ ...idPath, description: 'A Document or folder id anywhere inside Trash' }, spaceQuery],
            requestBody: jsonBody({ type: 'object', properties: { folderId: { type: ['string', 'null'], description: 'Destination folder id, or "root"' } } }, false),
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['document', 'folder'] },
                        document: documentSummary,
                        folder: folderSchema,
                        destination: location,
                        reason,
                    },
                }),
                ...restoreErrors,
            },
        },
    },
};
