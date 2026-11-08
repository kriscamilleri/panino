// Pure helpers for Document properties (docs/specs/shipped/ai-api-expansion.md §4.6):
// the front matter `key: value` pairs at the top of a Document, read with the
// shared parser so the API and the app agree, and a small filter language for
// querying them. The reading and the filter language moved to shared/propertyFilter.js,
// so the app's `prop:` search parts mean what the API's do
// (docs/specs/active/advanced-search.md §6.1); they are re-exported here under their old names.
export {
    compareTimes,
    FRONT_MATTER_SCAN_CHARS,
    isoParts,
    matchesFilter,
    MAX_FILTER_CONDITIONS,
    parseFilter,
    propertyValue,
    readProperties,
    requiredKeys,
} from '@panino/content-merge/property-filter';

/** Longest property key or value the API writes. */
export const MAX_PROPERTY_KEY_LENGTH = 100;
export const MAX_PROPERTY_VALUE_LENGTH = 1000;

/**
 * Check a key and value for writing: one line each, no colon in the key, and
 * not the fence.
 * @returns {{ ok: true, key: string, value?: string } | { ok: false, error: string }}
 */
export function validateProperty(key, value, { requireValue = true } = {}) {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'key must be non-empty text.' };
    const cleanKey = key.trim();
    if (cleanKey.length > MAX_PROPERTY_KEY_LENGTH) return { ok: false, error: `key can be at most ${MAX_PROPERTY_KEY_LENGTH} characters.` };
    if (/[:\r\n]/.test(cleanKey) || cleanKey.startsWith('-') || cleanKey.startsWith('#')) {
        return { ok: false, error: 'key must be one line without ":" and must not start with "-" or "#".' };
    }
    if (!requireValue) return { ok: true, key: cleanKey };
    if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'value must be non-empty text. To clear a property, remove it.' };
    const cleanValue = value.trim();
    if (cleanValue.length > MAX_PROPERTY_VALUE_LENGTH) return { ok: false, error: `value can be at most ${MAX_PROPERTY_VALUE_LENGTH} characters.` };
    if (/[\r\n]/.test(cleanValue)) return { ok: false, error: 'value must be one line.' };
    if (cleanValue === '---') return { ok: false, error: 'value cannot be "---".' };
    return { ok: true, key: cleanKey, value: cleanValue };
}

/**
 * Built-in properties every Document has, usable in filters by these names.
 * They take precedence over a front matter key of the same name.
 */
export const BUILT_IN_FILTER_KEYS = Object.freeze({
    word_count: 'Number of words in the body',
    created_on: 'When the Document was created (ISO time, UTC; a date alone means that whole day)',
    modified_on: 'When the Document was last changed (ISO time, UTC; a date alone means that whole day)',
    created_by: 'Who created it, from revision history ("by Kris", "via Claude (connected app)")',
    modified_by: 'Who changed it last, from revision history',
});

/** The built-in keys a filter uses. */
export function builtInKeysIn(conditions) {
    return [...new Set(conditions.map((condition) => condition.key.toLowerCase()).filter((key) => key in BUILT_IN_FILTER_KEYS))];
}
