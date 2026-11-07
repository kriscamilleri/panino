// Routes of the AI agents add-on (docs/specs/active/ai-integration.md §4.2).
//
//   publicRoutes (before sign-in, offered check only; each authenticates itself)
//     /addons/ai/v1/mcp      MCP endpoint        API key or OAuth access token
//     /addons/ai/v1/*        REST API            API key
//     /addons/ai/oauth/*     OAuth endpoints     the OAuth protocol's own proofs
//   routes (session, behind the add-on gate)
//     /addons/ai/setup, /keys, /connections, /oauth/requests/*
import express from 'express';
import { publicUrls } from './config.js';
import { keyRoutes } from './keys.js';
import { MAX_ACTIVE_API_KEYS } from './keyUtils.js';
import { mcpRoutes } from './mcp.js';
import { publicOAuthRoutes, sessionOAuthRoutes } from './oauth.js';
import { restRoutes } from './restRoutes.js';

const v1Routes = express.Router();
v1Routes.use('/mcp', mcpRoutes);
v1Routes.use('/', restRoutes);
v1Routes.use((req, res) => {
    res.status(404).json({ error: 'No such API route. See GET /addons/ai/v1 or /addons/ai/v1/openapi.json.', code: 'NO_ROUTE' });
});

export const aiPublicRoutes = express.Router();
aiPublicRoutes.use('/v1', v1Routes);
aiPublicRoutes.use(publicOAuthRoutes);

export const aiRoutes = express.Router();

// GET /addons/ai/setup — what the settings card needs to show connection help.
aiRoutes.get('/setup', (req, res) => {
    const urls = publicUrls();
    res.json({
        mcpUrl: urls?.mcp ?? null,
        apiBaseUrl: urls?.v1Base ?? null,
        oauthAvailable: Boolean(urls),
        keyLimit: MAX_ACTIVE_API_KEYS,
    });
});
aiRoutes.use(keyRoutes);
aiRoutes.use(sessionOAuthRoutes);
