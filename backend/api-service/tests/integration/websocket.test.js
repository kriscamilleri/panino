// Integration tests for WebSocket connections and sync notifications
import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken, generateSiteId } from '../testHelpers.js';

const WS_PORT = 8001;
const WEBSOCKET_TIMEOUT = 2000;

function waitForEvent(ws, eventName) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for WebSocket ${eventName} event`));
        }, WEBSOCKET_TIMEOUT);

        const onEvent = (...args) => {
            cleanup();
            resolve(args);
        };

        const onError = (error) => {
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            clearTimeout(timeout);
            ws.off(eventName, onEvent);
            ws.off('error', onError);
        };

        ws.once(eventName, onEvent);
        ws.once('error', onError);
    });
}

async function openWebSocket(url) {
    const ws = new WebSocket(url);
    await waitForEvent(ws, 'open');
    return ws;
}

async function closeWebSocket(ws) {
    if (ws.readyState === WebSocket.CLOSED) return;

    const closed = waitForEvent(ws, 'close');
    ws.close();
    await closed;
}

function getServerSocket(clients, siteId) {
    const entry = [...clients.entries()].find(([, clientInfo]) => clientInfo.siteId === siteId);
    expect(entry).toBeDefined();
    return entry[0];
}

function postSync(app, token, siteId, changes = []) {
    return request(app)
        .post('/sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ since: 0, siteId, changes })
        .expect(200);
}

describe('WebSocket Connection', () => {
    let server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        server = result.server;
        return new Promise((resolve) => {
            server.listen(WS_PORT, resolve);
        });
    });

    beforeEach(async () => {
        testUser = await setupTestUser('ws-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(resolve);
            } else {
                resolve();
            }
        });
    });

    it('should accept a connection with a valid token and siteId', async () => {
        const token = getTestToken(testUser.userId);
        const siteId = generateSiteId('a');
        const ws = await openWebSocket(`ws://localhost:${WS_PORT}?token=${token}&siteId=${siteId}`);

        await closeWebSocket(ws);
    });

    it('survives a frame that breaks the protocol, sent without authenticating', async () => {
        // A raw socket: a WebSocket client library will not send this. The
        // library reports it as an "error" event on the server's socket, and an
        // error event nobody listens for is an uncaught exception that exits
        // the whole process.
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('server did not close the socket')), WEBSOCKET_TIMEOUT);
            const socket = net.connect(WS_PORT, '127.0.0.1', () => {
                socket.write([
                    'GET / HTTP/1.1',
                    `Host: 127.0.0.1:${WS_PORT}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
                    'Sec-WebSocket-Version: 13',
                    '', '',
                ].join('\r\n'));
            });
            let upgraded = false;
            socket.on('data', (chunk) => {
                if (upgraded || !chunk.toString().startsWith('HTTP/1.1 101')) return;
                upgraded = true;
                // FIN with all three reserved bits set, text opcode, masked, one byte.
                socket.write(Buffer.from([0xf1, 0x81, 0x00, 0x00, 0x00, 0x00, 0x41]));
            });
            socket.on('close', () => { clearTimeout(timeout); resolve(); });
            socket.on('error', () => { clearTimeout(timeout); resolve(); });
        });

        // Still serving: an ordinary client connects afterwards.
        const token = getTestToken(testUser.userId);
        const ws = await openWebSocket(`ws://localhost:${WS_PORT}?token=${token}&siteId=${generateSiteId('b')}`);
        await closeWebSocket(ws);
    });

    it('should reject a connection with an invalid token', async () => {
        const siteId = generateSiteId('a');
        const ws = new WebSocket(`ws://localhost:${WS_PORT}?token=invalid.token.here&siteId=${siteId}`);

        const [closeCode] = await waitForEvent(ws, 'close');
        expect(closeCode).toBe(1008);
    });

    it('should reject a connection with a missing token or siteId', async () => {
        const token = getTestToken(testUser.userId);
        const missingSiteId = new WebSocket(`ws://localhost:${WS_PORT}?token=${token}`);
        const missingToken = new WebSocket(`ws://localhost:${WS_PORT}?siteId=${generateSiteId('a')}`);

        const [[missingSiteIdCode], [missingTokenCode]] = await Promise.all([
            waitForEvent(missingSiteId, 'close'),
            waitForEvent(missingToken, 'close'),
        ]);

        expect(missingSiteIdCode).toBe(1008);
        expect(missingTokenCode).toBe(1008);
    });
});

describe('Sync Poke Notification', () => {
    let app, server, clients;
    let testUser, otherUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
        clients = result.clients;
        return new Promise((resolve) => {
            server.listen(WS_PORT + 1, resolve);
        });
    });

    beforeEach(async () => {
        testUser = await setupTestUser('sync-poke-test@example.com', 'password123');
        otherUser = await setupTestUser('other-sync-user@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
        if (otherUser) {
            cleanupTestUser(otherUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(resolve);
            } else {
                resolve();
            }
        });
    });

    it('should notify other clients of the same user when changes are pushed', async () => {
        const token = getTestToken(testUser.userId);
        const siteIdA = generateSiteId('a');
        const siteIdB = generateSiteId('b');
        const wsA = await openWebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdA}`);
        const wsB = await openWebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdB}`);

        try {
            const notification = waitForEvent(wsB, 'message');
            await postSync(app, token, siteIdA, [{
                table: 'notes',
                pk: JSON.stringify(['test-note-id']),
                cid: 'title',
                val: 'Test Note',
                col_version: 1,
                db_version: 1,
                site_id: siteIdA,
                cl: 1,
                seq: 0,
            }]);

            const [data] = await notification;
            expect(JSON.parse(data.toString())).toEqual({ type: 'sync' });
        } finally {
            await Promise.all([closeWebSocket(wsA), closeWebSocket(wsB)]);
        }
    });

    it('should NOT notify the client that initiated the push', async () => {
        const token = getTestToken(testUser.userId);
        const siteIdA = generateSiteId('a');
        const wsA = await openWebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdA}`);
        const serverSocket = getServerSocket(clients, siteIdA);
        const send = vi.spyOn(serverSocket, 'send');

        try {
            await postSync(app, token, siteIdA);
            expect(send).not.toHaveBeenCalled();
        } finally {
            send.mockRestore();
            await closeWebSocket(wsA);
        }
    });

    it('should NOT notify clients of other users', async () => {
        const tokenUser = getTestToken(testUser.userId);
        const tokenOther = getTestToken(otherUser.userId);
        const siteIdA = generateSiteId('a');
        const siteIdC = generateSiteId('c');
        const wsA = await openWebSocket(`ws://localhost:${WS_PORT + 1}?token=${tokenUser}&siteId=${siteIdA}`);
        const wsC = await openWebSocket(`ws://localhost:${WS_PORT + 1}?token=${tokenOther}&siteId=${siteIdC}`);
        const otherUserSocket = getServerSocket(clients, siteIdC);
        const send = vi.spyOn(otherUserSocket, 'send');

        try {
            await postSync(app, tokenUser, siteIdA);
            expect(send).not.toHaveBeenCalled();
        } finally {
            send.mockRestore();
            await Promise.all([closeWebSocket(wsA), closeWebSocket(wsC)]);
        }
    });
});
