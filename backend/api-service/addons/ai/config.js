// Operator settings for the AI agents add-on (docs/specs/active/ai-integration.md §6.1, §10).
//
// The public URLs come from the variables the server already uses:
//   PUBLIC_API_BASE_URL  the API as browsers reach it (production https://panino.sh/api)
//   FRONTEND_URL         the app (production https://panino.sh)
// OAuth metadata must not depend on a request's Host header, so in production both
// are required; development falls back to the local stack.

export const ADDON_ID = 'ai';

/** @returns {boolean} the operator offers the add-on */
export function isAiAddonOffered() {
    return process.env.AI_ADDON_ENABLED === 'true';
}

function trimmed(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

/** @returns {string|null} the API base URL, or null when production lacks it */
export function apiBaseUrl() {
    const configured = trimmed(process.env.PUBLIC_API_BASE_URL);
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') return null;
    return `http://localhost:${process.env.PORT || 8000}`;
}

/** @returns {string|null} the app's origin-plus-path, or null when production lacks it */
export function appBaseUrl() {
    const configured = trimmed(process.env.FRONTEND_URL);
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production') return null;
    return 'http://localhost:5173';
}

/** @returns {boolean} both public URLs are known, so OAuth can be offered */
export function publicUrlsConfigured() {
    return Boolean(apiBaseUrl() && appBaseUrl());
}

/**
 * Every URL the add-on publishes, derived from the two settings.
 * @returns {null | { issuer: string, addonBase: string, v1Base: string, mcp: string,
 *   resourceMetadata: string, authorize: string, token: string, register: string,
 *   revoke: string, consent: string, appOrigin: string }}
 */
export function publicUrls() {
    const api = apiBaseUrl();
    const app = appBaseUrl();
    if (!api || !app) return null;
    const apiUrl = new URL(api);
    const issuer = apiUrl.origin;
    const addonBase = `${api}/addons/${ADDON_ID}`;
    const mcp = `${addonBase}/v1/mcp`;
    const mcpPath = new URL(mcp).pathname;
    return {
        issuer,
        addonBase,
        v1Base: `${addonBase}/v1`,
        mcp,
        resourceMetadata: `${issuer}/.well-known/oauth-protected-resource${mcpPath}`,
        authorize: `${addonBase}/oauth/authorize`,
        token: `${addonBase}/oauth/token`,
        register: `${addonBase}/oauth/register`,
        revoke: `${addonBase}/oauth/revoke`,
        consent: `${app}/#/addons/${ADDON_ID}/authorize`,
        appOrigin: new URL(app).origin,
    };
}

/** Misconfigurations to log at startup. */
export function aiConfigWarnings() {
    if (!isAiAddonOffered()) return [];
    if (!publicUrlsConfigured()) {
        return ['PUBLIC_API_BASE_URL and FRONTEND_URL must be set in production; MCP sign-in (OAuth) is unavailable until they are.'];
    }
    return [];
}
