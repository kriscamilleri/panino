// OAuth 2.1 for MCP clients (docs/specs/active/ai-integration.md §6). Panino is
// both the authorization server (issuer: the site origin) and the resource
// server (the MCP endpoint). Tokens are random, stored as SHA-256 only, and
// accepted only on the MCP endpoint.
//
//   publicOAuthRoutes   authorize, token, register, revoke  (no session)
//   sessionOAuthRoutes  consent and connected apps          (session, add-on gate)
//   wellKnown handlers  protected-resource and authorization-server metadata
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb, isDatabaseBusyError, respondDatabaseBusy } from '../../db.js';
import { clientAddress, createRateLimiter } from './keyUtils.js';
import { publicUrls } from './config.js';
import { resolveClient, registerClient, touchRegisteredClient } from './oauthClients.js';
import {
    ACCESS_TOKEN_PREFIX,
    ACCESS_TOKEN_TTL_SECONDS,
    CODE_TTL_MS,
    MAX_LIVE_GRANTS,
    REFRESH_TOKEN_PREFIX,
    REFRESH_TOKEN_TTL_MS,
    REQUEST_TTL_MS,
    SCOPES_SUPPORTED,
    displayHost,
    grantedScope,
    hashSecret,
    isLoopbackRedirect,
    isValidCodeChallenge,
    looksLikeOAuthToken,
    parseRequestedScope,
    randomToken,
    redirectUriMatches,
    verifyPkce,
    withQuery,
} from './oauthUtils.js';

export const publicOAuthRoutes = express.Router();
export const sessionOAuthRoutes = express.Router();

const ipLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;
const lastUsedWrites = new Map();

/** Test hook: forget rate-limit windows and last-use throttling. */
export function resetOAuthState() {
    ipLimiter.reset();
    lastUsedWrites.clear();
}

function urlsOr503(res) {
    const urls = publicUrls();
    if (!urls) {
        res.status(503).json({ error: 'temporarily_unavailable', error_description: 'Sign-in is not configured on this server.' });
        return null;
    }
    return urls;
}

function limitByIp(req, res) {
    const result = ipLimiter.hit(`ip:${clientAddress(req)}`);
    if (result.allowed) return true;
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({ error: 'slow_down', error_description: 'Too many requests. Try again shortly.' });
    return false;
}

function oauthError(res, status, error, description) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ error, error_description: description });
}

/* ------------------------------------------------------------------ *
 * Discovery (RFC 9728, RFC 8414)
 * ------------------------------------------------------------------ */

/** GET /.well-known/oauth-protected-resource[/<mcp path>] */
export function protectedResourceMetadata(req, res) {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
        resource: urls.mcp,
        authorization_servers: [urls.issuer],
        scopes_supported: SCOPES_SUPPORTED,
        bearer_methods_supported: ['header'],
        resource_name: 'Panino',
        resource_documentation: `${urls.v1Base}/openapi.json`,
    });
}

