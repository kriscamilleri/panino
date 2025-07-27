// /backend/api-service/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getAuthDb } from './db.js';

export const authRoutes = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-for-dev';

// POST /login
authRoutes.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ user_id: user.id, sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user_id: user.id });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Middleware to authenticate JWT
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) return res.sendStatus(403);
        req.user = { user_id: payload.user_id };
        next();
    });
};

// GET /me
authRoutes.get('/me', authenticateToken, (req, res) => {
    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});