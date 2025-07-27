// /backend/api-service/signup.js
import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { getAuthDb } from './db.js';

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
    const { email, password, 'cf-turnstile-response': turnstileToken } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!(await verifyTurnstile(turnstileToken))) {
        return res.status(400).json({ error: 'Captcha verification failed' });
    }

    try {
        const db = getAuthDb();
        const password_hash = bcrypt.hashSync(password, 10);
        const userId = uuidv4();

        const stmt = db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)');
        stmt.run(userId, email, password_hash);

        res.status(201).json({ ok: true, message: 'User created successfully', userId });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'User with this email already exists' });
        }
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});