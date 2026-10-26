/**
 * The user's Odoo connection: save (after verifying), status, re-check, remove.
 * Spec: docs/specs/active/odoo-integration.md.
 *
 * Off unless ODOO_INTEGRATION_ENABLED is "true" and ODOO_CREDENTIAL_ENCRYPTION_KEY
 * is set; the routes answer 404 otherwise. Only public addresses over https are
 * reachable, except hosts the operator lists in ODOO_ALLOWED_PRIVATE_HOSTS, which
 * may also be private and use plain http (a self-hosted Odoo, the dev containers).
 */

import express from 'express';
import { getUserDb } from './db.js';
import { isPublicAddress } from './safeFetch.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { OdooError, createOdooClient, normalizeBaseUrl, verifyConnection } from './odooClient.js';

export const odooRoutes = express.Router();

const MIN_ENCRYPTION_KEY_LENGTH = 32;
const SAVE_ATTEMPTS_PER_WINDOW = 10;
const SAVE_WINDOW_MS = 10 * 60 * 1000;
const saveAttempts = new Map();

const ERROR_MESSAGES = Object.freeze({
    bad_url: 'Enter the address of your Odoo, such as https://yourcompany.odoo.com.',
    blocked: "Panino can't connect to that address. A private network address has to be allowed by the server's administrator.",
    unreachable: "Odoo didn't answer at that address. Check the address and try again.",
    not_odoo: "That address didn't answer like Odoo. Check the address and the database name.",
    not_odoo_19: 'Panino works with Odoo 19 or later.',
    key_rejected: 'Odoo rejected the API key. Check it, or create a new one in Odoo under Preferences → Account Security.',
    access_denied: "Your Odoo user doesn't have access to this.",
    missing_app: 'None of Documents, Knowledge, CRM or Sales is available to this Odoo user.',
    too_large: 'Odoo sent back more than Panino accepts.',
    upload_corrupt: 'Odoo did not store the file correctly.',
    odoo_error: 'Odoo reported an error. Try again later.',
});

/** @returns {boolean} */
export function isOdooIntegrationEnabled() {
    return process.env.ODOO_INTEGRATION_ENABLED === 'true'
        && String(process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY || '').length >= MIN_ENCRYPTION_KEY_LENGTH;
}

