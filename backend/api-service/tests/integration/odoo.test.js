import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';

const API_KEY = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
const ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';

/** A stand-in Odoo answering with the shapes Odoo 19/20 sent in Phase 0. */
function startFakeOdoo() {
    const state = { major: 20, keyValid: true, requests: [] };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            state.requests.push({ url: req.url, headers: req.headers, body });
            const send = (status, value) => {
                res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(value));
            };
            if (req.url === '/web/version') {
                return send(200, { version_info: [state.major, 0, 0, 'final', 0, 'e'], version: `${state.major}.0+e` });
            }
            if (req.headers.authorization !== `bearer ${API_KEY}` || !state.keyValid) {
                return send(401, { name: 'werkzeug.exceptions.Unauthorized', message: 'Invalid apikey', arguments: ['Invalid apikey', 401], debug: 'Traceback: secret server path' });
            }
            if (req.url === '/json/2/res.users/context_get') return send(200, { lang: 'en_US', tz: 'UTC', uid: 2 });
            if (req.url === '/json/2/res.users/read') return send(200, [{ id: 2, name: 'Mitchell Admin' }]);
            if (req.url === '/json/2/crm.lead/search_count' || req.url === '/json/2/sale.order/search_count') return send(200, 0);
            return send(404, { name: 'werkzeug.exceptions.NotFound', message: 'the model does not exist', arguments: [] });
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

describe('Odoo connection routes', () => {
    let app;
    let server;
    let odoo;
    let user;
    let otherUser;
    let token;
    let saved;

    beforeAll(async () => {
        saved = {
            enabled: process.env.ODOO_INTEGRATION_ENABLED,
            key: process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY,
            hosts: process.env.ODOO_ALLOWED_PRIVATE_HOSTS,
        };
        ({ app, server } = createTestApp());
        odoo = await startFakeOdoo();
    });

    afterAll(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = saved.enabled ?? '';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = saved.key ?? '';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = saved.hosts ?? '';
        await new Promise((resolve) => odoo.server.close(resolve));
        server?.close?.();
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = ENCRYPTION_KEY;
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        odoo.state.major = 20;
        odoo.state.keyValid = true;
        odoo.state.requests = [];
        resetOdooRateLimits();
        user = await setupTestUser(`odoo-${Date.now()}@example.test`, 'password123');
        otherUser = await setupTestUser(`odoo-other-${Date.now()}@example.test`, 'password123');
        token = getTestToken(user.userId);
        // The add-on is off until each user switches it on (addons.test.js covers the gate).
        for (const id of [user.userId, otherUser.userId]) {
            await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${getTestToken(id)}`).send({ enabled: true });
        }
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
        cleanupTestUser(otherUser.userId);
    });

    const connectBody = () => ({
        baseUrl: `http://127.0.0.1:${odoo.port}/odoo/action-42`,
        databaseName: 'panino_ee',
        apiKey: API_KEY,
        keyExpiresOn: '2027-01-24',
    });
    const put = (body, t = token) => request(app).put('/addons/odoo').set('Authorization', `Bearer ${t}`).send(body);
    const get = (t = token) => request(app).get('/addons/odoo').set('Authorization', `Bearer ${t}`);

    it('answers 404 while the flag is off or the encryption key is missing', async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'false';
        expect((await get()).status).toBe(404);
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'short';
        expect((await get()).status).toBe(404);
        expect((await put(connectBody())).status).toBe(404);
        expect(odoo.state.requests).toHaveLength(0);
    });

    it('requires a signed-in user', async () => {
        expect((await request(app).get('/addons/odoo')).status).toBe(401);
    });

    it('starts disconnected', async () => {
        const response = await get();
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ connected: false });
    });

    it('verifies, then stores the connection with the key encrypted and never returned', async () => {
        const response = await put(connectBody());
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            connected: true,
            baseUrl: `http://127.0.0.1:${odoo.port}`,
            databaseName: 'panino_ee',
            keyExpiresOn: '2027-01-24',
            odooUserName: 'Mitchell Admin',
            odooVersion: '20.0+e',
            apps: ['crm', 'sales'],
            lastError: null,
        });
        expect(JSON.stringify(response.body)).not.toContain(API_KEY);
        expect(JSON.stringify((await get()).body)).not.toContain(API_KEY);

        const row = getUserDb(user.userId).prepare('SELECT * FROM odoo_connection').get();
        expect(row.api_key_enc).not.toContain(API_KEY);
        expect(row.api_key_enc.split(':')).toHaveLength(3);

        const call = odoo.state.requests.find((r) => r.url === '/json/2/res.users/context_get');
        expect(call.headers['x-odoo-database']).toBe('panino_ee');
    });

    it('keeps one user’s connection from another', async () => {
        await put(connectBody());
        expect((await get(getTestToken(otherUser.userId))).body).toEqual({ connected: false });
    });

    it('saves nothing when Odoo rejects the key, and leaks no Odoo detail', async () => {
        odoo.state.keyValid = false;
        const response = await put(connectBody());
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('key_rejected');
        expect(JSON.stringify(response.body)).not.toMatch(/Traceback|Invalid apikey|werkzeug/);
        expect((await get()).body).toEqual({ connected: false });
    });

    it('refuses Odoo before 19', async () => {
        odoo.state.major = 18;
        const response = await put(connectBody());
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('not_odoo_19');
    });

    it('refuses a private address that is not allowed, without contacting it', async () => {
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '';
        const response = await put(connectBody());
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('invalid');
        expect(odoo.state.requests).toHaveLength(0);

        // Even over https, a private address is blocked.
        const https = await put({ ...connectBody(), baseUrl: `https://127.0.0.1:${odoo.port}` });
        expect(https.body.error).toBe('blocked');
        expect(odoo.state.requests).toHaveLength(0);
    });

    it('validates the input', async () => {
        for (const body of [
            { ...connectBody(), apiKey: 'short' },
            { ...connectBody(), apiKey: `${API_KEY} with spaces` },
            { ...connectBody(), databaseName: "x'; DROP TABLE" },
            { ...connectBody(), keyExpiresOn: '2027-02-30' },
            { ...connectBody(), baseUrl: 'ftp://example.com' },
            {},
        ]) {
            const response = await put(body);
            expect(response.status, JSON.stringify(body)).toBe(400);
            expect(response.body.error).toBe('invalid');
        }
        expect(odoo.state.requests).toHaveLength(0);
    });

    it('re-checks a stored connection and records a rejected key', async () => {
        await put(connectBody());
        odoo.state.keyValid = false;
        const response = await request(app).post('/addons/odoo/check').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ connected: true, lastError: 'key_rejected' });
        expect(response.body.lastErrorMessage).toMatch(/rejected the API key/);

        odoo.state.keyValid = true;
        const again = await request(app).post('/addons/odoo/check').set('Authorization', `Bearer ${token}`);
        expect(again.body.lastError).toBeNull();
    });

    it('asks for the key again when the server key changed', async () => {
        await put(connectBody());
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'a-different-server-key-0123456789abcdef';
        const response = await request(app).post('/addons/odoo/check').set('Authorization', `Bearer ${token}`);
        expect(response.body.lastError).toBe('key_rejected');
    });

    it('disconnects', async () => {
        await put(connectBody());
        const response = await request(app).delete('/addons/odoo').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(204);
        expect((await get()).body).toEqual({ connected: false });
    });

    it('limits connection attempts', async () => {
        odoo.state.keyValid = false;
        const statuses = [];
        for (let i = 0; i < 11; i += 1) statuses.push((await put(connectBody())).status);
        expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
        expect(statuses[10]).toBe(429);
    });
});
