// Personal API keys (docs/specs/active/llm-api.md §5, ai-integration.md §4): the
// management routes (session, behind the add-on gate) and the key lookup that
// agentAuth.js uses for REST and MCP requests.
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb, isDatabaseBusyError, respondDatabaseBusy } from '../../db.js';
import {
    MAX_ACTIVE_API_KEYS,
    expiryFromDays,
    generateApiKey,
    hashApiKey,
    isExpired,
    looksLikeApiKey,
    validateCreateKeyInput,
} from './keyUtils.js';

export const keyRoutes = express.Router();

const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;
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

// GET /addons/ai/keys — the caller's keys that are not revoked.
keyRoutes.get('/keys', (req, res) => {
    try {
        const db = getAuthDb();
        const now = new Date();
        res.json({ keys: listActiveKeys(db, req.user.user_id).map((row) => publicApiKey(row, now)), limit: MAX_ACTIVE_API_KEYS });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:keys] list failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not load API keys.' });
    }
});

// POST /addons/ai/keys — create a key; the full key is in this response only.
keyRoutes.post('/keys', (req, res) => {
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
            const activeNames = db.prepare('SELECT name FROM api_keys WHERE user_id = ? AND revoked_at IS NULL')
                .all(userId).map((row) => row.name);
            if (activeNames.length >= MAX_ACTIVE_API_KEYS) return 'limit';
            // Revision history names the key behind each API edit, so two
            // active keys may not share a name (compared ignoring case).
            const wanted = parsed.value.name.toLowerCase();
            if (activeNames.some((name) => name.toLowerCase() === wanted)) return 'name-taken';
            db.prepare(`
                INSERT INTO api_keys (id, user_id, name, prefix, token_hash, scope, space_access, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, userId, parsed.value.name, prefix, hash, parsed.value.scope, parsed.value.spaceAccess,
                now.toISOString(), expiryFromDays(parsed.value.expiresInDays, now));
            return 'created';
        });

        const outcome = create();
        if (outcome === 'limit') {
            return res.status(409).json({
                error: `You can have at most ${MAX_ACTIVE_API_KEYS} API keys. Revoke one first.`,
                code: 'API_KEY_LIMIT',
            });
        }
        if (outcome === 'name-taken') {
            return res.status(409).json({
                error: 'You already have an API key with this name. Choose another name.',
                code: 'API_KEY_NAME_TAKEN',
            });
        }
        const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
        res.status(201).json({ key: publicApiKey(row, now), secret: key });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:keys] create failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not create the API key.' });
    }
});

// DELETE /addons/ai/keys/:id — revoke one of the caller's keys.
keyRoutes.delete('/keys/:id', (req, res) => {
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
        console.error('[ai:keys] revoke failed:', error?.code || 'unknown');
        res.status(500).json({ error: 'Could not revoke the API key.' });
    }
});

/**
 * Resolve a `pnk_…` key to its owner and access, or null when it is unknown,
 * revoked, expired or orphaned (one answer for all four).
 * @param {string} credential
 * @param {Date} [now]
 * @returns {null | { userId: string, agent: object }}
 */
export function lookupApiKey(credential, now = new Date()) {
    if (!looksLikeApiKey(credential)) return null;
    const row = getAuthDb().prepare(`
        SELECT k.id, k.user_id, k.name, k.scope, k.space_access, k.expires_at, k.revoked_at,
               u.id AS owner_id
          FROM api_keys k
          LEFT JOIN users u ON u.id = k.user_id
         WHERE k.token_hash = ?
    `).get(hashApiKey(credential));
    if (!row || row.revoked_at || !row.owner_id || isExpired(row.expires_at, now)) return null;
    touchLastUsed(row.id, now);
    return {
        userId: row.user_id,
        agent: { kind: 'key', id: row.id, name: row.name, scope: row.scope, spaceAccess: row.space_access, expiresAt: row.expires_at },
    };
}

function touchLastUsed(keyId, now) {
    const previous = lastUsedWrites.get(keyId) || 0;
    if (now.getTime() - previous < LAST_USED_WRITE_INTERVAL_MS) return;
    lastUsedWrites.set(keyId, now.getTime());
    try {
        getAuthDb().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now.toISOString(), keyId);
    } catch (error) {
        // Bookkeeping only; never fail the request over it.
        console.warn('[ai:keys] could not record last use:', error?.code || 'unknown');
    }
}

/** Test hook: forget last-use throttling. */
export function resetApiKeyState() {
    lastUsedWrites.clear();
}
