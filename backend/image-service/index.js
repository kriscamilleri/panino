// /backend/image-service/index.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors({
    origin: true,
    credentials: true
}));

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';
const PORT = process.env.PORT || 3001;

// Configure multer for handling file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, { audience: 'powersync' }, (err, payload) => {
        if (err) {
            console.error('JWT Verification Error:', err.message);
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        req.user = payload; // payload contains { user_id, ... }
        next();
    });
};

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Image service is running (Postgres Edition)');
});

// POST /images - Upload an image
app.post('/images', authenticateToken, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const { user_id } = req.user;
    if (!user_id) {
        return res.status(401).json({ error: 'Unauthorized: Invalid user in token' });
    }

    const { originalname, mimetype, buffer } = req.file;

    try {
        const result = await pool.query(
            'INSERT INTO images (user_id, filename, mime_type, data) VALUES ($1, $2, $3, $4) RETURNING id',
            [user_id, originalname, mimetype, buffer]
        );

        const imageId = result.rows[0].id;
        res.status(201).json({
            id: imageId,
            url: `/images/${imageId}`
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({
            error: 'Upload failed',
            details: error.message
        });
    }
});

// GET /images/:id - Serve an image
app.get('/images/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.user;

    try {
        const result = await pool.query(
            'SELECT mime_type, data FROM images WHERE id = $1 AND user_id = $2',
            [id, user_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Image not found or access denied' });
        }

        const image = result.rows[0];
        res.set('Content-Type', image.mime_type);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.send(image.data);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({
            error: 'Failed to serve image',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Image service listening on port ${PORT}`);
});