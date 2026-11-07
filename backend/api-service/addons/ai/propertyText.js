// Pure helpers for Document properties (docs/specs/proposed/ai-api-expansion.md §4.6):
// the front matter `key: value` pairs at the top of a Document, read with the
// shared parser so the API and the app agree, and a small filter language for
// querying them.
import { parseFrontMatter, unquoteValue } from '@panino/content-merge/front-matter';

/** Most conditions one filter may hold. */
export const MAX_FILTER_CONDITIONS = 5;
/** Longest property key or value the API writes. */
export const MAX_PROPERTY_KEY_LENGTH = 100;
export const MAX_PROPERTY_VALUE_LENGTH = 1000;
/** Front matter is at the top; this much of a body is enough to read it. */
export const FRONT_MATTER_SCAN_CHARS = 16 * 1024;

const OPERATORS = ['>=', '<=', '!=', '^=', '=', '~', '>', '<'];

/**
 * A Document's properties in their order, values unquoted.
 * @param {string} markdown
 * @returns {{ key: string, value: string }[]}
 */
export function readProperties(markdown) {
    const { metadata } = parseFrontMatter(markdown || '');
    return Object.entries(metadata).map(([key, value]) => ({ key, value: unquoteValue(value) }));
}

/**
 * The value of a property, keys compared case-insensitively (as the shared
 * writer does).
 * @param {{ key: string, value: string }[]} properties
 * @param {string} key
 * @returns {string|undefined}
 */
export function propertyValue(properties, key) {
    return findProperty(properties, key)?.value;
}

function findProperty(properties, key) {
    const wanted = key.toLowerCase();
    return properties.find((property) => property.key.toLowerCase() === wanted);
}

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

/** Split on AND (any case) outside quotes. */
function splitConditions(filter) {
    const parts = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < filter.length; i += 1) {
        const char = filter[i];
        if (quote) {
            if (char === quote) quote = null;
            current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        const joiner = /^\s+and\s+/i.exec(filter.slice(i));
        if (joiner) {
            parts.push(current);
            current = '';
            i += joiner[0].length - 1;
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts.map((part) => part.trim()).filter(Boolean);
}

function unquote(text) {
    const match = text.match(/^(["'])(.*)\1$/);
    return match ? match[2] : text;
}

/**
 * Parse a filter such as `status = draft AND priority >= 2 AND due exists`.
 * Conditions are joined by AND (any case). Operators: = != ~ (contains)
 * ^= (starts with) > < >= <=, and the words exists / missing. Values may be
 * quoted; comparisons ignore case.
 * @param {string} filter
 * @returns {{ ok: true, conditions: { key: string, operator: string, value?: string }[] } | { ok: false, error: string }}
 */
export function parseFilter(filter) {
    if (typeof filter !== 'string' || !filter.trim()) return { ok: false, error: 'filter must be non-empty text, e.g. "status = draft".' };
    if (filter.length > 1000) return { ok: false, error: 'filter can be at most 1000 characters.' };
    const parts = splitConditions(filter);
    if (parts.length > MAX_FILTER_CONDITIONS) return { ok: false, error: `A filter can have at most ${MAX_FILTER_CONDITIONS} conditions.` };
    const conditions = [];
    for (const part of parts) {
        const word = part.match(/^(.+?)\s+(exists|missing)$/i);
        if (word) {
            const key = unquote(word[1].trim());
            if (!key || /[:\r\n]/.test(key)) return { ok: false, error: `"${part}" is not a valid condition.` };
            conditions.push({ key, operator: word[2].toLowerCase() });
            continue;
        }
        let found = null;
        for (const operator of OPERATORS) {
            const at = part.indexOf(operator);
            if (at > 0 && (found === null || at < found.at || (at === found.at && operator.length > found.operator.length))) {
                found = { at, operator };
            }
        }
        if (!found) {
            return { ok: false, error: `"${part}" has no operator. Use =, !=, ~ (contains), ^= (starts with), >, <, >=, <=, exists or missing.` };
        }
        const key = unquote(part.slice(0, found.at).trim());
        const value = unquote(part.slice(found.at + found.operator.length).trim());
        if (!key || /[:\r\n]/.test(key)) return { ok: false, error: `"${part}" has no property name before ${found.operator}.` };
        if (!value) return { ok: false, error: `"${part}" has no value after ${found.operator}.` };
        conditions.push({ key, operator: found.operator, value });
    }
    if (conditions.length === 0) return { ok: false, error: 'filter must hold at least one condition.' };
    return { ok: true, conditions };
}

const NUMBER = /^-?\d+(\.\d+)?$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Order two values: numerically when both are numbers, ISO dates as plain text, else ignoring case. */
function compare(a, b) {
    if (NUMBER.test(a) && NUMBER.test(b)) return Number(a) - Number(b);
    if (ISO_DATE.test(a) && ISO_DATE.test(b)) return a < b ? -1 : a > b ? 1 : 0;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/**
 * Built-in properties every Document has, usable in filters by these names.
 * They take precedence over a front matter key of the same name.
 */
export const BUILT_IN_FILTER_KEYS = Object.freeze({
    word_count: 'Number of words in the body',
    created_on: 'When the Document was created (ISO time)',
    modified_on: 'When the Document was last changed (ISO time)',
    created_by: 'Who created it, from revision history ("by Kris", "via Claude (connected app)")',
    modified_by: 'Who changed it last, from revision history',
});

/** The built-in keys a filter uses. */
export function builtInKeysIn(conditions) {
    return [...new Set(conditions.map((condition) => condition.key.toLowerCase()).filter((key) => key in BUILT_IN_FILTER_KEYS))];
}

/**
 * Does a Document's property list satisfy every condition? A property may carry
 * `alternatives`: other spellings `=` and `!=` accept (a person's name or a key's
 * label for an author whose value is "by Kris via Claude (API key)").
 * @param {{ key: string, value: string, alternatives?: string[] }[]} properties
 * @param {{ key: string, operator: string, value?: string }[]} conditions
 */
export function matchesFilter(properties, conditions) {
    return conditions.every(({ key, operator, value }) => {
        const property = findProperty(properties, key);
        const actual = property?.value;
        if (operator === 'exists') return actual !== undefined && actual !== null;
        if (operator === 'missing') return actual === undefined || actual === null;
        if (actual === undefined || actual === null) return operator === '!=';
        const left = actual.toLowerCase();
        const right = value.toLowerCase();
        const spellings = [left, ...(property.alternatives || []).filter(Boolean).map((text) => text.toLowerCase())];
        switch (operator) {
            case '=': return spellings.includes(right);
            case '!=': return !spellings.includes(right);
            case '~': return left.includes(right);
            case '^=': return left.startsWith(right);
            case '>': return compare(actual, value) > 0;
            case '<': return compare(actual, value) < 0;
            case '>=': return compare(actual, value) >= 0;
            case '<=': return compare(actual, value) <= 0;
            default: return false;
        }
    });
}

/** Keys a filter needs present (for a SQL prefilter); `missing` and `!=` need nothing. */
export function requiredKeys(conditions) {
    return [...new Set(conditions
        .filter((condition) => condition.operator !== 'missing' && condition.operator !== '!=')
        .map((condition) => condition.key.toLowerCase()))];
}
