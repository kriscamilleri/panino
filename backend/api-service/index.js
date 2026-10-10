// /backend/api-service/index.js
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { URL } from 'url';

import { authRoutes, authenticateToken } from './auth.js';
import { syncRoutes } from './sync.js';
import { imageRoutes, startImageOrphanPruneJob } from './image.js';
import { pdfRoutes } from './pdf.js'; // Import the new route
import { signupRoutes } from './signup.js';
import { passwordResetRoutes } from './passwordReset.js';
import { backupPublicRoutes, backupRoutes } from './backup.js';
import { initDb } from './db.js';
import { revisionRoutes, startRevisionMaintenanceJob } from './revision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

initDb();
startImageOrphanPruneJob();
startRevisionMaintenanceJob();

const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-for-dev';

/**
 * Create and configure the Express app with WebSocket support
 * @returns {Object} { app, server, wss, clients }
 */
const MAX_WS_MESSAGE_BYTES = 1024 * 1024;

export function createApp() {
    const app = express();

    // Add CORP header to all responses to comply with frontend's COEP policy
    app.use((req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
    });

    const server = createServer(app); // Create an HTTP server
    // Clients send nothing on this socket; it only carries the server's sync
    // notices. Without maxPayload the library buffers frames of up to 100 MiB.
    const wss = new WebSocketServer({ server, maxPayload: MAX_WS_MESSAGE_BYTES });

    const clients = new Map();

    // The `ws` library emits "error" on a socket when a peer breaks the
    // protocol (a malformed frame, an oversized one). An EventEmitter with no
    // "error" listener throws, and nothing catches it: one such frame, from a
    // client that has not even authenticated, exited the whole process. The
    // listener is attached before anything else for that reason; the library
    // closes the socket itself afterwards.
    wss.on('error', (error) => {
        console.error('[websocket] server error:', error?.code || 'unknown error');
    });

    wss.on('connection', (ws, req) => {
        ws.on('error', (error) => {
            console.warn('[websocket] socket error:', error?.code || 'unknown error');
        });
        console.log('WebSocket client connected');
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const token = params.get('token');
        const siteId = params.get('siteId');

        if (!token || !siteId) return ws.close(1008, 'Token and siteId required');

        jwt.verify(token, JWT_SECRET, (err, payload) => {
            if (err) return ws.close(1008, 'Invalid token');

            const userId = payload.user_id;
            clients.set(ws, { userId, siteId });
            console.log(`Client associated with user_id: ${userId} and siteId: ${siteId}`);

            ws.on('close', () => {
                clients.delete(ws);
                console.log(`Client for user_id: ${userId} with siteId: ${siteId} disconnected`);
            });
        });
    });

    // Middleware to attach WebSocket server and clients to requests
    app.use((req, res, next) => {
        req.wss = wss;
        req.clients = clients;
        next();
    });

    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    // --- Routes ---
    // Public routes
    app.use(signupRoutes);
    app.use(passwordResetRoutes);
    app.use(backupPublicRoutes);

    // Routes that are mixed public/private
    app.use(authRoutes);

    // Authenticated routes
    app.use(authenticateToken);
    app.use(syncRoutes);
    app.use(imageRoutes);
    app.use(pdfRoutes); // Mount the new PDF route
    app.use(backupRoutes);
    app.use(revisionRoutes);

    return { app, server, wss, clients };
}

// Only start the server if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
    const { server } = createApp();
    server.listen(PORT, () => {
        console.log(`API and WebSocket services listening on port ${PORT}`);
    });
}