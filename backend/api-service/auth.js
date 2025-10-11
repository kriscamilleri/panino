// /backend/api-service/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getAuthDb } from './db.js';

export const authRoutes = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-for-dev';

// Middleware to authenticate JWT
export const authenticateToken = (req, res, next) => {
    let token;
    const authHeader = req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
        // Standard case: token from Authorization header
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        // Fallback for requests that cannot set headers (e.g., <img> src)
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        req.user = { user_id: payload.user_id };
        next();
    });
};

// POST /login
authRoutes.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ user_id: user.id, sub: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user_id: user.id });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /refresh - Refresh JWT token
authRoutes.post('/refresh', authenticateToken, (req, res) => {
    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.user_id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Issue a new token
        const token = jwt.sign(
            { user_id: user.id, sub: user.id, name: user.name, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user_id: user.id });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /me - Get current user's profile
authRoutes.get('/me', authenticateToken, (req, res) => {
    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(req.user.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /me/password - Update current user's password
authRoutes.post('/me/password', authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.user_id;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);

        if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
            return res.status(401).json({ error: 'Incorrect current password.' });
        }

        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);

        res.json({ message: 'Password updated successfully.' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});