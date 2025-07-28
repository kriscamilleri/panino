// /backend/api-service/passwordReset.js
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAuthDb } from './db.js';
import { sendPasswordResetEmail } from './mailer.js';

export const passwordResetRoutes = express.Router();

// POST /forgot-password
passwordResetRoutes.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const db = getAuthDb();
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

            db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
                .run(tokenHash, user.id, expiresAt);

            // Asynchronously send the email
            sendPasswordResetEmail(email, token);
        }
        // Always return a success message to prevent email enumeration
        res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /reset-password
passwordResetRoutes.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const db = getAuthDb();
        const resetRequest = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(tokenHash);

        if (!resetRequest || new Date() > new Date(resetRequest.expires_at)) {
            db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);
            return res.status(400).json({ error: 'Invalid or expired password reset token.' });
        }

        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, resetRequest.user_id);
        db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(tokenHash);

        res.json({ message: 'Password has been reset successfully.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});