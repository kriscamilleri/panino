// The AI agents add-on on the add-ons framework: offered, switched, gated
// (docs/specs/active/ai-integration.md §4.4, §11).
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setAddonEnabled } from '../../../registry.js';
import { aiRoutes } from '../../routes.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

describe('AI agents add-on gate', () => {
    let app;
    let server;
    let restore;
    let user;

    beforeAll(() => {
        restore = offerAiAddon();
        ({ app, server } = createTestApp());
    });
    afterAll(() => {
        restore();
        return new Promise((resolve) => server.close(resolve));
    });
    beforeEach(async () => {
        process.env.AI_ADDON_ENABLED = 'true';
        resetAiState();
        user = await aiUser('gate', { enabled: false });
    });
    afterEach(() => user.cleanup());

    const list = async () => {
        const res = await request(app).get('/addons').set('Authorization', `Bearer ${user.jwt}`);
        return (res.body.addons || []).filter((addon) => addon.id === 'ai');
    };

    it('is listed only while offered, off by default', async () => {
        expect(await list()).toEqual([{ id: 'ai', name: 'AI agents', description: expect.stringContaining('leaves Panino'), enabled: false, enabledAt: null }]);
        process.env.AI_ADDON_ENABLED = 'false';
        expect(await list()).toEqual([]);
    });

    describe('session routes', () => {
        const routes = aiRoutes.stack
            .flatMap((layer) => (layer.route ? [layer] : (layer.handle?.stack || []).filter((inner) => inner.route)))
            .flatMap((layer) => Object.keys(layer.route.methods).map((method) => ({ method, path: `/addons/ai${layer.route.path}` })));

        it('covers every session route', () => {
            expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(expect.arrayContaining([
                'get /addons/ai/setup', 'get /addons/ai/keys', 'post /addons/ai/keys', 'delete /addons/ai/keys/:id',
                'get /addons/ai/connections', 'delete /addons/ai/connections/:id',
                'get /addons/ai/oauth/requests/:id', 'post /addons/ai/oauth/requests/:id/approve', 'post /addons/ai/oauth/requests/:id/deny',
            ]));
        });

        it('answers 403 addon_disabled on every one until switched on, 404 when not offered', async () => {
            for (const { method, path } of routes) {
                const res = await request(app)[method](path.replace(/:\w+/g, 'x')).set('Authorization', `Bearer ${user.jwt}`).send({});
                expect({ path, method, status: res.status, error: res.body.error }).toEqual({ path, method, status: 403, error: 'addon_disabled' });
            }
            await setAddonEnabled(user.userId, 'ai', true);
            for (const { method, path } of routes) {
                const res = await request(app)[method](path.replace(/:\w+/g, 'x')).set('Authorization', `Bearer ${user.jwt}`).send({});
                expect({ path, status: res.status }).not.toEqual({ path, status: 403 });
            }
            process.env.AI_ADDON_ENABLED = 'false';
            for (const { method, path } of routes) {
                const res = await request(app)[method](path.replace(/:\w+/g, 'x')).set('Authorization', `Bearer ${user.jwt}`).send({});
                expect({ path, status: res.status }).toEqual({ path, status: 404 });
            }
        });
    });

    describe('public routes and discovery', () => {
        const paths = [
            ['get', '/addons/ai/v1/openapi.json'],
            ['get', '/addons/ai/v1/me'],
            ['post', '/addons/ai/v1/mcp'],
            ['get', '/addons/ai/oauth/authorize'],
            ['post', '/addons/ai/oauth/token'],
            ['post', '/addons/ai/oauth/register'],
            ['post', '/addons/ai/oauth/revoke'],
            ['get', '/.well-known/oauth-protected-resource'],
            ['get', '/.well-known/oauth-protected-resource/api/addons/ai/v1/mcp'],
            ['get', '/.well-known/oauth-authorization-server'],
        ];

        it.each(paths)('%s %s answers 404 while not offered', async (method, path) => {
            process.env.AI_ADDON_ENABLED = 'false';
            const res = await request(app)[method](path).send({});
            expect(res.status).toBe(404);
        });
    });

    describe('the switch and credentials', () => {
        it('refuses every key while the owner has the add-on off, and keeps it', async () => {
            await setAddonEnabled(user.userId, 'ai', true);
            const { secret } = await createKey(app, user);
            const bearer = { Authorization: `Bearer ${secret}` };
            expect((await request(app).get('/addons/ai/v1/me').set(bearer)).status).toBe(200);

            await setAddonEnabled(user.userId, 'ai', false);
            const rest = await request(app).get('/addons/ai/v1/me').set(bearer);
            expect(rest.status).toBe(403);
            expect(rest.body.code).toBe('ADDON_DISABLED');
            const mcp = await request(app).post('/addons/ai/v1/mcp').set(bearer)
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
            expect(mcp.body.error).toMatchObject({ message: expect.stringContaining('turned off'), data: { code: 'ADDON_DISABLED' } });

            await setAddonEnabled(user.userId, 'ai', true);
            expect((await request(app).get('/addons/ai/v1/me').set(bearer)).status).toBe(200);
        });

        it('the old core URLs are gone', async () => {
            await setAddonEnabled(user.userId, 'ai', true);
            const { secret } = await createKey(app, user);
            expect([401, 403, 404]).toContain((await request(app).get('/v1/me').set('Authorization', `Bearer ${secret}`)).status);
            expect([401, 404]).toContain((await request(app).get('/api-keys').set('Authorization', `Bearer ${user.jwt}`)).status);
        });
    });
});