/** Hostnames from ODOO_ALLOWED_PRIVATE_HOSTS, lower-cased. */
export function allowedPrivateHosts() {
    return new Set(String(process.env.ODOO_ALLOWED_PRIVATE_HOSTS || '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean));
}

/** The address policy for Odoo requests: public, or a host the operator allowed. */
function isAllowedOdooAddress(ip, hostname) {
    return isPublicAddress(ip) || allowedPrivateHosts().has(String(hostname).toLowerCase());
}

/**
 * A client for a connection, under the server's address policy.
 *
 * @param {{ baseUrl: string, databaseName?: string, apiKey: string }} connection
 */
export function odooClientFor(connection) {
    return createOdooClient(connection, {
        isAllowedAddress: isAllowedOdooAddress,
        allowHttpHosts: allowedPrivateHosts(),
    });
}

function encryptionKey() {
    return process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY;
}

function maskUserId(userId) {
    const value = String(userId ?? '');
    return value.length <= 4 ? '****' : `${value.slice(0, 2)}…${value.slice(-2)}`;
}

function logFailure(event, userId, error) {
    console.warn('[odoo]', JSON.stringify({
        event,
        user: maskUserId(userId),
        code: error instanceof OdooError ? error.code : 'internal',
        status: error?.status,
        odooName: error?.odooName,
    }));
}

function sendOdooError(res, error) {
    const code = error instanceof OdooError ? error.code : 'odoo_error';
    return res.status(400).json({ error: code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES.odoo_error });
}

function readConnection(db) {
    return db.prepare('SELECT * FROM odoo_connection WHERE singleton = 1').get() || null;
}

/** The status the client sees. Never includes the key. */
function statusPayload(row) {
    if (!row) return { connected: false };
    let apps;
    try {
        apps = JSON.parse(row.apps);
    } catch {
        apps = [];
    }
    return {
        connected: true,
        baseUrl: row.base_url,
        databaseName: row.database_name,
        keyExpiresOn: row.key_expires_on,
        odooUserName: row.odoo_user_name,
        odooVersion: row.odoo_version,
        apps,
        lastVerifiedAt: row.last_verified_at,
        lastError: row.last_error,
        lastErrorMessage: row.last_error ? (ERROR_MESSAGES[row.last_error] || ERROR_MESSAGES.odoo_error) : null,
    };
}

function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validate the PUT body. Returns the cleaned values or an error message.
 *
 * @returns {{ ok: true, value: object } | { ok: false, message: string }}
 */
export function validateConnectionInput(body) {
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey.length < 16 || apiKey.length > 256 || !/^[\x21-\x7e]+$/.test(apiKey)) {
        return { ok: false, message: 'Paste the API key exactly as Odoo showed it.' };
    }
    const databaseName = typeof body?.databaseName === 'string' ? body.databaseName.trim() : '';
    if (databaseName.length > 128 || !/^[A-Za-z0-9_.-]*$/.test(databaseName)) {
        return { ok: false, message: 'The database name can only contain letters, digits, dots, dashes and underscores.' };
    }
    const keyExpiresOn = typeof body?.keyExpiresOn === 'string' && body.keyExpiresOn.trim() ? body.keyExpiresOn.trim() : null;
    if (keyExpiresOn && !isValidIsoDate(keyExpiresOn)) {
        return { ok: false, message: 'Enter the key’s expiry date as shown in Odoo.' };
    }
    let baseUrl;
    try {
        baseUrl = normalizeBaseUrl(body?.baseUrl, { allowHttpHosts: allowedPrivateHosts() });
    } catch {
        return { ok: false, message: ERROR_MESSAGES.bad_url };
    }
    return { ok: true, value: { baseUrl, databaseName, apiKey, keyExpiresOn } };
}

/** At most SAVE_ATTEMPTS_PER_WINDOW connection checks per user per window. */
function allowAttempt(userId, now = Date.now()) {
    const recent = (saveAttempts.get(userId) || []).filter((at) => now - at < SAVE_WINDOW_MS);
    if (recent.length >= SAVE_ATTEMPTS_PER_WINDOW) {
        saveAttempts.set(userId, recent);
        return false;
    }
    recent.push(now);
    saveAttempts.set(userId, recent);
    return true;
}

/** Test seam: forget rate-limit history. */
export function resetOdooRateLimits() {
    saveAttempts.clear();
}

odooRoutes.use('/integrations/odoo', (req, res, next) => {
    if (!isOdooIntegrationEnabled()) return res.status(404).json({ error: 'Not found' });
    return next();
});

odooRoutes.get('/integrations/odoo', (req, res) => {
    try {
        res.json(statusPayload(readConnection(getUserDb(req.user.user_id))));
    } catch (error) {
        console.error('[odoo] Failed to load the connection:', error);
        res.status(500).json({ error: 'Failed to load the Odoo connection' });
    }
});

odooRoutes.put('/integrations/odoo', async (req, res) => {
    const userId = req.user.user_id;
    const input = validateConnectionInput(req.body);
    if (!input.ok) return res.status(400).json({ error: 'invalid', message: input.message });
    if (!allowAttempt(userId)) {
        return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' });
    }

    const { baseUrl, databaseName, apiKey, keyExpiresOn } = input.value;
    let verified;
    try {
        verified = await verifyConnection(odooClientFor({ baseUrl, databaseName, apiKey }));
        if (verified.apps.length === 0) throw new OdooError('missing_app');
    } catch (error) {
        logFailure('connect_failed', userId, error);
        if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error while connecting:', error);
        return sendOdooError(res, error);
    }

    try {
        const db = getUserDb(userId);
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO odoo_connection (singleton, base_url, database_name, api_key_enc, key_expires_on,
                odoo_uid, odoo_user_name, odoo_version, apps, created_at, last_verified_at, last_error)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(singleton) DO UPDATE SET
                base_url = excluded.base_url,
                database_name = excluded.database_name,
                api_key_enc = excluded.api_key_enc,
                key_expires_on = excluded.key_expires_on,
                odoo_uid = excluded.odoo_uid,
                odoo_user_name = excluded.odoo_user_name,
                odoo_version = excluded.odoo_version,
                apps = excluded.apps,
                last_verified_at = excluded.last_verified_at,
                last_error = NULL
        `).run(
            baseUrl, databaseName, encryptSecret(apiKey, encryptionKey()), keyExpiresOn,
            verified.uid, verified.userName, verified.version, JSON.stringify(verified.apps), now, now,
        );
        res.json(statusPayload(readConnection(db)));
    } catch (error) {
        console.error('[odoo] Failed to save the connection:', error);
        res.status(500).json({ error: 'Failed to save the Odoo connection' });
    }
});

odooRoutes.post('/integrations/odoo/check', async (req, res) => {
    const userId = req.user.user_id;
    let db;
    let row;
    try {
        db = getUserDb(userId);
        row = readConnection(db);
    } catch (error) {
        console.error('[odoo] Failed to load the connection:', error);
        return res.status(500).json({ error: 'Failed to load the Odoo connection' });
    }
    if (!row) return res.status(404).json({ error: 'not_connected', message: 'Odoo is not connected.' });
    if (!allowAttempt(userId)) {
        return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' });
    }

    let apiKey;
    try {
        apiKey = decryptSecret(row.api_key_enc, encryptionKey());
    } catch {
        // Encrypted under another key: the server's key changed. Ask for the key again.
        db.prepare("UPDATE odoo_connection SET last_error = 'key_rejected' WHERE singleton = 1").run();
        return res.json(statusPayload(readConnection(db)));
    }

    const now = new Date().toISOString();
    try {
        const verified = await verifyConnection(odooClientFor({ baseUrl: row.base_url, databaseName: row.database_name, apiKey }));
        db.prepare(`
            UPDATE odoo_connection
               SET odoo_uid = ?, odoo_user_name = ?, odoo_version = ?, apps = ?, last_verified_at = ?, last_error = NULL
             WHERE singleton = 1
        `).run(verified.uid, verified.userName, verified.version, JSON.stringify(verified.apps), now);
    } catch (error) {
        logFailure('check_failed', userId, error);
        if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error while checking:', error);
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        db.prepare('UPDATE odoo_connection SET last_error = ? WHERE singleton = 1').run(code);
    }
    res.json(statusPayload(readConnection(db)));
});

odooRoutes.delete('/integrations/odoo', (req, res) => {
    try {
        getUserDb(req.user.user_id).prepare('DELETE FROM odoo_connection WHERE singleton = 1').run();
        res.status(204).end();
    } catch (error) {
        console.error('[odoo] Failed to remove the connection:', error);
        res.status(500).json({ error: 'Failed to remove the Odoo connection' });
    }
});
