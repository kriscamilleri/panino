// OAuth clients of the AI agents add-on (docs/specs/active/ai-integration.md §6.2):
// Client ID Metadata Documents, fetched through safeFetch.js, and clients that
// registered themselves (RFC 7591), stored in ai_oauth_clients. Public clients only.
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb } from '../../db.js';
import { safeRequest } from '../../safeFetch.js';
import { isMetadataClientId, metadataCacheMs, validateClientMetadata, validateRegistration } from './oauthUtils.js';

const METADATA_TIMEOUT_MS = 5000;
const METADATA_MAX_BYTES = 16 * 1024;
const METADATA_CACHE_LIMIT = 500;
const UNUSED_CLIENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const metadataCache = new Map();
let fetchMetadata = fetchClientMetadata;

/**
 * Fetch a Client ID Metadata Document. The URL comes from whoever starts a
 * sign-in, so it goes through safeFetch.js: https only, public addresses only
 * (checked after DNS and pinned), no redirects, 5 s, 16 KiB.
 * @param {string} url
 * @param {{ lookup?: Function }} [options] `dns.lookup`-compatible resolver (test seam)
 * @returns {Promise<{ ok: true, body: string, cacheControl?: string } | { ok: false, reason: string }>}
 */
export async function fetchClientMetadata(url, { lookup } = {}) {
    // No redirects: the document must be served at the client_id URL itself.
    const response = await safeRequest(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Panino-OAuth' },
        timeoutMs: METADATA_TIMEOUT_MS,
        maxBytes: METADATA_MAX_BYTES,
        ...(lookup ? { lookup } : {}),
    });
    if (!response.ok) return { ok: false, reason: response.reason };
    if (response.status !== 200) return { ok: false, reason: `status ${response.status}` };
    return { ok: true, body: response.body.toString('utf8'), cacheControl: response.headers['cache-control'] };
}

/** Test seam: replace the metadata fetcher (and clear the cache). */
export function setMetadataFetcher(fetcher) {
    fetchMetadata = fetcher || fetchClientMetadata;
    metadataCache.clear();
}

/**
 * The client behind a client_id, or null when it is unknown or its metadata
 * is unusable.
 * @param {string} clientId
 * @returns {Promise<null | { clientId: string, name: string, redirectUris: string[], kind: 'metadata' | 'registered' }>}
 */
export async function resolveClient(clientId, now = Date.now()) {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 2000) return null;
    if (isMetadataClientId(clientId)) return resolveMetadataClient(clientId, now);
    const row = getAuthDb().prepare('SELECT client_id, client_name, redirect_uris FROM ai_oauth_clients WHERE client_id = ?').get(clientId);
    if (!row) return null;
    let redirectUris;
    try {
        redirectUris = JSON.parse(row.redirect_uris);
    } catch {
        return null;
    }
    return { clientId: row.client_id, name: row.client_name, redirectUris, kind: 'registered' };
}

async function resolveMetadataClient(clientId, now) {
    const cached = metadataCache.get(clientId);
    if (cached && cached.expiresAt > now) return cached.client;

    let fetched;
    try {
        fetched = await fetchMetadata(clientId);
    } catch {
        fetched = { ok: false };
    }
    if (!fetched?.ok) return null;
    let doc;
    try {
        doc = JSON.parse(fetched.body);
    } catch {
        return null;
    }
    const checked = validateClientMetadata(doc, clientId);
    if (!checked.ok) return null;
    const client = { ...checked.client, kind: 'metadata' };
    if (metadataCache.size >= METADATA_CACHE_LIMIT) metadataCache.delete(metadataCache.keys().next().value);
    metadataCache.set(clientId, { client, expiresAt: now + metadataCacheMs(fetched.cacheControl) });
    return client;
}

/**
 * Register a client (RFC 7591). Clients that were never approved and have not
 * started a sign-in for 30 days are pruned, here, so open registration cannot
 * grow the table forever. A client that was ever approved is kept: the app
 * holds its client_id and cannot learn it is gone, so pruning it would break
 * reconnecting after a Disconnect.
 * @returns {{ ok: true, response: object } | { ok: false, error: string, description: string }}
 */
export function registerClient(body, now = new Date()) {
    const parsed = validateRegistration(body);
    if (!parsed.ok) return parsed;
    const db = getAuthDb();
    const clientId = uuidv4();
    const createdAt = now.toISOString();
    const cutoff = new Date(now.getTime() - UNUSED_CLIENT_RETENTION_MS).toISOString();
    db.transaction(() => {
        db.prepare(`
            DELETE FROM ai_oauth_clients
             WHERE coalesce(last_used_at, created_at) < ?
               AND client_id NOT IN (SELECT client_id FROM ai_oauth_grants)
        `).run(cutoff);
        db.prepare('INSERT INTO ai_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
            .run(clientId, parsed.value.name, JSON.stringify(parsed.value.redirectUris), createdAt);
    })();
    return {
        ok: true,
        response: {
            client_id: clientId,
            client_id_issued_at: Math.floor(now.getTime() / 1000),
            client_name: parsed.value.name,
            redirect_uris: parsed.value.redirectUris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        },
    };
}

/** Record that a registered client was used, so pruning keeps it. */
export function touchRegisteredClient(clientId, now = new Date()) {
    getAuthDb().prepare('UPDATE ai_oauth_clients SET last_used_at = ? WHERE client_id = ?').run(now.toISOString(), clientId);
}
