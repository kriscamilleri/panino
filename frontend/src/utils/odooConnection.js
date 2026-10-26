/**
 * Display helpers for the Odoo connection (docs/specs/active/odoo-integration.md).
 * Pure functions: no stores, no network.
 */

/** Days before expiry from which the key is flagged. */
export const KEY_EXPIRY_WARNING_DAYS = 14;

const APP_LABELS = Object.freeze({
    documents: 'Documents',
    knowledge: 'Knowledge',
    crm: 'CRM',
    sales: 'Sales',
});

/**
 * Where the API key stands against its expiry date.
 *
 * @param {string|null|undefined} keyExpiresOn `YYYY-MM-DD`
 * @param {Date} [today]
 * @returns {{ state: 'unknown'|'ok'|'soon'|'expired', daysLeft: number|null }}
 */
export function keyExpiryState(keyExpiresOn, today = new Date()) {
    if (typeof keyExpiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(keyExpiresOn)) {
        return { state: 'unknown', daysLeft: null };
    }
    const expires = Date.UTC(...keyExpiresOn.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0)));
    const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const daysLeft = Math.round((expires - now) / 86400000);
    if (daysLeft < 0) return { state: 'expired', daysLeft };
    if (daysLeft <= KEY_EXPIRY_WARNING_DAYS) return { state: 'soon', daysLeft };
    return { state: 'ok', daysLeft };
}

/**
 * One sentence about the key's expiry, or '' when there is nothing to say.
 *
 * @param {string|null|undefined} keyExpiresOn
 * @param {Date} [today]
 * @returns {string}
 */
export function keyExpiryMessage(keyExpiresOn, today = new Date()) {
    const { state, daysLeft } = keyExpiryState(keyExpiresOn, today);
    if (state === 'expired') return `The API key expired on ${keyExpiresOn}. Create a new one in Odoo and connect again.`;
    if (state === 'soon' && daysLeft === 0) return 'The API key expires today. Create a new one in Odoo and connect again.';
    if (state === 'soon') return `The API key expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, on ${keyExpiresOn}.`;
    return '';
}

/**
 * The Odoo apps behind each destination, by display name, in a fixed order.
 *
 * @param {string[]} apps from the server, e.g. `['crm', 'documents']`
 * @returns {string[]}
 */
export function appLabels(apps) {
    const present = new Set(Array.isArray(apps) ? apps : []);
    return Object.keys(APP_LABELS).filter((app) => present.has(app)).map((app) => APP_LABELS[app]);
}

/**
 * The Odoo host to show, without the scheme.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
export function odooHost(baseUrl) {
    try {
        return new URL(baseUrl).host;
    } catch {
        return String(baseUrl || '');
    }
}
