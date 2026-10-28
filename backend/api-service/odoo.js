/**
 * The user's Odoo connection (save after verifying, status, re-check, remove) and
 * sending a Document to Odoo. Spec: docs/specs/active/odoo-integration.md.
 *
 * An add-on (addons.js): offered only when ODOO_INTEGRATION_ENABLED is "true" and
 * ODOO_CREDENTIAL_ENCRYPTION_KEY is set (the routes answer 404 otherwise), and off
 * for each user until they switch it on in Settings → Add-ons (403 addon_disabled
 * until then). Only public addresses over https are
 * reachable, except hosts the operator lists in ODOO_ALLOWED_PRIVATE_HOSTS, which
 * may also be private and use plain http (a self-hosted Odoo, the dev containers).
 */

import express from 'express';
import { registerAddon, requireAddon } from './addons.js';
import { getAuthDb, getDb, getUserDb, parseDbKey } from './db.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { OdooError, normalizeBaseUrl, verifyConnection } from './odooClient.js';
import {
    allowedPrivateHosts, encryptionKey, odooClientFor, readConnection, rememberConnectionError, senderConnection,
} from './odooConnection.js';
import { CHATTER_MODELS, chatterTargetKey, parseChatterTarget, readRecords, searchRecords, sendPdfToChatter } from './odooChatter.js';
import { pdfFileName, searchFolders, sendPdfToDocuments } from './odooDocuments.js';
import { MAX_ARTICLE_HTML_BYTES, articleBody, searchArticles, sendArticleToKnowledge } from './odooKnowledge.js';
import { listLinks, readDefaults, saveDefaults } from './odooLinks.js';
import { SYNC_SCOPES, createSync, deleteSync, listSyncs, readSync, syncCovering, syncOverlapping } from './odooSync.js';
import { pauseSyncsRunBy, resumeSyncsRunBy, runSyncNow, syncJobStatus } from './odooSyncScheduler.js';
import { readInternalImage, renderPdf } from './pdf.js';
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

/** Messages for the same codes when sending to Knowledge. */
const KNOWLEDGE_MESSAGES = Object.freeze({
    ...ERROR_MESSAGES,
    access_denied: "Your Odoo user can't create or update this article in Odoo Knowledge.",
    missing_app: "Odoo Knowledge isn't installed in this Odoo, or your Odoo user can't use it.",
    record_gone: 'The article was removed from Odoo while sending. Send it again.',
    synced: 'This Document is kept in sync with Knowledge, so it updates on its own.',
});

/** Messages for the same codes when posting on an opportunity or a sales order. */
const CHATTER_MESSAGES = Object.freeze({
    ...ERROR_MESSAGES,
    access_denied: "Your Odoo user can't update this record.",
    missing_app: "This Odoo has no CRM or Sales app your Odoo user can use.",
    record_gone: 'That opportunity or sales order no longer exists in Odoo.',
});

/** @returns {boolean} */
export function isOdooIntegrationEnabled() {
    return process.env.ODOO_INTEGRATION_ENABLED === 'true'
        && String(process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY || '').length >= MIN_ENCRYPTION_KEY_LENGTH;
}

/** The add-on manifest (addons.js). Switching off pauses the person's syncs; on resumes them. */
export const odooAddon = Object.freeze({
    id: 'odoo',
    name: 'Odoo',
    description: 'Send Documents to your Odoo as PDFs or Knowledge articles, or keep a folder in sync with Knowledge. What you send leaves Panino and appears in Odoo under your Odoo user.',
    isOffered: isOdooIntegrationEnabled,
    onDisabled: (userId) => pauseSyncsRunBy(userId, 'addon_disabled'),
    onEnabled: (userId) => resumeSyncsRunBy(userId, 'addon_disabled'),
});
registerAddon(odooAddon);

export { allowedPrivateHosts, odooClientFor };

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

odooRoutes.use('/addons/odoo', requireAddon('odoo'));

odooRoutes.get('/addons/odoo', (req, res) => {
    try {
        res.json(statusPayload(readConnection(getUserDb(req.user.user_id))));
    } catch (error) {
        console.error('[odoo] Failed to load the connection:', error);
        res.status(500).json({ error: 'Failed to load the Odoo connection' });
    }
});

