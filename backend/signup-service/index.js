// /backend/signup-service/index.js
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import { URLSearchParams } from 'url';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:8000';
const POWERSYNC_SERVICE_URL = process.env.POWERSYNC_SERVICE_URL || 'http://powersync-service:7000';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
   res.send('Sign-up service is running.');
});

async function verifyTurnstile(token) {
   const verifyURL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
   const formData = new URLSearchParams();
   formData.append('secret', TURNSTILE_SECRET_KEY);
   formData.append('response', token);

   const turnstileRes = await fetch(verifyURL, { method: 'POST', body: formData });
   const turnstileData = await turnstileRes.json();
   return turnstileData.success;
}

/**
 * POST /signup
 * Creates a user via auth-service, then registers with powersync-service.
 * Expects JSON body: { email: string, password: string, "cf-turnstile-response": string }
 */
app.post('/signup', async (req, res) => {
   try {
      const { email, password, 'cf-turnstile-response': turnstileToken } = req.body;

      if (!email || !password) {
         return res.status(400).json({ error: 'Missing email or password' });
      }

      // 1. Verify Turnstile if enabled
      if (TURNSTILE_SECRET_KEY) {
         if (!turnstileToken || !(await verifyTurnstile(turnstileToken))) {
            return res.status(400).json({ error: 'Captcha verification failed' });
         }
      }

      // 2. Call auth-service to create the user in Postgres
      const authResponse = await fetch(`${AUTH_SERVICE_URL}/signup`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ email, password }),
      });

      const authData = await authResponse.json();
      if (!authResponse.ok) {
         return res.status(authResponse.status).json({
            error: 'Failed to create user',
            details: authData.error
         });
      }

      const { id: userId } = authData;

      // 3. Call powersync-service to trigger an initial sync for the new user
      // This pre-warms the sync bucket for the user.
      const powerSyncResponse = await fetch(`${POWERSYNC_SERVICE_URL}/v1/users`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ users: [{ id: userId }] }),
      });

      if (!powerSyncResponse.ok) {
         // This is not a fatal error for signup, so we'll just log it.
         // The client will trigger a sync on first login anyway.
         console.warn(`Failed to register user ${userId} with PowerSync service:`, await powerSyncResponse.text());
      }

      // 4. Return success to the client.
      // The client will proceed to log in to get a JWT.
      return res.status(201).json({
         ok: true,
         message: 'User created successfully. Please log in.',
         userId: userId
      });

   } catch (err) {
      console.error('Signup service error:', err);
      res.status(500).json({
         error: 'Internal Server Error',
         reason: err.message
      });
   }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
   console.log(`Signup service listening on port ${port}`);
});