/** GET /.well-known/oauth-authorization-server[/<path>] */
export function authorizationServerMetadata(req, res) {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
        issuer: urls.issuer,
        authorization_endpoint: urls.authorize,
        token_endpoint: urls.token,
        registration_endpoint: urls.register,
        revocation_endpoint: urls.revoke,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        scopes_supported: SCOPES_SUPPORTED,
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${urls.v1Base}/openapi.json`,
    });
}

/* ------------------------------------------------------------------ *
 * Authorize → consent → code
 * ------------------------------------------------------------------ */

function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * GET /addons/ai/oauth/authorize. Validates the request, stores it, and sends
 * the browser to the consent page. Errors that make the redirect URI
 * untrustworthy are shown on Panino's own page; the rest go back to the client.
 */
publicOAuthRoutes.get('/oauth/authorize', async (req, res) => {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    // The consent page is a hash route, so its query follows the fragment.
    const ownErrorPage = (code) => res.redirect(302, `${urls.consent}?error=${encodeURIComponent(code)}`);
    if (!limitByIp(req, res)) return undefined;

    const query = Object.fromEntries(Object.entries(req.query).map(([key, value]) => [key, first(value)]));
    const clientId = typeof query.client_id === 'string' ? query.client_id : '';
    const redirectUri = typeof query.redirect_uri === 'string' ? query.redirect_uri : '';

    let client;
    try {
        client = await resolveClient(clientId);
    } catch {
        client = null;
    }
    if (!client) return ownErrorPage('invalid_client');
    if (!redirectUriMatches(redirectUri, client.redirectUris)) return ownErrorPage('invalid_redirect_uri');

    const state = typeof query.state === 'string' ? query.state.slice(0, 2000) : undefined;
    const back = (error, description) => res.redirect(302, withQuery(redirectUri, {
        error, error_description: description, state, iss: urls.issuer,
    }));

    if (query.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    if (query.code_challenge_method !== 'S256' || !isValidCodeChallenge(query.code_challenge)) {
        return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    }
    if (query.resource !== undefined && query.resource !== urls.mcp) {
        return back('invalid_target', 'This server issues tokens for its MCP endpoint only.');
    }
    const scope = parseRequestedScope(query.scope);
    if (!scope.ok) return back('invalid_scope', 'The requested scope is not valid.');

    try {
        const db = getAuthDb();
        const now = new Date();
        const id = uuidv4();
        db.transaction(() => {
            db.prepare('DELETE FROM ai_oauth_requests WHERE expires_at < ?').run(now.toISOString());
            db.prepare(`
                INSERT INTO ai_oauth_requests
                    (id, client_id, client_name, client_kind, redirect_uri, state, code_challenge, scope, resource, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, client.clientId, client.name, client.kind, redirectUri, state ?? null, query.code_challenge,
                scope.access, urls.mcp, now.toISOString(), new Date(now.getTime() + REQUEST_TTL_MS).toISOString());
            // A client still starting sign-ins is in use, approved or not: keep it.
            if (client.kind === 'registered') touchRegisteredClient(client.clientId, now);
        })();
        return res.redirect(302, `${urls.consent}?request=${encodeURIComponent(id)}`);
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] authorize failed:', error?.code || 'unknown');
        return back('server_error', 'Sign-in failed. Try again.');
    }
});

class AppLimitReached extends Error {}

function readPendingRequest(id) {
    if (typeof id !== 'string' || id.length > 64) return null;
    return getAuthDb().prepare('SELECT * FROM ai_oauth_requests WHERE id = ?').get(id) || null;
}

/** The pending request, if the signed-in user may act on it; claims it on first view. */
function claimRequest(req, res) {
    const row = readPendingRequest(req.params.id);
    const userId = req.user.user_id;
    if (!row || row.completed_at || row.expires_at < new Date().toISOString() || (row.claimed_by && row.claimed_by !== userId)) {
        res.status(404).json({ error: 'This sign-in request has expired or was already used. Start again from the app.', code: 'REQUEST_NOT_FOUND' });
        return null;
    }
    if (!row.claimed_by) {
        const claimed = getAuthDb().prepare('UPDATE ai_oauth_requests SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL').run(userId, row.id);
        if (claimed.changes === 0) {
            res.status(404).json({ error: 'This sign-in request has expired or was already used. Start again from the app.', code: 'REQUEST_NOT_FOUND' });
            return null;
        }
    }
    return row;
}

function requestView(row) {
    return {
        id: row.id,
        client: {
            name: row.client_name,
            kind: row.client_kind,
            // Where the app's identity comes from: the host serving its metadata
            // document, or nothing to vouch for it when it registered itself.
            host: row.client_kind === 'metadata' ? displayHost(row.client_id) : null,
        },
        redirectHost: displayHost(row.redirect_uri),
        redirectIsLoopback: isLoopbackRedirect(row.redirect_uri),
        requestedAccess: row.scope,
        expiresAt: row.expires_at,
    };
}

// GET /addons/ai/oauth/requests/:id — what the consent page shows.
sessionOAuthRoutes.get('/oauth/requests/:id', (req, res) => {
    try {
        const row = claimRequest(req, res);
        if (!row) return undefined;
        return res.json({ request: requestView(row) });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] read request failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Could not load the sign-in request.' });
    }
});

