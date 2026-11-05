import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../../../../tests/testHelpers.js';
import { getUserDb } from '../../../../db.js';
import { isAddonActive, listAddons, readAddonRow, registerAddon, requireAddon } from '../../../registry.js';
import { odooRoutes } from '../../routes.js';

const ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';

describe('The Odoo add-on on the add-ons framework', () => {
    let app;
    let user;
    let other;
    let token;
    const saved = {};

    beforeAll(() => {
        for (const name of ['ODOO_INTEGRATION_ENABLED', 'ODOO_CREDENTIAL_ENCRYPTION_KEY']) saved[name] = process.env[name];
        ({ app } = createTestApp());
    });

    afterAll(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = ENCRYPTION_KEY;
        const stamp = Date.now();
        user = await setupTestUser(`addons-${stamp}@example.test`, 'password123');
        other = await setupTestUser(`addons-other-${stamp}@example.test`, 'password123');
        token = getTestToken(user.userId);
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
        cleanupTestUser(other.userId);
    });

    // Only the Odoo entry: other add-ons are offered or not by their own variables.
    const list = async (t = token) => {
        const response = await request(app).get('/addons').set('Authorization', `Bearer ${t}`);
        return { ...response, status: response.status, body: { addons: (response.body.addons || []).filter((addon) => addon.id === 'odoo') } };
    };
    const put = (id, body, t = token) => request(app).put(`/addons/${id}/enabled`).set('Authorization', `Bearer ${t}`).send(body);

    it('requires a signed-in user', async () => {
        expect((await request(app).get('/addons')).status).toBe(401);
        expect((await request(app).put('/addons/odoo/enabled').send({ enabled: true })).status).toBe(401);
    });

    it('lists only the add-ons the operator offers, off by default', async () => {
        const response = await list();
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            addons: [{ id: 'odoo', name: 'Odoo', description: expect.any(String), enabled: false, enabledAt: null }],
        });

        process.env.ODOO_INTEGRATION_ENABLED = 'false';
        expect((await list()).body).toEqual({ addons: [] });
        expect((await put('odoo', { enabled: true })).status).toBe(404);
    });

    it('switches an add-on on and off for the caller only, and is idempotent', async () => {
        const on = await put('odoo', { enabled: true });
        expect(on.status).toBe(200);
        expect(on.body).toMatchObject({ id: 'odoo', enabled: true });
        expect(on.body.enabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect((await list()).body.addons[0].enabled).toBe(true);
        expect((await list(getTestToken(other.userId))).body.addons[0].enabled).toBe(false);
        expect(isAddonActive(user.userId, 'odoo')).toBe(true);
        expect(isAddonActive(other.userId, 'odoo')).toBe(false);

        const again = await put('odoo', { enabled: true });
        expect(again.body.enabledAt).toBe(on.body.enabledAt);

        const off = await put('odoo', { enabled: false });
        expect(off.body).toMatchObject({ enabled: false, enabledAt: on.body.enabledAt });
        expect(readAddonRow(user.userId, 'odoo').disabled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(isAddonActive(user.userId, 'odoo')).toBe(false);
    });

    it('refuses unknown add-ons and malformed switches', async () => {
        expect((await put('nope', { enabled: true })).status).toBe(404);
        expect((await put('odoo', { enabled: 'yes' })).status).toBe(400);
        expect((await put('odoo', {})).status).toBe(400);
        expect(readAddonRow(user.userId, 'odoo')).toBeNull();
    });

    it('is not active when the operator stops offering it, whatever the switch says', async () => {
        await put('odoo', { enabled: true });
        process.env.ODOO_INTEGRATION_ENABLED = 'false';
        expect(isAddonActive(user.userId, 'odoo')).toBe(false);
        expect((await request(app).get('/addons/odoo').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    });

    describe('the gate on the Odoo routes', () => {
        /**
         * Every route the Odoo router defines, at its public path, so a new one
         * cannot slip past the gate. The registry mounts the router at /addons/odoo.
         */
        const routes = odooRoutes.stack
            .filter((layer) => layer.route)
            .flatMap((layer) => Object.keys(layer.route.methods).map((method) => ({
                method,
                path: `/addons/odoo${layer.route.path === '/' ? '' : layer.route.path}`,
            })));

        it('covers every Odoo route', () => {
            expect(routes.length).toBeGreaterThanOrEqual(7);
            expect(odooRoutes.stack.filter((layer) => layer.route).every((layer) => !layer.route.path.startsWith('/addons'))).toBe(true);
        });

        it('answers 403 addon_disabled on every route until the user switches the add-on on', async () => {
            for (const { method, path } of routes) {
                const response = await request(app)[method](path.replace(/:\w+/g, 'x')).set('Authorization', `Bearer ${token}`).send({});
                expect({ method, path, status: response.status, error: response.body.error }).toEqual({
                    method, path, status: 403, error: 'addon_disabled',
                });
                expect(response.body.message).toContain('Settings → Add-ons');
            }

            await put('odoo', { enabled: true });
            for (const { method, path } of routes) {
                const response = await request(app)[method](path.replace(/:\w+/g, 'x')).set('Authorization', `Bearer ${token}`).send({});
                expect({ method, path, status: response.status }).not.toEqual({ method, path, status: 403 });
            }
        });

        it('keeps the connection while the add-on is off, and uses another user’s switch for nothing', async () => {
            await put('odoo', { enabled: true });
            const now = new Date().toISOString();
            getUserDb(user.userId).prepare(`
                INSERT INTO odoo_connection (singleton, base_url, database_name, api_key_enc, apps, created_at)
                VALUES (1, 'https://acme.odoo.com', '', 'iv:tag:payload', '["crm"]', ?)
            `).run(now);

            await put('odoo', { enabled: false });
            const status = await request(app).get('/addons/odoo').set('Authorization', `Bearer ${token}`);
            expect(status.status).toBe(403);
            expect(getUserDb(user.userId).prepare('SELECT base_url FROM odoo_connection').get()).toEqual({ base_url: 'https://acme.odoo.com' });

            await put('odoo', { enabled: true }, getTestToken(other.userId));
            expect((await request(app).get('/addons/odoo').set('Authorization', `Bearer ${token}`)).status).toBe(403);

            await put('odoo', { enabled: true });
            const back = await request(app).get('/addons/odoo').set('Authorization', `Bearer ${token}`);
            expect(back.status).toBe(200);
            expect(back.body).toMatchObject({ connected: true, baseUrl: 'https://acme.odoo.com' });
        });
    });

    describe('the registry', () => {
        it('registers the Odoo manifest once', () => {
            expect(listAddons().filter((addon) => addon.id === 'odoo')).toHaveLength(1);
        });

        it('rejects manifests without a valid id, a name or isOffered()', () => {
            expect(() => registerAddon({ id: 'Bad Id', name: 'x', isOffered: () => true })).toThrow();
            expect(() => registerAddon({ id: 'x', isOffered: () => true })).toThrow();
            expect(() => registerAddon({ id: 'x', name: 'x' })).toThrow();
            expect(listAddons().map((addon) => addon.id)).not.toContain('x');
        });

        it('answers 404 for an add-on that was never registered', async () => {
            let nextCalled = false;
            const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
            requireAddon('ghost')({ user: { user_id: user.userId } }, res, () => { nextCalled = true; });
            expect(res.code).toBe(404);
            expect(nextCalled).toBe(false);
        });
    });
});
