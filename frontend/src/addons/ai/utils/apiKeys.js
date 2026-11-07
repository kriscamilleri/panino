// Pure helpers for the AI agents add-on's API keys (docs/specs/active/llm-api.md §5.4,
// ai-integration.md §9).

export const ACCESS_OPTIONS = Object.freeze([
    { value: 'read', label: 'Read only' },
    { value: 'write', label: 'Read & write' },
]);

export const SPACE_OPTIONS = Object.freeze([
    { value: 'all', label: 'Personal and all my spaces' },
    { value: 'personal', label: 'Personal only' },
]);

export const EXPIRY_OPTIONS = Object.freeze([
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
    { value: 365, label: '1 year' },
    { value: null, label: 'Never' },
]);

/**
 * The v1 API base URL for this deployment, as an agent should call it. The
 * server's own answer (GET /addons/ai/setup) wins; this is the fallback.
 * @param {{ isProd: boolean, origin: string, apiServiceUrl?: string }} env
 * @returns {string}
 */
export function apiV1BaseUrl({ isProd, origin, apiServiceUrl }) {
    const base = isProd ? `${origin.replace(/\/$/, '')}/api` : (apiServiceUrl || 'http://localhost:8000').replace(/\/$/, '');
    return `${base}/addons/ai/v1`;
}

/**
 * A ready-to-run request that proves the key works.
 * @param {string} baseUrl
 * @param {string} secret
 * @returns {string}
 */
export function curlExample(baseUrl, secret) {
    return `curl -H "Authorization: Bearer ${secret}" "${baseUrl}/search?q=meeting"`;
}

/**
 * @param {string} scope
 * @returns {string}
 */
export function accessLabel(scope) {
    return ACCESS_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}

/**
 * @param {string} spaceAccess
 * @returns {string}
 */
export function spacesLabel(spaceAccess) {
    return spaceAccess === 'personal' ? 'Personal only' : 'All spaces';
}

/**
 * A short date for the key list, or a fallback for null.
 * @param {string|null} iso
 * @param {string} fallback
 * @returns {string}
 */
export function formatKeyDate(iso, fallback) {
    if (!iso) return fallback;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * What the Expires column says.
 * @param {{ expiresAt: string|null, expired: boolean }} key
 * @returns {string}
 */
export function expiryLabel(key) {
    if (key.expired) return 'Expired';
    return formatKeyDate(key.expiresAt, 'Never');
}