// POST /addons/ai/oauth/requests/:id/approve — { access, spaceAccess } → { redirectTo }
sessionOAuthRoutes.post('/oauth/requests/:id/approve', (req, res) => {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    const access = req.body?.access;
    const spaceAccess = req.body?.spaceAccess;
    if (!['read', 'write'].includes(access) || !['all', 'personal'].includes(spaceAccess)) {
        return res.status(400).json({ error: 'Choose the access and the Documents to share.', code: 'INVALID_INPUT' });
    }
    try {
        const row = claimRequest(req, res);
        if (!row) return undefined;
        const db = getAuthDb();
        const userId = req.user.user_id;
        const now = new Date();
        const code = randomToken();
        const grantId = uuidv4();
        const approve = db.transaction(() => {
            const done = db.prepare('UPDATE ai_oauth_requests SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
                .run(now.toISOString(), row.id);
            if (done.changes === 0) return 'used';
            // Approving the same app again replaces its earlier connection.
            db.prepare('UPDATE ai_oauth_grants SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
                .run(now.toISOString(), userId, row.client_id);
            const { count } = db.prepare('SELECT COUNT(*) AS count FROM ai_oauth_grants WHERE user_id = ? AND revoked_at IS NULL').get(userId);
            // Throwing rolls the request back to pending, so the user can
            // disconnect an app and press Connect again on the same page.
            if (count >= MAX_LIVE_GRANTS) throw new AppLimitReached();
            db.prepare(`
                INSERT INTO ai_oauth_grants
                    (id, user_id, client_id, client_name, client_kind, redirect_uri, scope, space_access, resource, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(grantId, userId, row.client_id, row.client_name, row.client_kind, row.redirect_uri, access, spaceAccess,
                row.resource, now.toISOString());
            db.prepare(`
                INSERT INTO ai_oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(hashSecret(code), grantId, row.client_id, row.redirect_uri, row.code_challenge, row.resource,
                new Date(now.getTime() + CODE_TTL_MS).toISOString());
            db.prepare('DELETE FROM ai_oauth_codes WHERE expires_at < ?').run(new Date(now.getTime() - CODE_TTL_MS).toISOString());
            return 'approved';
        });
        let outcome;
        try {
            outcome = approve();
        } catch (error) {
            if (!(error instanceof AppLimitReached)) throw error;
            outcome = 'limit';
        }
        if (outcome === 'used') return res.status(404).json({ error: 'This sign-in request was already used.', code: 'REQUEST_NOT_FOUND' });
        if (outcome === 'limit') {
            return res.status(409).json({ error: `You can connect at most ${MAX_LIVE_GRANTS} apps. Disconnect one in Settings → Add-ons → AI agents, then press Connect again.`, code: 'APP_LIMIT' });
        }
        if (row.client_kind === 'registered') touchRegisteredClient(row.client_id, now);
        return res.json({ redirectTo: withQuery(row.redirect_uri, { code, state: row.state ?? undefined, iss: urls.issuer }) });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] approve failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Could not connect the app.' });
    }
});

// POST /addons/ai/oauth/requests/:id/deny → { redirectTo }
sessionOAuthRoutes.post('/oauth/requests/:id/deny', (req, res) => {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    try {
        const row = claimRequest(req, res);
        if (!row) return undefined;
        getAuthDb().prepare('UPDATE ai_oauth_requests SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
        return res.json({
            redirectTo: withQuery(row.redirect_uri, {
                error: 'access_denied', error_description: 'The user declined.', state: row.state ?? undefined, iss: urls.issuer,
            }),
        });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] deny failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Could not cancel the sign-in.' });
    }
});

/* ------------------------------------------------------------------ *
 * Token endpoint
 * ------------------------------------------------------------------ */

function issueTokens(db, grantId, now, previousRefreshHash) {
    const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
    const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
    db.prepare(`
        UPDATE ai_oauth_grants
           SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?,
               previous_refresh_hash = coalesce(?, previous_refresh_hash)
         WHERE id = ?
    `).run(hashSecret(accessToken), new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        hashSecret(refreshToken), new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString(),
        previousRefreshHash ?? null, grantId);
    return { accessToken, refreshToken };
}

function revokeGrant(db, grantId, now = new Date()) {
    db.prepare(`
        UPDATE ai_oauth_grants
           SET revoked_at = coalesce(revoked_at, ?), access_hash = NULL, refresh_hash = NULL
         WHERE id = ?
    `).run(now.toISOString(), grantId);
}

function tokenResponse(res, tokens, grant) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: tokens.refreshToken,
        scope: grantedScope(grant.scope),
    });
}

