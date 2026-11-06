// Pure OAuth 2.1 helpers for the AI agents add-on (docs/specs/active/ai-integration.md §6).
// No database, network or Express here, so every rule is unit tested.
import crypto from 'crypto';
import { validateName } from './keyUtils.js';

export const ACCESS_TOKEN_PREFIX = 'pna_';
export const REFRESH_TOKEN_PREFIX = 'pnr_';
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const MAX_LIVE_GRANTS = 20;

export const SCOPE_READ = 'documents:read';
export const SCOPE_WRITE = 'documents:write';
export const SCOPE_OFFLINE = 'offline_access';
export const SCOPES_SUPPORTED = Object.freeze([SCOPE_READ, SCOPE_WRITE, SCOPE_OFFLINE]);

const TOKEN_PATTERN = /^pn[ar]_[A-Za-z0-9_-]{43}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Schemes that are not an app's own callback: script and content schemes, and
// schemes other software handles.
const FORBIDDEN_SCHEMES = new Set([
    'javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'filesystem:',
    'ws:', 'wss:', 'ftp:', 'mailto:', 'tel:', 'sms:', 'intent:', 'chrome:', 'view-source:',
]);

/** A random secret with a prefix: 32 bytes of base64url. */
export function randomToken(prefix = '') {
    return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex, how every token and code is stored. */
export function hashSecret(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** @returns {boolean} the value has the shape of a Panino access or refresh token */
export function looksLikeOAuthToken(value, prefix) {
    return typeof value === 'string' && TOKEN_PATTERN.test(value) && value.startsWith(prefix);
}

/**
 * RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge, in constant time.
 * The verifier must be 43–128 characters of the unreserved set.
 */
export function verifyPkce(verifier, challenge) {
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

/** @returns {boolean} a well-formed S256 challenge */
export function isValidCodeChallenge(challenge) {
    return typeof challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/**
 * Whether a redirect URI may be registered: https anywhere, http on loopback
 * only, or an app's private-use scheme (RFC 8252 §7.1: `cursor://…`,
 * `com.example.app:/…`). No fragments, no credentials.
 * @param {string} value
 */
export function isAllowedRedirectUri(value) {
    if (typeof value !== 'string' || value.length > 2000) return false;
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.hash || value.includes('#')) return false;
    if (url.username || url.password) return false;
    if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
    if (url.protocol === 'https:') return Boolean(url.hostname);
    if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
    // Private-use URI scheme of a native app.
    return /^[a-z][a-z0-9+.-]{1,62}:$/.test(url.protocol);
}

function isLoopbackHttp(url) {
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether a redirect URI in a request matches one the client registered.
 * Exact string match, except that loopback http URIs match on any port
 * (RFC 8252 §7.3), since native apps pick a free port per sign-in.
 * @param {string} requested
 * @param {string[]} registered
 */
export function redirectUriMatches(requested, registered) {
    if (!isAllowedRedirectUri(requested) || !Array.isArray(registered)) return false;
    if (registered.includes(requested)) return true;
    const want = new URL(requested);
    if (!isLoopbackHttp(want)) return false;
    return registered.some((candidate) => {
        let url;
        try {
            url = new URL(candidate);
        } catch {
            return false;
        }
        return isLoopbackHttp(url) && url.hostname === want.hostname
            && url.pathname === want.pathname && url.search === want.search;
    });
}

/** @returns {boolean} the redirect goes back to this computer (loopback http) */
export function isLoopbackRedirect(value) {
    try {
        return isLoopbackHttp(new URL(value));
    } catch {
        return false;
    }
}

/** The host a user should see for a redirect URI or a client id URL. */
export function displayHost(value) {
    try {
        const url = new URL(value);
        return url.host || url.protocol.replace(/:$/, '');
    } catch {
        return '';
    }
}

/**
 * The access a scope string asks for: 'write' when it names documents:write,
 * otherwise 'read'. An empty or absent scope asks for read & write, which the
 * user can lower on the consent page.
 * @param {string|undefined} scope
 * @returns {{ ok: true, access: 'read'|'write', scopes: string[] } | { ok: false }}
 */
export function parseRequestedScope(scope) {
    if (scope === undefined || scope === null || scope === '') return { ok: true, access: 'write', scopes: [] };
    if (typeof scope !== 'string' || scope.length > 500) return { ok: false };
    const scopes = scope.split(' ').filter(Boolean);
    // Unknown scopes are ignored (RFC 6749 §3.3 lets the server narrow), so a
    // client that also asks for e.g. "openid" still signs in.
    const known = scopes.filter((item) => SCOPES_SUPPORTED.includes(item));
    return { ok: true, access: known.includes(SCOPE_WRITE) ? 'write' : 'read', scopes: known };
}

/** The scope string to return for granted access. */
export function grantedScope(access) {
    return access === 'write' ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ;
}

/** A client's display name, or null when it cannot be shown safely. */
export function cleanClientName(value) {
    if (typeof value !== 'string') return null;
    const result = validateName(value.slice(0, 200), 'name');
    if (!result.ok) return null;
    return result.value.slice(0, 60);
}

/**
 * Whether a client_id names a Client ID Metadata Document: an https URL with a
 * path, no fragment, no credentials.
 * @param {string} clientId
 */
export function isMetadataClientId(clientId) {
    if (typeof clientId !== 'string' || clientId.length > 2000) return false;
    let url;
    try {
        url = new URL(clientId);
    } catch {
        return false;
    }
    return url.protocol === 'https:' && Boolean(url.hostname) && url.pathname.length > 1
        && !url.hash && !url.username && !url.password;
}

/**
 * Validate a fetched Client ID Metadata Document.
 * @param {unknown} doc
 * @param {string} clientId the URL it was fetched from
 * @returns {{ ok: true, client: { clientId: string, name: string, redirectUris: string[] } } | { ok: false, reason: string }}
 */
export function validateClientMetadata(doc, clientId) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, reason: 'not an object' };
    if (doc.client_id !== clientId) return { ok: false, reason: 'client_id does not match the document URL' };
    const redirectUris = doc.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 20) {
        return { ok: false, reason: 'redirect_uris missing' };
    }
    if (!redirectUris.every(isAllowedRedirectUri)) return { ok: false, reason: 'redirect_uris not allowed' };
    const method = doc.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') return { ok: false, reason: 'only public clients are supported' };
    const name = cleanClientName(doc.client_name) || displayHost(clientId);
    return { ok: true, client: { clientId, name, redirectUris: [...redirectUris] } };
}

/**
 * Validate a Dynamic Client Registration request body (RFC 7591).
 * @returns {{ ok: true, value: { name: string, redirectUris: string[] } } | { ok: false, error: string, description: string }}
 */
export function validateRegistration(body) {
    const fail = (error, description) => ({ ok: false, error, description });
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_client_metadata', 'Send the client metadata as a JSON object.');
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 20) {
        return fail('invalid_redirect_uri', 'redirect_uris must list one to twenty URIs.');
    }
    if (!redirectUris.every(isAllowedRedirectUri)) {
        return fail('invalid_redirect_uri', 'Redirect URIs must be https, http on localhost, or a private-use scheme, without a fragment.');
    }
    const grantTypes = body.grant_types;
    if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code'))) {
        return fail('invalid_client_metadata', 'Only the authorization_code grant is supported.');
    }
    const responseTypes = body.response_types;
    if (responseTypes !== undefined && (!Array.isArray(responseTypes) || responseTypes.some((type) => type !== 'code'))) {
        return fail('invalid_client_metadata', 'Only the code response type is supported.');
    }
    const name = cleanClientName(body.client_name) || displayHost(redirectUris[0]) || 'AI app';
    return { ok: true, value: { name, redirectUris: [...redirectUris] } };
}

/**
 * Cache lifetime for a fetched metadata document from its Cache-Control
 * header, clamped to 5 minutes .. 24 hours.
 * @param {string|undefined} cacheControl
 */
export function metadataCacheMs(cacheControl) {
    const min = 5 * 60 * 1000;
    const max = 24 * 60 * 60 * 1000;
    const match = /max-age=(\d+)/i.exec(String(cacheControl || ''));
    if (!match) return min;
    return Math.min(max, Math.max(min, Number(match[1]) * 1000));
}

/** Append query parameters to a redirect URI, keeping the ones it has. */
export function withQuery(uri, params) {
    const url = new URL(uri);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
}
