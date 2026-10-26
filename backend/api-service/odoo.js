/**
 * The user's Odoo connection (save after verifying, status, re-check, remove) and
 * sending a Document to Odoo. Spec: docs/specs/active/odoo-integration.md.
 *
 * Off unless ODOO_INTEGRATION_ENABLED is "true" and ODOO_CREDENTIAL_ENCRYPTION_KEY
 * is set; the routes answer 404 otherwise. Only public addresses over https are
 * reachable, except hosts the operator lists in ODOO_ALLOWED_PRIVATE_HOSTS, which
 * may also be private and use plain http (a self-hosted Odoo, the dev containers).
 */

import express from 'express';
import { getAuthDb, getDb, getUserDb, parseDbKey } from './db.js';
import { isPublicAddress } from './safeFetch.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { OdooError, createOdooClient, normalizeBaseUrl, odooTarget, verifyConnection } from './odooClient.js';
import { searchFolders, sendPdfToDocuments } from './odooDocuments.js';
import { listLinks, readDefaults, saveDefaults } from './odooLinks.js';
import { renderPdf } from './pdf.js';
import { resolveSpaceAccess } from './spaces.js';

export const odooRoutes = express.Router();

const MIN_ENCRYPTION_KEY_LENGTH = 32;
const SAVE_ATTEMPTS_PER_WINDOW = 10;
const SAVE_WINDOW_MS = 10 * 60 * 1000;
const saveAttempts = new Map();
const SENDS_PER_MINUTE = 10;
const sendAttempts = new Map();
const sendsInFlight = new Set();
const MAX_PDF_BYTES = 25 * 1024 * 1024;

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
    upload_corrupt: 'Odoo did not store the file correctly. Send it again.',
    missing_folder: 'Choose a Documents folder.',
    odoo_error: 'Odoo reported an error. Try again later.',
});