function exchangeCode(body, urls, now) {
    const db = getAuthDb();
    const code = typeof body.code === 'string' ? body.code : '';
    const row = code ? db.prepare('SELECT * FROM ai_oauth_codes WHERE code_hash = ?').get(hashSecret(code)) : null;
    if (!row) return { error: 'invalid_grant', description: 'The authorization code is not valid.' };
    if (row.used_at) {
        // A code presented twice was intercepted or replayed: end the connection.
        revokeGrant(db, row.grant_id, now);
        return { error: 'invalid_grant', description: 'The authorization code was already used.' };
    }
    // Every check runs before the code is spent, so a client that gets one
    // parameter wrong can retry; only presenting a spent code ends the grant.
    if (row.expires_at < now.toISOString()) return { error: 'invalid_grant', description: 'The authorization code has expired.' };
    if (body.client_id !== row.client_id) return { error: 'invalid_grant', description: 'The code was issued to another client.' };
    // redirect_uri may be omitted (OAuth 2.1): PKCE already binds the code to the
    // client that started the sign-in. When sent, it must match exactly.
    if (body.redirect_uri !== undefined && body.redirect_uri !== row.redirect_uri) {
        return { error: 'invalid_grant', description: 'redirect_uri does not match the authorization request.' };
    }
    if (body.resource !== undefined && body.resource !== urls.mcp) return { error: 'invalid_target', description: 'This server issues tokens for its MCP endpoint only.' };
    if (!verifyPkce(body.code_verifier, row.code_challenge)) return { error: 'invalid_grant', description: 'The code_verifier does not match.' };
    const spent = db.prepare('UPDATE ai_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(now.toISOString(), row.code_hash);
    if (spent.changes === 0) {
        // Another exchange of the same code won the race: treat it as a replay.
        revokeGrant(db, row.grant_id, now);
        return { error: 'invalid_grant', description: 'The authorization code was already used.' };
    }
    const grant = db.prepare('SELECT * FROM ai_oauth_grants WHERE id = ? AND revoked_at IS NULL').get(row.grant_id);
    if (!grant) return { error: 'invalid_grant', description: 'The connection was cancelled.' };
    return { grant, tokens: issueTokens(db, grant.id, now, null) };
}

function refresh(body, urls, now) {
    const db = getAuthDb();
    const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!looksLikeOAuthToken(token, REFRESH_TOKEN_PREFIX)) return { error: 'invalid_grant', description: 'The refresh token is not valid.' };
    const hash = hashSecret(token);
    const grant = db.prepare('SELECT * FROM ai_oauth_grants WHERE refresh_hash = ?').get(hash);
    if (!grant) {
        // An already-rotated refresh token came back: someone else holds a copy.
        const reused = db.prepare('SELECT id FROM ai_oauth_grants WHERE previous_refresh_hash = ?').get(hash);
        if (reused) revokeGrant(db, reused.id, now);
        return { error: 'invalid_grant', description: 'The refresh token is not valid.' };
    }
    if (grant.revoked_at || !grant.refresh_expires_at || grant.refresh_expires_at < now.toISOString()) {
        return { error: 'invalid_grant', description: 'The connection has ended. Sign in again.' };
    }
    if (body.client_id !== undefined && body.client_id !== grant.client_id) {
        return { error: 'invalid_grant', description: 'The refresh token was issued to another client.' };
    }
    if (body.resource !== undefined && body.resource !== urls.mcp) return { error: 'invalid_target', description: 'This server issues tokens for its MCP endpoint only.' };
    return { grant, tokens: issueTokens(db, grant.id, now, hash) };
}

// POST /addons/ai/oauth/token (form-encoded or JSON)
publicOAuthRoutes.post('/oauth/token', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    const urls = urlsOr503(res);
    if (!urls) return undefined;
    if (!limitByIp(req, res)) return undefined;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const now = new Date();
    try {
        let result;
        const db = getAuthDb();
        if (body.grant_type === 'authorization_code') result = db.transaction(() => exchangeCode(body, urls, now))();
        else if (body.grant_type === 'refresh_token') result = db.transaction(() => refresh(body, urls, now))();
        else return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
        if (result.error) return oauthError(res, 400, result.error, result.description);
        return tokenResponse(res, result.tokens, result.grant);
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] token failed:', error?.code || 'unknown');
        return oauthError(res, 500, 'server_error', 'Could not issue a token. Try again.');
    }
});

// POST /addons/ai/oauth/register (RFC 7591, JSON)
publicOAuthRoutes.post('/oauth/register', (req, res) => {
    if (!urlsOr503(res)) return undefined;
    if (!limitByIp(req, res)) return undefined;
    try {
        const result = registerClient(req.body);
        if (!result.ok) return oauthError(res, 400, result.error, result.description);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json(result.response);
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] register failed:', error?.code || 'unknown');
        return oauthError(res, 500, 'server_error', 'Could not register the client.');
    }
});

