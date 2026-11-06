// The v1 REST API (docs/specs/active/llm-api.md §7), a thin adapter over
// documentService.js. Mounted at /addons/ai/v1 as a public route of the add-on:
// it authenticates with API keys, never a session, and agentAuth.js checks the
// owner's switch. OAuth access tokens are refused here (their audience is MCP).
import express from 'express';
import { isDatabaseBusyError, respondDatabaseBusy } from '../../db.js';
import { authenticateAgent } from './agentAuth.js';
import { publicUrls } from './config.js';
import {
    ApiError,
    appendToDocument,
    createDocument,
    createFolder,
    getAccount,
    getDocument,
    getTree,
    listDocuments,
    listSpaces,
    searchDocuments,
    trashDocument,
    updateDocument,
} from './documentService.js';
import { buildOpenApiDocument, API_USAGE_NOTE } from './openapi.js';

export const restRoutes = express.Router();

function context(req) {
    return { userId: req.user.user_id, agent: req.agent, clients: req.clients };
}

function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

function spaceParam(req) {
    const fromQuery = first(req.query.space);
    if (fromQuery !== undefined) return fromQuery;
    return req.body && typeof req.body === 'object' ? req.body.space : undefined;
}

function body(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
}

function wantsTrash(req) {
    const value = first(req.query.includeTrash);
    return value === 'true' || value === '1';
}

function handler(fn) {
    return (req, res) => {
        try {
            fn(req, res);
        } catch (error) {
            if (error instanceof ApiError) return res.status(error.status).json({ error: error.message, code: error.code });
            if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
            console.error('[ai:v1]', req.method, req.route?.path, error?.code || error?.message || 'unknown error');
            return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
        }
    };
}

// Public: lets tools load the description before they hold a key.
restRoutes.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiDocument(publicUrls()?.v1Base ?? null));
});

restRoutes.use(authenticateAgent({ allowApps: false }));

restRoutes.get('/', handler((req, res) => {
    getAccount(context(req));
    res.json({
        name: 'Panino API',
        version: 'v1',
        usage: API_USAGE_NOTE,
        openapi: 'openapi.json',
        mcp: publicUrls()?.mcp ?? 'mcp',
        routes: [
            'GET me', 'GET spaces', 'GET tree', 'GET search', 'GET documents', 'GET documents/{id}',
            'POST documents', 'PATCH documents/{id}', 'POST documents/{id}/append', 'DELETE documents/{id}',
            'POST folders',
        ],
    });
}));

restRoutes.get('/me', handler((req, res) => {
    const { user, agent, databases } = getAccount(context(req));
    const key = { id: agent.id, name: agent.name, scope: agent.scope, spaceAccess: agent.spaceAccess, expiresAt: agent.expiresAt };
    res.json({ user, key, databases });
}));

restRoutes.get('/spaces', handler((req, res) => {
    res.json(listSpaces(context(req)));
}));

restRoutes.get('/tree', handler((req, res) => {
    res.json(getTree(context(req), { space: spaceParam(req) }));
}));

restRoutes.get('/search', handler((req, res) => {
    res.json(searchDocuments(context(req), {
        query: first(req.query.q),
        space: spaceParam(req),
        limit: first(req.query.limit),
        includeTrash: wantsTrash(req),
    }));
}));

restRoutes.get('/documents', handler((req, res) => {
    res.json(listDocuments(context(req), {
        space: spaceParam(req),
        folderId: first(req.query.folderId),
        limit: first(req.query.limit),
        cursor: first(req.query.cursor),
        includeTrash: wantsTrash(req),
    }));
}));

restRoutes.get('/documents/:id', handler((req, res) => {
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

restRoutes.post('/documents', handler((req, res) => {
    const input = body(req);
    res.status(201).json(createDocument(context(req), {
        space: spaceParam(req), title: input.title, content: input.content, folderId: input.folderId ?? null,
    }));
}));

restRoutes.patch('/documents/:id', handler((req, res) => {
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

restRoutes.post('/documents/:id/append', handler((req, res) => {
    const input = body(req);
    res.json(appendToDocument(context(req), {
        id: req.params.id,
        space: spaceParam(req),
        content: input.content,
        separator: input.separator,
        expectedUpdatedAt: input.expectedUpdatedAt,
    }));
}));

restRoutes.delete('/documents/:id', handler((req, res) => {
    res.json(trashDocument(context(req), { id: req.params.id, space: spaceParam(req) }));
}));

restRoutes.post('/folders', handler((req, res) => {
    const input = body(req);
    res.status(201).json(createFolder(context(req), { space: spaceParam(req), name: input.name, parentId: input.parentId ?? null }));
}));
