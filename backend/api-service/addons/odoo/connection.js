/**
 * A user's stored Odoo connection, as the routes (routes.js) and the background
 * syncs (syncScheduler.js) both need it: the row, a client under the server's
 * address policy, and the target key that ties links to one Odoo database. The
 * API key is decrypted here and never leaves the process.
 */

import { getUserDb } from '../../db.js';
import { isPublicAddress } from '../../safeFetch.js';
import { decryptSecret } from '../../secrets.js';
import { OdooError, createOdooClient, odooTarget } from './client.js';

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

const MIN_ENCRYPTION_KEY_LENGTH = 32;

export function encryptionKey() {
    return process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY;
}

/** @returns {boolean} whether the operator offers the add-on: the flag and a long enough key */
export function isOdooIntegrationEnabled() {
    return process.env.ODOO_INTEGRATION_ENABLED === 'true'
        && String(encryptionKey() || '').length >= MIN_ENCRYPTION_KEY_LENGTH;
}

/** @returns {object|null} the `odoo_connection` row */
export function readConnection(db) {
    return db.prepare('SELECT * FROM odoo_connection WHERE singleton = 1').get() || null;
}

/**
 * @typedef {object} SenderConnection
 * @property {object} row the `odoo_connection` row
 * @property {import('better-sqlite3').Database} userDb
 * @property {string[]} apps
 * @property {ReturnType<typeof createOdooClient>} client
 * @property {string} target from `odooTarget`
 */

/**
 * A user's connection and a client for it, or null when not connected.
 * A key that no longer decrypts is recorded as rejected.
 *
 * @param {string} userId
 * @returns {SenderConnection|null}
 * @throws {OdooError} `key_rejected`
 */
export function senderConnection(userId) {
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
    let apps;
    try {
        apps = JSON.parse(row.apps);
    } catch {
        apps = [];
    }
    return { row, userDb, apps: Array.isArray(apps) ? apps : [], client: odooClientFor(connection), target: odooTarget(connection) };
}

/** A failure that says the connection itself is broken is remembered so Settings shows it. */
export function rememberConnectionError(userDb, error) {
    if (error instanceof OdooError && ['key_rejected', 'not_odoo', 'unreachable', 'blocked'].includes(error.code)) {
        userDb.prepare('UPDATE odoo_connection SET last_error = ? WHERE singleton = 1').run(error.code);
    }
}