// POST /addons/ai/oauth/revoke (RFC 7009): always 200.
publicOAuthRoutes.post('/oauth/revoke', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    if (!urlsOr503(res)) return undefined;
    if (!limitByIp(req, res)) return undefined;
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    try {
        const db = getAuthDb();
        if (looksLikeOAuthToken(token, ACCESS_TOKEN_PREFIX) || looksLikeOAuthToken(token, REFRESH_TOKEN_PREFIX)) {
            const hash = hashSecret(token);
            const grant = db.prepare('SELECT id FROM ai_oauth_grants WHERE access_hash = ? OR refresh_hash = ?').get(hash, hash);
            if (grant) revokeGrant(db, grant.id);
        }
    } catch (error) {
        console.error('[ai:oauth] revoke failed:', error?.code || 'unknown');
    }
    return res.status(200).end();
});

/* ------------------------------------------------------------------ *
 * Access tokens on the MCP endpoint
 * ------------------------------------------------------------------ */

/**
 * Resolve a `pna_…` access token to its owner and access, or null.
 * @returns {null | { userId: string, agent: object }}
 */
export function lookupAccessToken(credential, now = new Date()) {
    if (!looksLikeOAuthToken(credential, ACCESS_TOKEN_PREFIX)) return null;
    const grant = getAuthDb().prepare(`
        SELECT g.id, g.user_id, g.client_name, g.scope, g.space_access, g.access_expires_at, g.revoked_at,
               u.id AS owner_id
          FROM ai_oauth_grants g
          LEFT JOIN users u ON u.id = g.user_id
         WHERE g.access_hash = ?
    `).get(hashSecret(credential));
    if (!grant || grant.revoked_at || !grant.owner_id || !grant.access_expires_at || grant.access_expires_at <= now.toISOString()) {
        return null;
    }
    touchGrant(grant.id, now);
    return {
        userId: grant.user_id,
        agent: { kind: 'app', id: grant.id, name: grant.client_name, scope: grant.scope, spaceAccess: grant.space_access, expiresAt: null },
    };
}

function touchGrant(grantId, now) {
    const previous = lastUsedWrites.get(grantId) || 0;
    if (now.getTime() - previous < LAST_USED_WRITE_INTERVAL_MS) return;
    lastUsedWrites.set(grantId, now.getTime());
    try {
        getAuthDb().prepare('UPDATE ai_oauth_grants SET last_used_at = ? WHERE id = ?').run(now.toISOString(), grantId);
    } catch (error) {
        console.warn('[ai:oauth] could not record last use:', error?.code || 'unknown');
    }
}

/* ------------------------------------------------------------------ *
 * Connected apps (session)
 * ------------------------------------------------------------------ */

function publicGrant(row) {
    return {
        id: row.id,
        name: row.client_name,
        host: row.client_kind === 'metadata' ? displayHost(row.client_id) : null,
        redirectHost: displayHost(row.redirect_uri),
        scope: row.scope,
        spaceAccess: row.space_access,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
    };
}

// GET /addons/ai/connections
sessionOAuthRoutes.get('/connections', (req, res) => {
    try {
        const rows = getAuthDb().prepare(`
            SELECT * FROM ai_oauth_grants
             WHERE user_id = ? AND revoked_at IS NULL
             ORDER BY created_at DESC, id DESC
        `).all(req.user.user_id);
        return res.json({ connections: rows.map(publicGrant), limit: MAX_LIVE_GRANTS });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] list connections failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Could not load connected apps.' });
    }
});

// DELETE /addons/ai/connections/:id
sessionOAuthRoutes.delete('/connections/:id', (req, res) => {
    try {
        const db = getAuthDb();
        const row = db.prepare('SELECT id FROM ai_oauth_grants WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
            .get(String(req.params.id), req.user.user_id);
        if (!row) return res.status(404).json({ error: 'Connected app not found.', code: 'NOT_FOUND' });
        revokeGrant(db, row.id);
        lastUsedWrites.delete(row.id);
        return res.json({ disconnected: true });
    } catch (error) {
        if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
        console.error('[ai:oauth] disconnect failed:', error?.code || 'unknown');
        return res.status(500).json({ error: 'Could not disconnect the app.' });
    }
});
