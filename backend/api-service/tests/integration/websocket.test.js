// Integration tests for WebSocket connections and sync notifications
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken, generateSiteId } from '../testHelpers.js';

const WS_PORT = 8001; // Use a different port for WebSocket tests

describe('WebSocket Connection', () => {
    let app, server, wss;
    let testUser;
    let serverUrl;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
        wss = result.wss;

        // Start server on test port
        return new Promise((resolve) => {
            server.listen(WS_PORT, () => {
                serverUrl = `http://localhost:${WS_PORT}`;
                resolve();
            });
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
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should accept a connection with a valid token and siteId', async () => {
        const token = getTestToken(testUser.userId);
        const siteId = generateSiteId('a');

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${WS_PORT}?token=${token}&siteId=${siteId}`);

            ws.on('open', () => {
                ws.close();
                resolve();
            });

            ws.on('error', (error) => {
                reject(error);
            });

            ws.on('close', (code, reason) => {
                if (code !== 1000 && code !== 1005) { // 1000 = normal closure, 1005 = no status received
                    reject(new Error(`Connection closed with code ${code}: ${reason}`));
                }
            });

            setTimeout(() => {
                ws.close();
                reject(new Error('Connection timeout'));
            }, 5000);
        });
    });

    it('should reject a connection with an invalid token', async () => {
        const siteId = generateSiteId('a');

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${WS_PORT}?token=invalid.token.here&siteId=${siteId}`);

            let closeCode = null;

            ws.on('open', () => {
                // Connection may briefly open before server closes it
                // We'll check if it stays open or gets closed
            });

            ws.on('close', (code) => {
                closeCode = code;
            });

            ws.on('error', () => {
                // WebSocket errors are expected when connection is rejected
            });

            // Wait to see if connection is closed by server
            setTimeout(() => {
                if (closeCode === 1008 || ws.readyState === WebSocket.CLOSED) {
                    resolve();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('WebSocket should have been closed by server with invalid token'));
                } else {
                    resolve(); // Connection was rejected
                }
            }, 1000);
        });
    });

    it('should reject a connection with a missing token or siteId', async () => {
        const token = getTestToken(testUser.userId);

        // Missing siteId
        const promise1 = new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${WS_PORT}?token=${token}`);

            let closeCode = null;

            ws.on('close', (code) => {
                closeCode = code;
            });

            ws.on('error', () => {
                // Expected
            });

            setTimeout(() => {
                if (closeCode === 1008 || ws.readyState === WebSocket.CLOSED) {
                    resolve();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('WebSocket should have been closed without siteId'));
                } else {
                    resolve();
                }
            }, 1000);
        });

        // Missing token
        const promise2 = new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${WS_PORT}?siteId=${generateSiteId('a')}`);

            let closeCode = null;

            ws.on('close', (code) => {
                closeCode = code;
            });

            ws.on('error', () => {
                // Expected
            });

            setTimeout(() => {
                if (closeCode === 1008 || ws.readyState === WebSocket.CLOSED) {
                    resolve();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('WebSocket should have been closed without token'));
                } else {
                    resolve();
                }
            }, 1000);
        });

        await promise1;
        await promise2;
    });
});

