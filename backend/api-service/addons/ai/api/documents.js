// Documents in the v1 API: account, spaces, tree, search, list, read, create and edit,
// as MCP tools, REST routes and OpenAPI paths (docs/specs/active/ai-integration.md §5.3).
// The rules are in documentService.js; this file only adapts.
import {
    appendToDocument,
    createDocument,
    getAccount,
    getDocument,
    getTree,
    listDocuments,
    listSpaces,
    searchDocuments,
    updateDocument,
} from '../documentService.js';
import { documentSummary, errors, fullDocument, idPath, json, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, handler, spaceParam, wantsTrash } from './restKit.js';
import {
    ADDITIVE,
    bool,
    documentHeader,
    documentLine,
    EXPECTED,
    ID_HINT,
    int,
    object,
    READ,
    reader,
    SPACE_FOR_EXISTING,
    SPACE_FOR_NEW,
    str,
    where,
} from './toolKit.js';

export const tools = [

    {
        name: 'get_account',
        title: 'Panino account',
        description: 'Who this connection belongs to, whether it may write, and which databases (personal and shared spaces) it can reach. Call it first if you are unsure what you can do.',
        access: 'read',
        annotations: READ,
        inputSchema: object(),
        run(ctx) {
            const result = getAccount(ctx);
            const lines = [
                `Signed in as ${result.user?.name || 'unknown'}${result.user?.email ? ` <${result.user.email}>` : ''}.`,
                `Access: ${result.agent.scope === 'write' ? 'read and write' : 'read only'} (${result.agent.kind === 'app' ? 'connected app' : 'API key'} "${result.agent.name}").`,
                'Databases:',
                ...result.databases.map((db) => `- ${db.kind === 'personal' ? 'Personal (space "personal")' : `${db.name} (space id ${db.id}, ${db.role})`}`),
            ];
            return { text: lines.join('\n'), structured: result };
        },
    },
    {
        name: 'list_spaces',
        title: 'List shared spaces',
        description: 'The shared spaces this connection can reach, with their ids. Pass a space id as "space" to other tools to work in that space.',
        access: 'read',
        annotations: READ,
        inputSchema: object(),
        run(ctx) {
            const result = listSpaces(ctx);
            const text = result.spaces.length
                ? result.spaces.map((space, i) => `${i + 1}. ${space.name} — space id ${space.id} — role ${space.role}`).join('\n')
                : 'No shared spaces are reachable. Everything is in the personal database.';
            return { text, structured: result };
        },
    },
    {
        name: 'search_documents',
        title: 'Search Documents',
        description: 'Find Documents whose title or text contains the query (case-insensitive), across every reachable database. Title matches come first; each result has an id and a snippet. Use this before reading or editing a Document.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            query: str('Text to look for, 2 to 200 characters. Plain words, no operators.'),
            space: str('Optional. "all" (default) for every database, "personal", or a space id from list_spaces.'),
            limit: int('Optional. Most results to return, 1 to 100. Default 20.'),
            include_trash: bool('Optional. Also search Documents in the Trash folder. Default false.'),
        }, ['query']),
        run(ctx, args) {
            const get = reader(args);
            const result = searchDocuments(ctx, {
                query: get('query', 'string', { required: true }),
                space: get('space', 'string'),
                limit: get('limit', 'integer'),
                includeTrash: get('include_trash', 'boolean') ?? false,
            });
            const text = result.results.length
                ? result.results.map((doc, i) => `${documentLine(doc, i)}\n   ${doc.snippet || ''}`.trimEnd()).join('\n')
                : `No Documents contain "${result.query}".`;
            return { text, structured: result };
        },
    },
    {
        name: 'list_documents',
        title: 'List Documents',
        description: 'Documents, most recently updated first, without their text. Use folder_id to list one folder. If next_cursor is given, call again with it for the next page.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str('Optional. "all" (default), "personal", or a space id from list_spaces.'),
            folder_id: str('Optional. Only this folder (id from list_folders), or "root" for the top level.'),
            limit: int('Optional. Page size, 1 to 200. Default 50.'),
            cursor: str('Optional. next_cursor from the previous call.'),
            include_trash: bool('Optional. Include Documents in the Trash folder. Default false.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const result = listDocuments(ctx, {
                space: get('space', 'string'),
                folderId: get('folder_id', 'string'),
                limit: get('limit', 'integer'),
                cursor: get('cursor', 'string'),
                includeTrash: get('include_trash', 'boolean') ?? false,
            });
            const lines = result.documents.map(documentLine);
            const text = [lines.length ? lines.join('\n') : 'No Documents.', ...(result.nextCursor ? [`next_cursor: ${result.nextCursor}`] : [])].join('\n');
            return { text, structured: { documents: result.documents, next_cursor: result.nextCursor } };
        },
    },
    {
        name: 'list_folders',
        title: 'List folders',
        description: 'The folder tree of one database with the titles and ids of its Documents (no text). Use it to find folder ids for create_document or list_documents.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str('Optional. "personal" (default) or a space id from list_spaces.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const result = getTree(ctx, { space: get('space', 'string') });
            const children = new Map();
            for (const folder of result.folders) {
                const key = folder.parentId ?? 'root';
                if (!children.has(key)) children.set(key, []);
                children.get(key).push(folder);
            }
            const docsIn = new Map();
            for (const doc of result.documents) {
                const key = doc.folderId ?? 'root';
                if (!docsIn.has(key)) docsIn.set(key, []);
                docsIn.get(key).push(doc);
            }
            const lines = [];
            const seen = new Set();
            const walk = (key, depth) => {
                for (const doc of docsIn.get(key) || []) lines.push(`${'  '.repeat(depth)}- ${doc.title || '(untitled)'} (id ${doc.id})`);
                for (const folder of children.get(key) || []) {
                    if (seen.has(folder.id)) continue;
                    seen.add(folder.id);
                    lines.push(`${'  '.repeat(depth)}+ ${folder.name}/ (folder id ${folder.id})`);
                    walk(folder.id, depth + 1);
                }
            };
            walk('root', 0);
            if (result.truncated) lines.push('(Only the first 5000 Documents are shown.)');
            return { text: lines.length ? lines.join('\n') : 'This database is empty.', structured: result };
        },
    },
    {
        name: 'get_document',
        title: 'Read a Document',
        description: 'The full Markdown text of one Document, with its title, folder and updated_at. Keep updated_at: pass it as expected_updated_at when you edit.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = getDocument(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            return { text: `${documentHeader(document)}\n\n${document.content}`, structured: { document } };
        },
    },
    {
        name: 'create_document',
        title: 'Create a Document',
        description: 'Create a new Markdown Document. Returns its id and updated_at.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            title: str('Title, 1 to 255 characters, one line.'),
            content: str('Optional. Markdown text. Default: a heading with the title.'),
            folder_id: str('Optional. Folder id from list_folders, or "root" (default) for the top level.'),
            space: str(SPACE_FOR_NEW),
        }, ['title']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = createDocument(ctx, {
                title: get('title', 'string', { required: true }),
                content: get('content', 'string'),
                folderId: get('folder_id', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Created "${document.title}"${where(document)} (id ${document.id}). updated_at is ${document.updatedAt}.`, structured: { document } };
        },
    },
    {
        name: 'update_document',
        title: 'Change a Document',
        description: 'Change a Document\'s title, replace its whole text, move it to another folder, or pin it. To add to the end, use append_to_document instead. The previous text stays in Panino\'s revision history.',
        access: 'write',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        inputSchema: object({
            id: str(ID_HINT),
            title: str('Optional. New title.'),
            content: str('Optional. New Markdown text, replacing all of the current text.'),
            folder_id: str('Optional. Move to this folder id, or "root" for the top level.'),
            pinned: bool('Optional. Pin or unpin the Document.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = updateDocument(ctx, {
                id: get('id', 'string', { required: true }),
                title: get('title', 'string'),
                content: get('content', 'string'),
                folderId: get('folder_id', 'string'),
                pinned: get('pinned', 'boolean'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Updated "${document.title}" (id ${document.id}). updated_at is now ${document.updatedAt}.`, structured: { document } };
        },
    },
    {
        name: 'append_to_document',
        title: 'Append to a Document',
        description: 'Add Markdown to the end of a Document, after a blank line. Best for logs, journals and running notes: nothing already there is changed.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            id: str(ID_HINT),
            content: str('Markdown to add.'),
            separator: str('Optional. Text placed between the existing text and yours, up to 100 characters. Default: a blank line.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'content']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = appendToDocument(ctx, {
                id: get('id', 'string', { required: true }),
                content: get('content', 'string', { required: true }),
                separator: get('separator', 'string'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Appended to "${document.title}" (id ${document.id}). updated_at is now ${document.updatedAt}.`, structured: { document } };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    VERSION_CONFLICT: 'The Document changed since you read it. Call get_document again, then retry with its new updated_at as expected_updated_at.',
    DOCUMENT_IN_LIVE_SESSION: 'Someone is editing this Document live in Panino right now. Try again later, or tell the user.',
    NOT_FOUND: 'No Document with that id is reachable. Use search_documents or list_documents to find the right id.',
    SPACE_NOT_FOUND: 'No space with that id is reachable. Use list_spaces, or leave "space" out.',
    FOLDER_NOT_FOUND: 'No folder with that id in this database. Use list_folders to find folder ids.',
    DOCUMENT_TOO_LARGE: 'The Document would exceed 2 MiB. Split the text into several Documents.',
};

/** @param {import('express').Router} router */
export function routes(router) {
    router.get('/me', handler((req, res) => {
        const { user, agent, databases } = getAccount(context(req));
        const key = { id: agent.id, name: agent.name, scope: agent.scope, spaceAccess: agent.spaceAccess, expiresAt: agent.expiresAt };
        res.json({ user, key, databases });
    }));

    router.get('/spaces', handler((req, res) => {
        res.json(listSpaces(context(req)));
    }));

    router.get('/tree', handler((req, res) => {
        res.json(getTree(context(req), { space: spaceParam(req) }));
    }));

    router.get('/search', handler((req, res) => {
        res.json(searchDocuments(context(req), {
            query: first(req.query.q),
            space: spaceParam(req),
            limit: first(req.query.limit),
            includeTrash: wantsTrash(req),
        }));
    }));

    router.get('/documents', handler((req, res) => {
        res.json(listDocuments(context(req), {
            space: spaceParam(req),
            folderId: first(req.query.folderId),
            limit: first(req.query.limit),
            cursor: first(req.query.cursor),
            includeTrash: wantsTrash(req),
        }));
    }));

    router.get('/documents/:id', handler((req, res) => {
        const { document } = getDocument(context(req), { id: req.params.id, space: spaceParam(req) });
        const accept = String(req.headers.accept || '');
        const format = first(req.query.format);
        const asMarkdown = format === 'markdown'
            || (format === undefined && accept.includes('text/markdown') && !accept.includes('application/json'));
        if (!asMarkdown) return res.json({ document });
        res.setHeader('X-Panino-Document-Id', document.id);
        res.setHeader('X-Panino-Title', encodeURIComponent(document.title ?? ''));
        res.setHeader('X-Panino-Updated-At', document.updatedAt ?? '');
        res.setHeader('X-Panino-Folder-Path', encodeURIComponent(document.folderPath));
        if (document.space) res.setHeader('X-Panino-Space', document.space);
        res.type('text/markdown; charset=utf-8');
        return res.send(document.content);
    }));

    router.post('/documents', handler((req, res) => {
        const input = body(req);
        res.status(201).json(createDocument(context(req), {
            space: spaceParam(req), title: input.title, content: input.content, folderId: input.folderId ?? null,
        }));
    }));

    router.patch('/documents/:id', handler((req, res) => {
        const input = body(req);
        res.json(updateDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            title: input.title,
            content: input.content,
            folderId: input.folderId,
            pinned: input.pinned,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));

    router.post('/documents/:id/append', handler((req, res) => {
        const input = body(req);
        res.json(appendToDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            content: input.content,
            separator: input.separator,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));
}

export const paths = {

    '/me': {
        get: {
            operationId: 'getMe',
            summary: 'Who the key belongs to, its access, and the databases it reaches',
            responses: { 200: json({ type: 'object' }), ...errors },
        },
    },
    '/spaces': {
        get: {
            operationId: 'listSpaces',
            summary: 'Shared spaces the key can reach',
            responses: { 200: json({ type: 'object', properties: { spaces: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } } }), ...errors },
        },
    },
    '/tree': {
        get: {
            operationId: 'getTree',
            summary: 'Folders and Document titles of one database (no bodies)',
            parameters: [spaceQuery],
            responses: { 200: json({ type: 'object' }), ...errors },
        },
    },
    '/search': {
        get: {
            operationId: 'searchDocuments',
            summary: 'Case-insensitive search of titles and bodies; title matches first',
            parameters: [
                { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 200 } },
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
            ],
            responses: { 200: json({ type: 'object', properties: { results: { type: 'array', items: { allOf: [documentSummary, { type: 'object', properties: { snippet: { type: 'string' }, matchedTitle: { type: 'boolean' }, spaceName: { type: ['string', 'null'] } } }] } } } }), ...errors },
        },
    },
    '/documents': {
        get: {
            operationId: 'listDocuments',
            summary: 'Documents, most recently updated first (metadata only)',
            parameters: [
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                { name: 'folderId', in: 'query', schema: { type: 'string' }, description: 'Only this folder; "root" for the top level' },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
                { name: 'cursor', in: 'query', schema: { type: 'string' } },
                { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
            ],
            responses: { 200: json({ type: 'object', properties: { documents: { type: 'array', items: documentSummary }, nextCursor: { type: ['string', 'null'] } } }), ...errors },
        },
        post: {
            operationId: 'createDocument',
            summary: 'Create a Document',
            parameters: [spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, content: { type: 'string' }, folderId: { type: ['string', 'null'] } } } } } },
            responses: { 201: json({ type: 'object', properties: { document: fullDocument } }, 'Created'), ...writeErrors },
        },
    },
    '/documents/{id}': {
        get: {
            operationId: 'getDocument',
            summary: 'One Document with its Markdown body',
            parameters: [idPath, spaceQuery, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'markdown'] } }],
            responses: {
                200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { document: fullDocument } } }, 'text/markdown': { schema: { type: 'string' } } } },
                ...errors,
            },
        },
        patch: {
            operationId: 'updateDocument',
            summary: 'Change title, body, folder or pin',
            parameters: [idPath, spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, folderId: { type: ['string', 'null'] }, pinned: { type: 'boolean' }, expectedUpdatedAt: { type: 'string', description: 'updatedAt from your last read; mismatch → 409' } } } } } },
            responses: { 200: json({ type: 'object', properties: { document: fullDocument } }), ...writeErrors },
        },
    },
    '/documents/{id}/append': {
        post: {
            operationId: 'appendToDocument',
            summary: 'Append Markdown to the end of a Document',
            parameters: [idPath, spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' }, separator: { type: 'string', description: 'Default: a blank line' }, expectedUpdatedAt: { type: 'string' } } } } } },
            responses: { 200: json({ type: 'object', properties: { document: fullDocument } }), ...writeErrors },
        },
    },
};