/** Messages for the same codes when sending to Documents. */
const DOCUMENTS_MESSAGES = Object.freeze({
    ...ERROR_MESSAGES,
    access_denied: "Your Odoo user can't create or update this document in Odoo Documents.",
    missing_app: "Odoo Documents isn't installed in this Odoo, or your Odoo user can't use it.",
    record_gone: 'The document was removed from Odoo while sending. Send it again.',
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

/** At most SENDS_PER_MINUTE sends per user per minute. */
function allowSend(userId, now = Date.now()) {
    const recent = (sendAttempts.get(userId) || []).filter((at) => now - at < 60000);
    if (recent.length >= SENDS_PER_MINUTE) {
        sendAttempts.set(userId, recent);
        return false;
    }
    recent.push(now);
    sendAttempts.set(userId, recent);
    return true;
}

/** Test seam: forget rate-limit history. */
export function resetOdooRateLimits() {
    saveAttempts.clear();
    sendAttempts.clear();
}

/**
 * The database a Document lives in, if the caller may use it: their own personal
 * database, or a space they belong to (owner or editor to send).
 *
 * @returns {{ db: import('better-sqlite3').Database, dbKey: string } | { status: number }}
 */
function documentDatabase(userId, rawDbKey, { forSending }) {
    let parsed;
    try {
        parsed = parseDbKey(rawDbKey);
    } catch {
        return { status: 400 };
    }
    if (parsed.kind === 'user') {
        if (parsed.id !== String(userId).toLowerCase()) return { status: 404 };
    } else {
        const access = resolveSpaceAccess(parsed.id, userId);
        if (!access) return { status: 404 };
        if (forSending && !['owner', 'editor'].includes(access.role)) return { status: 403 };
    }
    return { db: getDb(parsed.dbKey), dbKey: parsed.dbKey };
}

/**
 * The caller's connection and a client for it, or null when not connected.
 * A key that no longer decrypts is recorded as rejected.
 */
function senderConnection(userId) {
    const userDb = getUserDb(userId);
    const row = readConnection(userDb);
    if (!row) return null;
    let apiKey;
    try {
        apiKey = decryptSecret(row.api_key_enc, encryptionKey());
    } catch {
        userDb.prepare("UPDATE odoo_connection SET last_error = 'key_rejected' WHERE singleton = 1").run();
        throw new OdooError('key_rejected');
    }
    const connection = { baseUrl: row.base_url, databaseName: row.database_name, apiKey };
    return { row, userDb, client: odooClientFor(connection), target: odooTarget(connection) };
}

/** A rejected key is remembered on the connection so Settings shows it. */
function rememberConnectionError(userDb, error) {
    if (error instanceof OdooError && ['key_rejected', 'not_odoo', 'unreachable', 'blocked'].includes(error.code)) {
        userDb.prepare('UPDATE odoo_connection SET last_error = ? WHERE singleton = 1').run(error.code);
    }
}

function baseUrlOfTarget(target) {
    return String(target).split('|')[0];
}

function userNames(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = getAuthDb()
        .prepare(`SELECT id, name FROM users WHERE id IN (${unique.map(() => '?').join(', ')})`)
        .all(...unique);
    return new Map(rows.map((row) => [row.id, row.name]));
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

odooRoutes.get('/integrations/odoo/folders', async (req, res) => {
    const userId = req.user.user_id;
    let sender;
    try {
        sender = senderConnection(userId);
    } catch (error) {
        return sendOdooError(res, error);
    }
    if (!sender) return res.status(404).json({ error: 'not_connected', message: 'Connect Odoo in Settings first.' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    try {
        res.json({ folders: await searchFolders(sender.client, query) });
    } catch (error) {
        logFailure('folders_failed', userId, error);
        rememberConnectionError(sender.userDb, error);
        if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error listing folders:', error);
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        res.status(400).json({ error: code, message: DOCUMENTS_MESSAGES[code] || ERROR_MESSAGES.odoo_error });
    }
});

odooRoutes.get('/integrations/odoo/links', (req, res) => {
    const userId = req.user.user_id;
    const noteId = typeof req.query.noteId === 'string' ? req.query.noteId : '';
    if (!noteId || noteId.length > 100) return res.status(400).json({ error: 'invalid', message: 'A Document is required.' });
    try {
        const access = documentDatabase(userId, req.query.dbKey, { forSending: false });
        if (access.status) return res.status(access.status).json({ error: 'not_found', message: 'Document not found.' });
        const { db } = access;
        const sender = (() => {
            try {
                return senderConnection(userId);
            } catch {
                return null;
            }
        })();
        const links = listLinks(db, noteId);
        const names = userNames(links.flatMap((link) => [link.last_sent_by, link.first_sent_by]));
        res.json({
            links: links.map((link) => ({
                destination: link.destination,
                targetKey: link.target_key,
                sameOdoo: Boolean(sender && link.odoo_target === sender.target),
                url: link.odoo_url_path ? `${baseUrlOfTarget(link.odoo_target)}${link.odoo_url_path}` : null,
                lastSentAt: link.last_sent_at,
                lastSentBy: names.get(link.last_sent_by) || null,
            })),
            defaults: sender ? readDefaults(db, sender.target) : { folderId: null, parentArticleId: null },
        });
    } catch (error) {
        console.error('[odoo] Failed to load links:', error);
        res.status(500).json({ error: 'Failed to load what was sent to Odoo' });
    }
});

odooRoutes.post('/integrations/odoo/send', async (req, res) => {
    const userId = req.user.user_id;
    const { dbKey, noteId, title, pdfRequest, documents } = req.body || {};
    if (typeof noteId !== 'string' || !noteId || noteId.length > 100) {
        return res.status(400).json({ error: 'invalid', message: 'A Document is required.' });
    }
    if (!documents || typeof documents !== 'object') {
        return res.status(400).json({ error: 'invalid', message: 'Choose where to send the Document.' });
    }
    if (!pdfRequest || typeof pdfRequest !== 'object') {
        return res.status(400).json({ error: 'invalid', message: 'The PDF is missing.' });
    }
    const folderId = documents.folderId == null ? null : Number(documents.folderId);
    if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) {
        return res.status(400).json({ error: 'invalid', message: 'Choose a Documents folder.' });
    }

    let access;
    let note;
    let sender;
    try {
        access = documentDatabase(userId, dbKey, { forSending: true });
        if (access.status === 403) {
            return res.status(403).json({ error: 'forbidden', message: 'Only owners and editors of this space can send its Documents.' });
        }
        if (access.status) return res.status(access.status).json({ error: 'not_found', message: 'Document not found.' });
        note = access.db.prepare('SELECT id, title FROM notes WHERE id = ?').get(noteId);
        if (!note) return res.status(404).json({ error: 'not_found', message: 'Document not found.' });
        sender = senderConnection(userId);
    } catch (error) {
        if (error instanceof OdooError) return sendOdooError(res, error);
        console.error('[odoo] Failed to prepare a send:', error);
        return res.status(500).json({ error: 'Failed to send to Odoo' });
    }
    if (!sender) return res.status(409).json({ error: 'not_connected', message: 'Connect Odoo in Settings first.' });

    const lockKey = `${access.dbKey}|${noteId}`;
    if (sendsInFlight.has(lockKey)) {
        return res.status(409).json({ error: 'busy', message: 'This Document is already being sent.' });
    }
    if (!allowSend(userId)) {
        return res.status(429).json({ error: 'rate_limited', message: 'Too many sends. Wait a minute and try again.' });
    }

    sendsInFlight.add(lockKey);
    try {
        const rendered = await renderPdf(pdfRequest, { userId });
        if (!rendered.ok) {
            if (rendered.retryAfterSeconds) res.setHeader('Retry-After', String(rendered.retryAfterSeconds));
            const busy = rendered.status === 503;
            return res.status(busy ? 503 : 422).json({
                error: 'pdf_failed',
                message: busy ? 'PDFs are busy right now. Try again shortly.' : 'The PDF could not be made.',
            });
        }
        if (rendered.pdf.length > MAX_PDF_BYTES) {
            return res.status(413).json({ error: 'too_large', message: 'The PDF is larger than 25 MB.' });
        }

        let result;
        try {
            const sent = await sendPdfToDocuments({
                client: sender.client,
                odooTarget: sender.target,
                db: access.db,
                noteId,
                title: typeof title === 'string' && title.trim() ? title : note.title,
                pdf: rendered.pdf,
                folderId: folderId ?? readDefaults(access.db, sender.target).folderId,
                userId,
            });
            if (folderId) saveDefaults(access.db, sender.target, { folderId });
            result = {
                ok: true,
                created: sent.created,
                recreated: sent.recreated,
                url: sent.urlPath ? `${sender.row.base_url}${sent.urlPath}` : null,
            };
        } catch (error) {
            logFailure('send_documents_failed', userId, error);
            rememberConnectionError(sender.userDb, error);
            if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error sending to Documents:', error);
            const code = error instanceof OdooError ? error.code : 'odoo_error';
            result = { ok: false, error: code, message: DOCUMENTS_MESSAGES[code] || ERROR_MESSAGES.odoo_error };
        }
        return res.json({ documents: result });
    } catch (error) {
        console.error('[odoo] Send failed:', error);
        return res.status(500).json({ error: 'Failed to send to Odoo' });
    } finally {
        sendsInFlight.delete(lockKey);
    }
});
