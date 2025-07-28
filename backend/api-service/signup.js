// /backend/api-service/signup.js
import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { getAuthDb, getUserDb } from './db.js';

export const signupRoutes = express.Router();
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

async function verifyTurnstile(token) {
    if (!TURNSTILE_SECRET_KEY) return true; // Skip if no key
    const verifyURL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    const res = await fetch(verifyURL, { method: 'POST', body: formData });
    const data = await res.json();
    return data.success;
}

// POST /signup
signupRoutes.post('/signup', async (req, res) => {
    const { name, email, password, 'cf-turnstile-response': turnstileToken } = req.body;
    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!(await verifyTurnstile(turnstileToken))) {
        return res.status(400).json({ error: 'Captcha verification failed' });
    }

    try {
        const db = getAuthDb();
        const password_hash = bcrypt.hashSync(password, 10);
        const userId = uuidv4();
        const createdAt = new Date().toISOString();

        const stmt = db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(userId, name, email, password_hash, createdAt);

        // Pre-populate the user's own database to ensure the user record exists for sync
        try {
            const userDb = getUserDb(userId);
            const userStmt = userDb.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)');
            userStmt.run(userId, name, email, createdAt);
        } catch (e) {
            console.error(`Could not pre-populate user data for ${userId}:`, e);
        }


        res.status(201).json({ ok: true, message: 'User created successfully', userId });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'User with this email already exists' });
        }
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});