// Folders and Trash in the v1 API, as MCP tools, REST routes and OpenAPI paths
// (docs/specs/active/ai-integration.md §5.3). The rules are in folderService.js.
import { createFolder, trashDocument } from '../folderService.js';
import { fullDocument, idPath, json, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, handler, spaceParam } from './restKit.js';
import { ADDITIVE, ID_HINT, object, reader, SPACE_FOR_EXISTING, SPACE_FOR_NEW, str } from './toolKit.js';

export const tools = [
    {
        name: 'move_document_to_trash',
        title: 'Move a Document to Trash',
        description: 'Move a Document into the Trash folder. Nothing is deleted: the user can move it back. Use only when the user asks to delete or discard a Document.',
        access: 'write',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = trashDocument(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const text = result.alreadyInTrash
                ? `"${result.document.title}" was already in Trash.`
                : `Moved "${result.document.title}" to Trash (id ${result.document.id}). It can be moved back.`;
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
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    PARENT_NOT_FOUND: 'No folder with that id in this database. Use list_folders to find folder ids.',
};

/** @param {import('express').Router} router */
export function routes(router) {
    router.delete('/documents/:id', handler((req, res) => {
        res.json(trashDocument(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.post('/folders', handler((req, res) => {
        const input = body(req);
        res.status(201).json(createFolder(context(req), { space: spaceParam(req), name: input.name, parentId: input.parentId ?? null }));
    }));
}

export const paths = {
    '/documents/{id}': {
        delete: {
            operationId: 'trashDocument',
            summary: 'Move a Document to the Trash folder (soft delete)',
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
            responses: { 201: json({ type: 'object' }, 'Created'), ...writeErrors },
        },
    }
};
