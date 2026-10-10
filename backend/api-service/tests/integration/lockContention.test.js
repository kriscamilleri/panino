// What the API does when a database is locked by something outside the process
// (the backup tool, a repair script, an operator session). The driver is
// synchronous, so the two things that must hold are: the process survives, and
// the caller is told to retry.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken, generateSiteId } from '../testHelpers.js';
import { getAuthDb, getUserDb } from '../../db.js';

const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

/** Make the next `prepare` on this connection fail the way a held lock does. */
function lockOnce(db) {
    const original = db.prepare;
    db.prepare = function lockedPrepare(...args) {
        db.prepare = original;
        throw busy();
    };
    return () => { db.prepare = original; };
}

describe('a locked database', () => {
    let app;
    let server;
    let port;
    let user;
    let token;
    let restore = () => {};

    beforeAll(async () => {
        ({ app, server } = createTestApp());
        await new Promise((resolve) => server.listen(0, resolve));
        port = server.address().port;
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    beforeEach(async () => {
        user = await setupTestUser(`lock-${Date.now()}@example.com`, 'password123');
        token = getTestToken(user.userId);
    });

    afterEach(() => {
        restore();
        cleanupTestUser(user.userId);
    });

    const openSocket = () => new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}&siteId=${generateSiteId('l')}`);
        ws.on('close', (code, reason) => resolve({ opened: false, code, reason: reason.toString() }));
        ws.on('error', () => {});
        // The server authenticates right after the upgrade; a socket that is
        // still open shortly afterwards was accepted.
        ws.on('open', () => setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) { ws.close(); resolve({ opened: true }); }
        }, 150));
    });

    it('asks a WebSocket client to come back instead of crashing the process', async () => {
        // Before the guard, this lookup threw inside the `connection` listener:
        // an uncaught exception that exited the server for every user.
        restore = lockOnce(getAuthDb());

        const refused = await openSocket();
        expect(refused).toMatchObject({ opened: false, code: 1013, reason: 'Try again later' });

        // The process is still serving, and the same client connects once the lock is gone.
        expect((await request(app).get('/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
        expect(await openSocket()).toEqual({ opened: true });
    });

    it('answers a login with a retryable 503 rather than a generic 500', async () => {
        restore = lockOnce(getAuthDb());

        const response = await request(app).post('/login').send({ email: user.email, password: 'password123' });

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: 'Temporarily unavailable', code: 'DATABASE_BUSY' });
        expect(response.headers['retry-after']).toBe('1');

        const retry = await request(app).post('/login').send({ email: user.email, password: 'password123' });
        expect(retry.status).toBe(200);
    });

    it('answers a token refresh with a retryable 503, so the client does not treat it as an expired session', async () => {
        restore = lockOnce(getAuthDb());

        const response = await request(app).post('/refresh').set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(503);
        expect(response.body.code).toBe('DATABASE_BUSY');
    });

    it('turns a lock error no handler caught into a retryable 503', async () => {
        // The revision routes do not catch errors from the content database.
        restore = lockOnce(getUserDb(user.userId));

        const response = await request(app)
            .get('/notes/11111111-1111-4111-8111-111111111111/revisions')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: 'Temporarily unavailable', code: 'DATABASE_BUSY' });
    });
});
