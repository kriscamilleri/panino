/**
 * The AI agents add-on (docs/specs/active/ai-integration.md): API keys, the v1
 * REST API, the MCP server and OAuth connected apps, so outside AI agents can
 * read and write the user's Documents. Its manifest is everything core knows
 * about it. Registered when addons/index.js loads.
 */

import { registerAddon } from '../registry.js';
import { ADDON_ID, aiConfigWarnings, isAiAddonOffered } from './config.js';
import { authorizationServerMetadata, protectedResourceMetadata } from './oauth.js';
import { aiPublicRoutes, aiRoutes } from './routes.js';
import { AI_AUTH_SCHEMA } from './schema.js';

/**
 * Offered when the operator sets AI_ADDON_ENABLED=true. Switching off needs no
 * hook: nothing runs in the background, and every key and connected app is
 * refused while the switch is off (agentAuth.js), then works again when it is on.
 */
export const aiAddon = Object.freeze({
    id: ADDON_ID,
    name: 'AI agents',
    description: 'Let AI assistants and scripts you choose (Claude, ChatGPT, Gemini, Cursor and others) read and write your Documents, through API keys or apps you connect. What they read leaves Panino and is handled by that service.',
    isOffered: isAiAddonOffered,
    routes: aiRoutes,
    publicRoutes: aiPublicRoutes,
    wellKnown: {
        'oauth-protected-resource': protectedResourceMetadata,
        'oauth-authorization-server': authorizationServerMetadata,
    },
    schema: { auth: AI_AUTH_SCHEMA },
    configWarnings: aiConfigWarnings,
});
registerAddon(aiAddon);
