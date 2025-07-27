// /backend/api-service/image.js
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { getUserDb } from './db.js';

export const imageRoutes = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /images
imageRoutes.post('/images', upload.single('image'), (req, res) => {
    const userId = req.user.user_id;
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const imageId = uuidv4();

    try {
        const db = getUserDb(userId);
        db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(imageId, userId, originalname, mimetype, buffer, new Date().toISOString());

        res.status(201).json({ id: imageId, url: `/images/${imageId}` });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// GET /images/:id
imageRoutes.get('/images/:id', (req, res) => {
    const userId = req.user.user_id;
    const { id } = req.params;

    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT mime_type, data FROM images WHERE id = ? AND user_id = ?').get(id, userId);

        if (!image) {
            return res.status(404).json({ error: 'Image not found or access denied' });
        }

        res.set('Content-Type', image.mime_type);
        res.set('Cache-Control', 'public, max-age=31536000');
        res.send(image.data);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});