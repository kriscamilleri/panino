// Shared setup for the AI agents add-on's integration tests.
import request from 'supertest';
import { cleanupTestUser, createTestApp, getTestToken, setupTestUser } from '../../../tests/testHelpers.js';
import { setAddonEnabled } from '../../registry.js';
import { resetAgentRateLimit } from '../agentAuth.js';
import { resetApiKeyState } from '../keys.js';
import { resetOAuthState } from '../oauth.js';
import { setMetadataFetcher } from '../oauthClients.js';

const SAVED = ['AI_ADDON_ENABLED', 'SHARED_SPACES_ENABLED', 'PUBLIC_API_BASE_URL', 'FRONTEND_URL', 'NODE_ENV'];

/** Turn the add-on on for the process and remember the environment it changed. */
export function offerAiAddon() {
    const saved = Object.fromEntries(SAVED.map((name) => [name, process.env[name]]));
    process.env.AI_ADDON_ENABLED = 'true';
    process.env.SHARED_SPACES_ENABLED = 'true';
    process.env.PUBLIC_API_BASE_URL = 'https://panino.test/api';
    process.env.FRONTEND_URL = 'https://panino.test';
    return () => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    };
}

export function resetAiState() {
    resetApiKeyState();
    resetAgentRateLimit();
    resetOAuthState();
    setMetadataFetcher(null);
}

export { createTestApp };

/** A signed-in user with the add-on switched on (or off). */
export async function aiUser(label, { enabled = true } = {}) {
    const stamp = `${Date.now()}-${Math.random()}`;
    const user = await setupTestUser(`ai-${label}-${stamp}@example.test`, 'password123');
    if (enabled) await setAddonEnabled(user.userId, 'ai', true);
    return { ...user, jwt: getTestToken(user.userId), cleanup: () => cleanupTestUser(user.userId) };
}

/** Create an API key through the session route. */
export async function createKey(app, user, body = {}) {
    const res = await request(app).post('/addons/ai/keys').set('Authorization', `Bearer ${user.jwt}`)
        .send({ name: 'Agent', scope: 'write', ...body });
    if (res.status !== 201) throw new Error(`createKey failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
}
