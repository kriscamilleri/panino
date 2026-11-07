// Authenticate an AI agent's request (docs/specs/active/ai-integration.md §4.4, §5.1).
// Two credentials, both `Authorization: Bearer`:
//   pnk_…  a personal API key (keys.js): REST and MCP
//   pna_…  an OAuth access token of a connected app (oauth.js): MCP only
// Either way the owner must have the add-on switched on. Session JWTs are
// refused here, as these credentials are everywhere else.
import { isDatabaseBusyError, respondDatabaseBusy } from '../../db.js';
import { isAddonActive } from '../registry.js';
import { ADDON_ID, publicUrls } from './config.js';
import { lookupApiKey } from './keys.js';
import { bearerFromHeader, clientAddress, createRateLimiter } from './keyUtils.js';
import { lookupAccessToken } from './oauth.js';
import { ACCESS_TOKEN_PREFIX } from './oauthUtils.js';

export const AGENT_RATE_LIMIT_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 120;
export const agentRateLimiter = createRateLimiter({ limit: AGENT_RATE_LIMIT_PER_MINUTE, windowMs: 60 * 1000 });
/**
 * Rejected credentials per caller address per minute. Past it, the address is
 * refused before any lookup, so a flood of made-up keys costs almost nothing.
 * Missing credentials are not counted: an OAuth client's first, unauthenticated
 * request is how it learns to sign in.
 */
export const FAILED_CREDENTIALS_PER_MINUTE = 30;
const failedCredentialLimiter = createRateLimiter({ limit: FAILED_CREDENTIALS_PER_MINUTE, windowMs: 60 * 1000 });

/** The WWW-Authenticate value for a 401: points OAuth clients at the resource metadata. */
export function bearerChallenge(error) {
    const urls = publicUrls();
    const parts = [urls ? `resource_metadata="${urls.resourceMetadata}"` : 'realm="panino"'];
    if (error) parts.push(`error="${error}"`);
    return `Bearer ${parts.join(', ')}`;
}

const refusal = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/**
 * Who is calling, or why not. Never throws for a bad credential.
 * @param {import('express').Request} req
 * @param {{ allowApps?: boolean }} [options] accept OAuth access tokens (MCP only)
 * @returns {{ ok: true, userId: string, agent: object }
 *   | { ok: false, status: number, code: string, message: string, retryAfterSeconds?: number, busy?: boolean }}
 */
export function authenticateRequest(req, { allowApps = false } = {}) {
    const credential = bearerFromHeader(req.headers.authorization);
    if (!credential) {
        return refusal(401, 'API_KEY_REQUIRED',
            'Send an API key as "Authorization: Bearer pnk_…". Create one in Panino under Settings → Add-ons → AI agents.');
    }

    const address = `ip:${clientAddress(req)}`;
    const blocked = failedCredentialLimiter.check(address);
    if (!blocked.allowed) {
        return refusal(429, 'RATE_LIMITED', `Too many requests with invalid credentials. Wait ${blocked.retryAfterSeconds} seconds and retry.`,
            { retryAfterSeconds: blocked.retryAfterSeconds });
    }
    const rejected = (code, message) => {
        failedCredentialLimiter.hit(address);
        return refusal(401, code, message);
    };

    let found;
    try {
        if (credential.startsWith(ACCESS_TOKEN_PREFIX)) {
            if (!allowApps) return refusal(401, 'INVALID_API_KEY', 'Connected-app tokens work only on the MCP endpoint. Use an API key here.');
            found = lookupAccessToken(credential);
            if (!found) return rejected('INVALID_TOKEN', 'This access token is not valid. It may have expired or the app was disconnected.');
        } else {
            found = lookupApiKey(credential);
            if (!found) return rejected('INVALID_API_KEY', 'This API key is not valid. It may have been revoked or have expired.');
        }
        if (!isAddonActive(found.userId, ADDON_ID)) {
            return refusal(403, 'ADDON_DISABLED', 'AI agents is turned off in Panino Settings → Add-ons.');
        }
    } catch (error) {
        if (isDatabaseBusyError(error)) return refusal(503, 'DATABASE_BUSY', 'The server is busy. Retry shortly.', { busy: true });
        console.error('[ai:auth] lookup failed:', error?.code || 'unknown');
        return refusal(500, 'INTERNAL', 'Internal server error');
    }

    const limit = agentRateLimiter.hit(found.agent.id);
    if (!limit.allowed) {
        return refusal(429, 'RATE_LIMITED', `Too many requests. Wait ${limit.retryAfterSeconds} seconds and retry.`,
            { retryAfterSeconds: limit.retryAfterSeconds });
    }
    return { ok: true, userId: found.userId, agent: found.agent };
}

/** Set the headers a refusal carries (WWW-Authenticate, Retry-After). */
export function applyRefusalHeaders(res, result) {
    if (result.status === 401) res.setHeader('WWW-Authenticate', bearerChallenge(result.code === 'API_KEY_REQUIRED' ? null : 'invalid_token'));
    if (result.retryAfterSeconds) res.setHeader('Retry-After', String(result.retryAfterSeconds));
}

/**
 * Express middleware for the REST API: sets `req.user` and `req.agent`, or
 * answers `{ error, code }`.
 * @param {{ allowApps?: boolean }} [options]
 */
export function authenticateAgent(options = {}) {
    return (req, res, next) => {
        const result = authenticateRequest(req, options);
        if (!result.ok) {
            if (result.busy) return respondDatabaseBusy(res);
            applyRefusalHeaders(res, result);
            const message = result.code === 'RATE_LIMITED' ? 'Too many requests. Slow down and retry.' : result.message;
            return res.status(result.status).json({ error: message, code: result.code });
        }
        req.user = { user_id: result.userId };
        req.agent = result.agent;
        return next();
    };
}

/** Test hook: forget rate-limit windows. */
export function resetAgentRateLimit() {
    agentRateLimiter.reset();
    failedCredentialLimiter.reset();
}
