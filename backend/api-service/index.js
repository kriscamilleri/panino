// /backend/api-service/index.js
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { authRoutes, authenticateToken } from './auth.js';
import { syncRoutes } from './sync.js';
import { imageRoutes, startImageOrphanPruneJob } from './image.js';
import { pdfRoutes } from './pdf.js'; // Import the new route
import { signupRoutes } from './signup.js';
import { passwordResetRoutes } from './passwordReset.js';
import { backupPublicRoutes, backupRoutes } from './backup.js';
import { initDb } from './db.js';
import { revisionRoutes, startRevisionMaintenanceJob } from './revision.js';
import { attachWebSocketHandlers } from './websocket.js';
import { spaceRoutes } from './spaces.js';

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
export function createApp() {
    const app = express();

    // Add CORP header to all responses to comply with frontend's COEP policy
    app.use((req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
    });

    const server = createServer(app); // Create an HTTP server
    const wss = new WebSocketServer({ server }); // Create a WebSocket server

    const clients = new Map();

    attachWebSocketHandlers(wss, clients, JWT_SECRET);

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
    app.use(spaceRoutes);
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