odooRoutes.put('/addons/odoo', async (req, res) => {
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
        for (const reason of ['not_connected', 'key_rejected']) resumeSyncsRunBy(userId, reason);
    } catch (error) {
        console.error('[odoo] Failed to save the connection:', error);
        res.status(500).json({ error: 'Failed to save the Odoo connection' });
    }
});

odooRoutes.post('/addons/odoo/check', async (req, res) => {
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

odooRoutes.delete('/addons/odoo', (req, res) => {
    try {
        getUserDb(req.user.user_id).prepare('DELETE FROM odoo_connection WHERE singleton = 1').run();
        pauseSyncsRunBy(req.user.user_id, 'not_connected');
        res.status(204).end();
    } catch (error) {
        console.error('[odoo] Failed to remove the connection:', error);
        res.status(500).json({ error: 'Failed to remove the Odoo connection' });
    }
});

odooRoutes.get('/addons/odoo/folders', async (req, res) => {
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

odooRoutes.get('/addons/odoo/articles', async (req, res) => {
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
        res.json({ articles: await searchArticles(sender.client, query) });
    } catch (error) {
        logFailure('articles_failed', userId, error);
        rememberConnectionError(sender.userDb, error);
        if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error listing articles:', error);
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        res.status(400).json({ error: code, message: KNOWLEDGE_MESSAGES[code] || ERROR_MESSAGES.odoo_error });
    }
});

odooRoutes.get('/addons/odoo/records', async (req, res) => {
    const userId = req.user.user_id;
    let sender;
    try {
        sender = senderConnection(userId);
    } catch (error) {
        return sendOdooError(res, error);
    }
    if (!sender) return res.status(404).json({ error: 'not_connected', message: 'Connect Odoo in Settings first.' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

    // The records this Document was already sent to come first, when the caller names it.
    let sentTargets = [];
    const noteId = typeof req.query.noteId === 'string' ? req.query.noteId : '';
    if (noteId && noteId.length <= 100 && req.query.dbKey) {
        const access = documentDatabase(userId, req.query.dbKey, { forSending: false });
        if (!access.status) {
            sentTargets = listLinks(access.db, noteId)
                .filter((link) => link.destination === 'chatter' && link.odoo_target === sender.target)
                .map((link) => {
                    const [resModel, resId] = String(link.target_key).split(':');
                    return { resModel, resId: Number(resId) };
                })
                .filter((target) => Object.hasOwn(CHATTER_MODELS, target.resModel) && Number.isInteger(target.resId));
        }
    }

    try {
        const sent = sentTargets.length ? await readRecords(sender.client, sentTargets) : [];
        const sentKeys = new Set(sent.map((record) => chatterTargetKey(record.resModel, record.resId)));
        const found = (await searchRecords(sender.client, sender.apps, query))
            .filter((record) => !sentKeys.has(chatterTargetKey(record.resModel, record.resId)));
        res.json({
            records: [
                ...sent.map((record) => ({ ...record, sent: true })),
                ...found.map((record) => ({ ...record, sent: false })),
            ],
        });
    } catch (error) {
        logFailure('records_failed', userId, error);
        rememberConnectionError(sender.userDb, error);
        if (!(error instanceof OdooError)) console.error('[odoo] Unexpected error listing records:', error);
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        res.status(400).json({ error: code, message: CHATTER_MESSAGES[code] || ERROR_MESSAGES.odoo_error });
    }
});

odooRoutes.get('/addons/odoo/links', (req, res) => {
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
        const sync = syncCovering(db, { sourceType: 'note', sourceId: noteId });
        res.json({
            links: links.map((link) => ({
                destination: link.destination,
                targetKey: link.target_key,
                sameOdoo: Boolean(sender && link.odoo_target === sender.target),
                url: link.odoo_url_path ? `${baseUrlOfTarget(link.odoo_target)}${link.odoo_url_path}` : null,
                lastSentAt: link.last_sent_at,
                lastSentBy: names.get(link.last_sent_by) || null,
                syncId: link.sync_id || null,
            })),
            defaults: sender ? readDefaults(db, sender.target) : { folderId: null, parentArticleId: null },
            sync: sync ? syncPayload(db, sync, access.dbKey) : null,
        });
    } catch (error) {
        console.error('[odoo] Failed to load links:', error);
        res.status(500).json({ error: 'Failed to load what was sent to Odoo' });
    }
});

/**
 * Run one destination and shape its result; an Odoo failure becomes `{ ok: false }`
 * with one of the closed error codes, never a thrown error.
 */
async function destinationResult(run, { userId, userDb, event, messages }) {
    try {
        return { ok: true, ...(await run()) };
    } catch (error) {
        logFailure(event, userId, error);
        rememberConnectionError(userDb, error);
        if (!(error instanceof OdooError)) console.error(`[odoo] Unexpected error (${event}):`, error);
        const code = error instanceof OdooError ? error.code : 'odoo_error';
        return { ok: false, error: code, message: messages[code] || ERROR_MESSAGES.odoo_error };
    }
}

odooRoutes.post('/addons/odoo/send', async (req, res) => {
    const userId = req.user.user_id;
    const { dbKey, noteId, title, pdfRequest, documents, chatter, knowledge } = req.body || {};
    if (typeof noteId !== 'string' || !noteId || noteId.length > 100) {
        return res.status(400).json({ error: 'invalid', message: 'A Document is required.' });
    }
    const wantsDocuments = documents != null;
    const wantsChatter = chatter != null;
    const wantsKnowledge = knowledge != null;
    const wantsPdf = wantsDocuments || wantsChatter;
    if ((!wantsPdf && !wantsKnowledge) || (wantsDocuments && typeof documents !== 'object') || (wantsKnowledge && typeof knowledge !== 'object')) {
        return res.status(400).json({ error: 'invalid', message: 'Choose where to send the Document.' });
    }
    if (wantsPdf && (!pdfRequest || typeof pdfRequest !== 'object')) {
        return res.status(400).json({ error: 'invalid', message: 'The PDF is missing.' });
    }
    if (wantsKnowledge && typeof knowledge.html !== 'string') {
        return res.status(400).json({ error: 'invalid', message: 'The article is missing.' });
    }
    if (wantsKnowledge && Buffer.byteLength(knowledge.html, 'utf8') > MAX_ARTICLE_HTML_BYTES) {
        return res.status(413).json({ error: 'too_large', message: 'The article is larger than Odoo Knowledge accepts.' });
    }
    // `parentId` null or 0 means the top level; it is used only when creating.
    const parentId = wantsKnowledge && knowledge.parentId != null ? Number(knowledge.parentId) : null;
    if (parentId !== null && (!Number.isInteger(parentId) || parentId < 0)) {
        return res.status(400).json({ error: 'invalid', message: 'Choose where in Knowledge the article goes.' });
    }
    const folderId = wantsDocuments && documents.folderId != null ? Number(documents.folderId) : null;
    if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) {
        return res.status(400).json({ error: 'invalid', message: 'Choose a Documents folder.' });
    }
    const target = wantsChatter ? parseChatterTarget(chatter) : null;
    if (wantsChatter && !target.ok) {
        return res.status(400).json({ error: 'invalid', message: 'Choose an opportunity or sales order.' });
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
        let pdf = null;
        if (wantsPdf) {
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
            pdf = rendered.pdf;
        }

        const documentTitle = typeof title === 'string' && title.trim() ? title : note.title;
        const shared = { client: sender.client, odooTarget: sender.target, db: access.db, noteId, pdf, userId };
        const results = {};
        if (wantsKnowledge && syncCovering(access.db, { sourceType: 'note', sourceId: noteId })) {
            results.knowledge = { ok: false, error: 'synced', message: KNOWLEDGE_MESSAGES.synced };
        } else if (wantsKnowledge) {
            results.knowledge = sender.apps.includes('knowledge')
                ? await destinationResult(async () => {
                    const remembered = readDefaults(access.db, sender.target).parentArticleId;
                    const sent = await sendArticleToKnowledge({
                        ...shared,
                        title: documentTitle,
                        body: articleBody(knowledge.html, documentTitle, { keepInternalImages: true }),
                        parentId: parentId ?? remembered,
                        readImage: (src) => readInternalImage(src, userId),
                    });
                    if (parentId !== null) saveDefaults(access.db, sender.target, { parentArticleId: parentId });
                    return {
                        created: sent.created,
                        recreated: sent.recreated,
                        imagesUploaded: sent.imagesUploaded,
                        imagesMissing: sent.imagesMissing,
                        url: sent.urlPath ? `${sender.row.base_url}${sent.urlPath}` : null,
                    };
                }, { userId, userDb: sender.userDb, event: 'send_knowledge_failed', messages: KNOWLEDGE_MESSAGES })
                : { ok: false, error: 'missing_app', message: KNOWLEDGE_MESSAGES.missing_app };
        }
        // One destination after the other: they are independent, and each reports for itself.
        if (wantsDocuments) {
            results.documents = await destinationResult(async () => {
                const sent = await sendPdfToDocuments({
                    ...shared,
                    title: documentTitle,
                    folderId: folderId ?? readDefaults(access.db, sender.target).folderId,
                });
                if (folderId) saveDefaults(access.db, sender.target, { folderId });
                return {
                    created: sent.created,
                    recreated: sent.recreated,
                    url: sent.urlPath ? `${sender.row.base_url}${sent.urlPath}` : null,
                };
            }, { userId, userDb: sender.userDb, event: 'send_documents_failed', messages: DOCUMENTS_MESSAGES });
        }
        if (wantsChatter) {
            const app = CHATTER_MODELS[target.resModel];
            results.chatter = sender.apps.includes(app)
                ? await destinationResult(async () => {
                    const sent = await sendPdfToChatter({
                        ...shared,
                        fileName: pdfFileName(documentTitle),
                        resModel: target.resModel,
                        resId: target.resId,
                    });
                    return {
                        created: sent.created,
                        recreated: sent.recreated,
                        noteMissing: sent.noteMissing,
                        url: `${sender.row.base_url}${sent.urlPath}`,
                    };
                }, { userId, userDb: sender.userDb, event: 'send_chatter_failed', messages: CHATTER_MESSAGES })
                : { ok: false, error: 'missing_app', message: CHATTER_MESSAGES.missing_app };
        }
        return res.json(results);
    } catch (error) {
        console.error('[odoo] Send failed:', error);
        return res.status(500).json({ error: 'Failed to send to Odoo' });
    } finally {
        sendsInFlight.delete(lockKey);
    }
});

// ---------------------------------------------------------------------------
// Syncs (spec §11)
// ---------------------------------------------------------------------------

/** What the client sees of a sync. */
function syncPayload(db, sync, dbKey) {
    let sourceName = null;
    if (sync.scope === 'folder') sourceName = db.prepare('SELECT name FROM folders WHERE id = ?').get(sync.source_id)?.name ?? null;
    if (sync.scope === 'note') sourceName = db.prepare('SELECT title FROM notes WHERE id = ?').get(sync.source_id)?.title ?? null;
    let lastResult;
    try {
        lastResult = sync.last_result ? JSON.parse(sync.last_result) : null;
    } catch {
        lastResult = null;
    }
    const names = userNames([sync.run_as]);
    return {
        id: sync.id,
        scope: sync.scope,
        sourceId: sync.source_id,
        sourceName,
        odooHost: baseUrlOfTarget(sync.odoo_target),
        parentArticleId: sync.parent_article_id,
        runAs: sync.run_as,
        runAsName: names.get(sync.run_as) || null,
        status: sync.status,
        pausedReason: sync.paused_reason,
        lastRunAt: sync.last_run_at,
        lastResult,
        running: syncJobStatus(dbKey, sync.id).running,
        createdAt: sync.created_at,
    };
}

odooRoutes.get('/addons/odoo/syncs', (req, res) => {
    const userId = req.user.user_id;
    try {
        const access = documentDatabase(userId, req.query.dbKey, { forSending: false });
        if (access.status) return res.status(access.status).json({ error: 'not_found', message: 'Database not found.' });
        res.json({ syncs: listSyncs(access.db).map((sync) => syncPayload(access.db, sync, access.dbKey)) });
    } catch (error) {
        console.error('[odoo] Failed to list syncs:', error);
        res.status(500).json({ error: 'Failed to load the syncs' });
    }
});

odooRoutes.post('/addons/odoo/syncs', async (req, res) => {
    const userId = req.user.user_id;
    const { dbKey, scope, sourceId } = req.body || {};
    if (!SYNC_SCOPES.includes(scope) || scope === 'space') {
        return res.status(400).json({ error: 'invalid', message: 'Choose a folder or a Document to keep in sync.' });
    }
    if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 100) {
        return res.status(400).json({ error: 'invalid', message: 'Choose a folder or a Document to keep in sync.' });
    }
    const parentArticleId = req.body?.parentArticleId != null ? Number(req.body.parentArticleId) : null;
    if (parentArticleId !== null && (!Number.isInteger(parentArticleId) || parentArticleId < 0)) {
        return res.status(400).json({ error: 'invalid', message: 'Choose where in Knowledge the articles go.' });
    }

    let access;
    let sender;
    try {
        access = documentDatabase(userId, dbKey, { forSending: true });
        if (access.status === 403) {
            return res.status(403).json({ error: 'forbidden', message: 'Only owners and editors of this space can set up a sync.' });
        }
        if (access.status) return res.status(access.status).json({ error: 'not_found', message: 'Database not found.' });
        const exists = scope === 'folder'
            ? access.db.prepare('SELECT id FROM folders WHERE id = ?').get(sourceId)
            : access.db.prepare('SELECT id FROM notes WHERE id = ?').get(sourceId);
        if (!exists) return res.status(404).json({ error: 'not_found', message: scope === 'folder' ? 'Folder not found.' : 'Document not found.' });
        sender = senderConnection(userId);
    } catch (error) {
        if (error instanceof OdooError) return sendOdooError(res, error);
        console.error('[odoo] Failed to prepare a sync:', error);
        return res.status(500).json({ error: 'Failed to set up the sync' });
    }
    if (!sender) return res.status(409).json({ error: 'not_connected', message: 'Connect Odoo in Settings first.' });
    if (!sender.apps.includes('knowledge')) {
        return res.status(400).json({ error: 'missing_app', message: KNOWLEDGE_MESSAGES.missing_app });
    }
    const overlap = syncOverlapping(access.db, { scope, sourceId });
    if (overlap) {
        return res.status(409).json({ error: 'overlap', message: 'That is already covered by a sync. Remove the other sync first.' });
    }
    if (parentArticleId) {
        try {
            const rows = await sender.client.call('knowledge.article', 'read', { ids: [parentArticleId], fields: ['name'] });
            if (!Array.isArray(rows) || rows.length === 0) throw new OdooError('record_gone');
        } catch (error) {
            logFailure('sync_parent_failed', userId, error);
            rememberConnectionError(sender.userDb, error);
            const code = error instanceof OdooError ? error.code : 'odoo_error';
            return res.status(400).json({ error: code, message: KNOWLEDGE_MESSAGES[code] || ERROR_MESSAGES.odoo_error });
        }
    }

    try {
        const sync = createSync(access.db, {
            scope, sourceId, odooTarget: sender.target, parentArticleId: parentArticleId || null, runAs: userId, createdBy: userId,
        });
        void runSyncNow(access.dbKey, sync.id, { trigger: 'created' });
        res.status(201).json({ sync: syncPayload(access.db, sync, access.dbKey) });
    } catch (error) {
        console.error('[odoo] Failed to create a sync:', error);
        res.status(500).json({ error: 'Failed to set up the sync' });
    }
});

function syncForRequest(req, res, { forSending }) {
    const access = documentDatabase(req.user.user_id, req.query.dbKey, { forSending });
    if (access.status === 403) {
        res.status(403).json({ error: 'forbidden', message: 'Only owners and editors of this space can change its syncs.' });
        return null;
    }
    if (access.status) {
        res.status(access.status).json({ error: 'not_found', message: 'Database not found.' });
        return null;
    }
    const sync = readSync(access.db, String(req.params.id || ''));
    if (!sync) {
        res.status(404).json({ error: 'not_found', message: 'Sync not found.' });
        return null;
    }
    return { access, sync };
}

odooRoutes.post('/addons/odoo/syncs/:id/run', async (req, res) => {
    try {
        const found = syncForRequest(req, res, { forSending: true });
        if (!found) return;
        const { access, sync } = found;
        if (sync.status !== 'active') {
            return res.status(409).json({ error: 'paused', message: 'This sync is paused.' });
        }
        const started = await runSyncNow(access.dbKey, sync.id, { trigger: 'manual' });
        res.json({ started: started.started, sync: syncPayload(access.db, readSync(access.db, sync.id), access.dbKey) });
    } catch (error) {
        console.error('[odoo] Failed to run a sync:', error);
        res.status(500).json({ error: 'Failed to run the sync' });
    }
});

odooRoutes.delete('/addons/odoo/syncs/:id', (req, res) => {
    try {
        const found = syncForRequest(req, res, { forSending: true });
        if (!found) return;
        deleteSync(found.access.db, found.sync.id);
        res.status(204).end();
    } catch (error) {
        console.error('[odoo] Failed to remove a sync:', error);
        res.status(500).json({ error: 'Failed to remove the sync' });
    }
});
