// /backend/api-service/image.js
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getUserDb } from './db.js';

export const imageRoutes = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This path will resolve to `/app/uploads` inside the Docker container
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure the uploads directory exists on startup
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer to store files on disk
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const fileExt = path.extname(file.originalname);
        const uniqueFilename = `${uuidv4()}${fileExt}`;
        cb(null, uniqueFilename);
    },
});

const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /images
imageRoutes.post('/images', upload.single('image'), (req, res) => {
    const userId = req.user.user_id;
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const { originalname, mimetype, filename } = req.file;
    const imageId = uuidv4();
    const relativePath = filename; // We only store the filename

    try {
        const db = getUserDb(userId);
        db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, path, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(imageId, userId, originalname, mimetype, relativePath, new Date().toISOString());

        res.status(201).json({ id: imageId, url: `/images/${imageId}` });
    } catch (error) {
        console.error('Image upload error:', error);
        // Clean up the orphaned file if the DB insert fails
        fs.unlink(req.file.path, (unlinkErr) => {
            if (unlinkErr) console.error('Error cleaning up orphaned file:', unlinkErr);
        });
        res.status(500).json({ error: 'Upload failed' });
    }
});

// GET /images/:id
imageRoutes.get('/images/:id', (req, res) => {
    const userId = req.user.user_id;
    const { id } = req.params;

    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT mime_type, path FROM images WHERE id = ? AND user_id = ?').get(id, userId);

        if (!image || !image.path) {
            return res.status(404).json({ error: 'Image not found or access denied' });
        }

        const absolutePath = path.join(UPLOADS_DIR, image.path);

        // Security check: Make sure the resolved path is still within the uploads directory
        if (!absolutePath.startsWith(UPLOADS_DIR)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!fs.existsSync(absolutePath)) {
            console.error(`File is in DB but not on disk: ${absolutePath}`);
            return res.status(404).json({ error: 'Image file not found on server' });
        }

        res.set('Content-Type', image.mime_type);
        res.set('Cache-Control', 'public, max-age=31536000');
        res.sendFile(absolutePath);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});