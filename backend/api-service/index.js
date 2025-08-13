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
import { imageRoutes } from './image.js';
import { signupRoutes } from './signup.js';
import { passwordResetRoutes } from './passwordReset.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

initDb();

const app = express();

// Add CORP header to all responses to comply with frontend's COEP policy
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

const server = createServer(app); // Create an HTTP server
const wss = new WebSocketServer({ server }); // Create a WebSocket server

const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-for-dev';

const clients = new Map();

wss.on('connection', (ws, req) => {
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

// Routes that are mixed public/private
app.use(authRoutes);

// Authenticated routes
app.use(authenticateToken);
app.use(syncRoutes);
app.use(imageRoutes);

// Use the server to listen, not the app
server.listen(PORT, () => {
    console.log(`API and WebSocket services listening on port ${PORT}`);
});