describe('Sync Poke Notification', () => {
    let app, server, wss, clients;
    let testUser, otherUser;
    let serverUrl;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
        wss = result.wss;
        clients = result.clients;

        // Start server on test port
        return new Promise((resolve) => {
            server.listen(WS_PORT + 1, () => {
                serverUrl = `http://localhost:${WS_PORT + 1}`;
                resolve();
            });
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
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should notify other clients of the same user when changes are pushed', async () => {
        const token = getTestToken(testUser.userId);
        const siteIdA = generateSiteId('a');
        const siteIdB = generateSiteId('b');

        return new Promise((resolve, reject) => {
            let clientAOpen = false;
            let clientBOpen = false;
            let clientBReceivedMessage = false;

            // Connect Client A
            const wsA = new WebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdA}`);

            wsA.on('open', () => {
                clientAOpen = true;
                checkAndProceed();
            });

            wsA.on('error', reject);

            // Connect Client B (same user, different siteId)
            const wsB = new WebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdB}`);

            wsB.on('open', () => {
                clientBOpen = true;
                checkAndProceed();
            });

            wsB.on('message', (data) => {
                const message = JSON.parse(data.toString());
                if (message.type === 'sync') {
                    clientBReceivedMessage = true;
                    wsA.close();
                    wsB.close();
                    resolve();
                }
            });

            wsB.on('error', reject);

            async function checkAndProceed() {
                if (clientAOpen && clientBOpen) {
                    // Both clients connected, now push changes from Client A
                    try {
                        // Send a dummy change to trigger the notification
                        await request(app)
                            .post('/sync')
                            .set('Authorization', `Bearer ${token}`)
                            .send({
                                since: 0,
                                siteId: siteIdA,
                                changes: [
                                    {
                                        table: 'notes',
                                        pk: JSON.stringify(['test-note-id']),
                                        cid: 'title',
                                        val: 'Test Note',
                                        col_version: 1,
                                        db_version: 1,
                                        site_id: siteIdA,
                                        cl: 1,
                                        seq: 0
                                    }
                                ]
                            });

                        // Give some time for WebSocket message to arrive
                        setTimeout(() => {
                            if (!clientBReceivedMessage) {
                                wsA.close();
                                wsB.close();
                                reject(new Error('Client B did not receive sync notification'));
                            }
                        }, 2000);
                    } catch (error) {
                        wsA.close();
                        wsB.close();
                        reject(error);
                    }
                }
            }

            setTimeout(() => {
                wsA.close();
                wsB.close();
                reject(new Error('Test timeout'));
            }, 10000);
        });
    }, 15000);

    it('should NOT notify the client that initiated the push', async () => {
        const token = getTestToken(testUser.userId);
        const siteIdA = generateSiteId('a');

        return new Promise((resolve, reject) => {
            let clientAReceivedMessage = false;

            const wsA = new WebSocket(`ws://localhost:${WS_PORT + 1}?token=${token}&siteId=${siteIdA}`);

            wsA.on('open', async () => {
                // Push changes from Client A
                try {
                    await request(app)
                        .post('/sync')
                        .set('Authorization', `Bearer ${token}`)
                        .send({
                            since: 0,
                            siteId: siteIdA,
                            changes: []
                        });

                    // Wait to ensure no message is received
                    setTimeout(() => {
                        if (!clientAReceivedMessage) {
                            wsA.close();
                            resolve();
                        } else {
                            wsA.close();
                            reject(new Error('Client A should not have received a sync notification'));
                        }
                    }, 2000);
                } catch (error) {
                    wsA.close();
                    reject(error);
                }
            });

            wsA.on('message', () => {
                clientAReceivedMessage = true;
            });

            wsA.on('error', reject);

            setTimeout(() => {
                wsA.close();
                reject(new Error('Test timeout'));
            }, 10000);
        });
    }, 15000);

    it('should NOT notify clients of other users', async () => {
        const tokenUser = getTestToken(testUser.userId);
        const tokenOther = getTestToken(otherUser.userId);
        const siteIdA = generateSiteId('a');
        const siteIdC = generateSiteId('c');

        return new Promise((resolve, reject) => {
            let clientAOpen = false;
            let clientCOpen = false;
            let clientCReceivedMessage = false;

            // Connect Client A (testUser)
            const wsA = new WebSocket(`ws://localhost:${WS_PORT + 1}?token=${tokenUser}&siteId=${siteIdA}`);

            wsA.on('open', () => {
                clientAOpen = true;
                checkAndProceed();
            });

            wsA.on('error', reject);

            // Connect Client C (otherUser)
            const wsC = new WebSocket(`ws://localhost:${WS_PORT + 1}?token=${tokenOther}&siteId=${siteIdC}`);

            wsC.on('open', () => {
                clientCOpen = true;
                checkAndProceed();
            });

            wsC.on('message', () => {
                clientCReceivedMessage = true;
            });

            wsC.on('error', reject);

            async function checkAndProceed() {
                if (clientAOpen && clientCOpen) {
                    // Push changes from Client A (testUser)
                    try {
                        await request(app)
                            .post('/sync')
                            .set('Authorization', `Bearer ${tokenUser}`)
                            .send({
                                since: 0,
                                siteId: siteIdA,
                                changes: []
                            });

                        // Wait to ensure Client C doesn't receive a message
                        setTimeout(() => {
                            if (!clientCReceivedMessage) {
                                wsA.close();
                                wsC.close();
                                resolve();
                            } else {
                                wsA.close();
                                wsC.close();
                                reject(new Error('Client C should not have received a sync notification'));
                            }
                        }, 2000);
                    } catch (error) {
                        wsA.close();
                        wsC.close();
                        reject(error);
                    }
                }
            }

            setTimeout(() => {
                wsA.close();
                wsC.close();
                reject(new Error('Test timeout'));
            }, 10000);
        });
    }, 15000);
});
