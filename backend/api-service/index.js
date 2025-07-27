// /backend/api-service/index.js
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { authRoutes, authenticateToken } from './auth.js';
import { syncRoutes } from './sync.js';
import { imageRoutes } from './image.js';
import { signupRoutes } from './signup.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize the central users database
initDb();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;

// --- Routes ---
app.use(authRoutes);
app.use(signupRoutes);
// All routes below this require a valid JWT
app.use(authenticateToken);
app.use(syncRoutes);
app.use(imageRoutes);

app.listen(PORT, () => {
    console.log(`API service listening on port ${PORT}`);
});