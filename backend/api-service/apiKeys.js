// /backend/api-service/apiKeys.js
// Personal API keys: management routes (session only) and the middleware that
// authenticates the v1 API (docs/specs/active/llm-api.md §5).
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb, isDatabaseBusyError, respondDatabaseBusy } from './db.js';
import {
    MAX_ACTIVE_API_KEYS,
    bearerFromHeader,
    createRateLimiter,
    expiryFromDays,
    generateApiKey,
    hashApiKey,
    isExpired,
    looksLikeApiKey,
    scopeAllows,
    validateCreateKeyInput,
} from './apiKeyUtils.js';

export const apiKeyRoutes = express.Router();

const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;
export const API_RATE_LIMIT_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 120;

export const apiRateLimiter = createRateLimiter({ limit: API_RATE_LIMIT_PER_MINUTE, windowMs: 60 * 1000 });
const lastUsedWrites = new Map();

/**
 * Public shape of a key row. Never includes the hash.
 * @param {object} row
 * @param {Date} [now]
 */
export function publicApiKey(row, now = new Date()) {
    return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scope: row.scope,
        spaceAccess: row.space_access,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        expired: isExpired(row.expires_at, now),
    };
}

function pruneRevokedKeys(db, userId, now = new Date()) {
    const cutoff = new Date(now.getTime() - REVOKED_RETENTION_MS).toISOString();
    db.prepare('DELETE FROM api_keys WHERE user_id = ? AND revoked_at IS NOT NULL AND revoked_at < ?').run(userId, cutoff);
}

function listActiveKeys(db, userId) {
    return db.prepare(`
        SELECT id, name, prefix, scope, space_access, created_at, expires_at, last_used_at
          FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC, id DESC
    `).all(userId);
}

// GET /api-keys — the caller's keys that are not revoked.
apiKeyRoutes.get('/api-keys', (req, res) => {
    try {
        const db = getAuthDb();
        const now = new Date();
        res.json({ keys: listActiveKeys(db, req.user.user_id).map((row) => publicApiKey(row, now)), limit: MAX_ACTIVE_API_KEYS });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[api-keys] list failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not load API keys.' });
    }
});

// POST /api-keys — create a key; the full key is in this response only.
apiKeyRoutes.post('/api-keys', (req, res) => {
    const parsed = validateCreateKeyInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: 'INVALID_INPUT' });

    try {
        const db = getAuthDb();
        const userId = req.user.user_id;
        const now = new Date();
        const { key, hash, prefix } = generateApiKey();
        const id = uuidv4();

        const create = db.transaction(() => {
            pruneRevokedKeys(db, userId, now);
            // An expired key still counts until it is revoked, so the list the
            // user sees and the limit agree.
            const { count } = db.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').get(userId);
            if (count >= MAX_ACTIVE_API_KEYS) return false;
            db.prepare(`
                INSERT INTO api_keys (id, user_id, name, prefix, token_hash, scope, space_access, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, userId, parsed.value.name, prefix, hash, parsed.value.scope, parsed.value.spaceAccess,
                now.toISOString(), expiryFromDays(parsed.value.expiresInDays, now));
            return true;
        });

        if (!create()) {
            return res.status(409).json({
                error: `You can have at most ${MAX_ACTIVE_API_KEYS} API keys. Revoke one first.`,
                code: 'API_KEY_LIMIT',
            });
        }
        const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
        res.status(201).json({ key: publicApiKey(row, now), secret: key });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[api-keys] create failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not create the API key.' });
    }
});

// DELETE /api-keys/:id — revoke one of the caller's keys.
apiKeyRoutes.delete('/api-keys/:id', (req, res) => {
    try {
        const db = getAuthDb();
        const result = db.prepare(`
            UPDATE api_keys SET revoked_at = ?
             WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        `).run(new Date().toISOString(), String(req.params.id), req.user.user_id);
        if (result.changes === 0) return res.status(404).json({ error: 'API key not found.', code: 'NOT_FOUND' });
        lastUsedWrites.delete(String(req.params.id));
        res.json({ revoked: true });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[api-keys] revoke failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not revoke the API key.' });
    }
});

function refuse(res, status, code, error) {
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="panino-api"');
    return res.status(status).json({ error, code });
}

/**
 * Authenticate a v1 request with `Authorization: Bearer pnk_…`. Sets
 * `req.user = { user_id }` and `req.apiKey`. Session JWTs are refused here,
 * as API keys are everywhere else. Unknown, revoked and expired keys get the
 * same answer.
 */
export function authenticateApiKey(req, res, next) {
    const credential = bearerFromHeader(req.headers.authorization);
    if (!credential) {
        return refuse(res, 401, 'API_KEY_REQUIRED', 'Send an API key as "Authorization: Bearer pnk_…". Create one in Panino under Settings → API keys.');
    }
    if (!looksLikeApiKey(credential)) {
        return refuse(res, 401, 'INVALID_API_KEY', 'This API accepts Panino API keys (pnk_…) only.');
    }

    let row;
    try {
        row = getAuthDb().prepare(`
            SELECT k.id, k.user_id, k.name, k.scope, k.space_access, k.expires_at, k.revoked_at, k.last_used_at,
                   u.id AS owner_id
              FROM api_keys k
              LEFT JOIN users u ON u.id = k.user_id
             WHERE k.token_hash = ?
        `).get(hashApiKey(credential));
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[api-keys] lookup failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
    }

    const now = new Date();
    if (!row || row.revoked_at || !row.owner_id || isExpired(row.expires_at, now)) {
        return refuse(res, 401, 'INVALID_API_KEY', 'This API key is not valid. It may have been revoked or have expired.');
    }

    const limit = apiRateLimiter.hit(row.id);
    if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many requests. Slow down and retry.', code: 'RATE_LIMITED' });
    }

    touchLastUsed(row.id, now);
    req.user = { user_id: row.user_id };
    req.apiKey = { id: row.id, name: row.name, scope: row.scope, spaceAccess: row.space_access, expiresAt: row.expires_at };
    next();
}

function touchLastUsed(keyId, now) {
    const previous = lastUsedWrites.get(keyId) || 0;
    if (now.getTime() - previous < LAST_USED_WRITE_INTERVAL_MS) return;
    lastUsedWrites.set(keyId, now.getTime());
    try {
        getAuthDb().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now.toISOString(), keyId);
    } catch (error) {
        // Bookkeeping only; never fail the request over it.
        console.warn('[api-keys] could not record last use:', error?.code || 'unknown');
    }
}

/**
 * Route guard: the key must carry `scope` ('read' or 'write').
 * @param {'read'|'write'} scope
 */
export function requireScope(scope) {
    return (req, res, next) => {
        if (scopeAllows(req.apiKey?.scope, scope)) return next();
        return res.status(403).json({ error: 'This API key is read-only.', code: 'INSUFFICIENT_SCOPE' });
    };
}

/** Test hook: forget rate-limit windows and last-use throttling. */
export function resetApiKeyState() {
    apiRateLimiter.reset();
    lastUsedWrites.clear();
}
