// The v1 REST API (docs/specs/active/llm-api.md §7), thin adapters over the
// *Service.js operations. Mounted at /addons/ai/v1 as a public route of the
// add-on: it authenticates with API keys, never a session, and agentAuth.js
// checks the owner's switch. OAuth access tokens are refused here (their
// audience is MCP). Each area in api/ registers its own routes.
import express from 'express';
import { authenticateAgent } from './agentAuth.js';
import { AREAS } from './api/index.js';
import { context, handler } from './api/restKit.js';
import { publicUrls } from './config.js';
import { getAccount } from './documentService.js';
import { API_USAGE_NOTE, buildOpenApiDocument, listRoutes } from './openapi.js';

export const restRoutes = express.Router();

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
        routes: listRoutes(),
    });
}));

for (const area of AREAS) area.routes(restRoutes);
