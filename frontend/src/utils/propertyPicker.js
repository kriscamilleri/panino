/**
 * The property picker's rules (docs/specs/active/advanced-search.md §5.4): which keys it
 * offers, the conditions in words and the `parseFilter` operators they map to, when the value
 * is a date, and the `prop:` part it writes. Every part it writes is checked by the search
 * parser, so the picker never builds a condition the parser would refuse.
 */
import { parseSearchQuery, quoteSearchValue } from '@panino/content-merge/search-text';
import { isoParts } from '@panino/content-merge/property-filter';

/** The conditions, in words, in the order the form lists them. */
export const PICKER_CONDITIONS = Object.freeze([
    { id: 'is', label: 'is', operator: '=' },
    { id: 'is-not', label: 'is not', operator: '!=' },
    { id: 'contains', label: 'contains', operator: '~' },
    { id: 'starts-with', label: 'starts with', operator: '^=' },
    { id: 'more-than', label: 'more than', operator: '>' },
    { id: 'less-than', label: 'less than', operator: '<' },
    { id: 'at-least', label: 'at least', operator: '>=' },
    { id: 'at-most', label: 'at most', operator: '<=' },
    { id: 'set', label: 'is set', operator: 'exists' },
    { id: 'not-set', label: 'is not set', operator: 'missing' },
]);

/** The built-in properties the app knows, after the front matter keys. */
export const PICKER_BUILT_INS = Object.freeze([
    { key: 'word_count', label: 'Word count', kind: 'number' },
    { key: 'created_on', label: 'Created on', kind: 'date' },
    { key: 'modified_on', label: 'Modified on', kind: 'date' },
]);

const BUILT_IN_KEYS = new Set(PICKER_BUILT_INS.map((entry) => entry.key));

/**
 * @param {string} id a {@link PICKER_CONDITIONS} id
 * @returns {boolean} whether the condition takes a value (is set / is not set do not)
 */
export function conditionNeedsValue(id) {
    const condition = PICKER_CONDITIONS.find((entry) => entry.id === id);
    return Boolean(condition) && condition.operator !== 'exists' && condition.operator !== 'missing';
}

/**
 * The keys to offer: the front matter keys of the searched databases, grouped
 * case-insensitively (the most used spelling, counts added up), most used first, then the
 * built-ins. A front matter key with a built-in's name is left out, since the built-in wins,
 * and so is `tags`, which `tag:` parts (the tag chips) search.
 *
 * @param {Array<Array<{ key: string, count: number }>>} perDatabase `propertyKeys` of each database
 * @returns {Array<{ key: string, count: number, builtIn: boolean, label: string, kind?: string }>}
 */
export function mergePropertyKeys(perDatabase) {
    const groups = new Map();
    for (const list of perDatabase || []) {
        for (const { key, count } of list || []) {
            const id = String(key).toLowerCase();
            // Built-ins win over a front matter key of their name; tags have tag: parts.
            if (BUILT_IN_KEYS.has(id) || id === 'tags') continue;
            const group = groups.get(id) || { count: 0, spellings: new Map() };
            group.count += count;
            group.spellings.set(key, (group.spellings.get(key) || 0) + count);
            groups.set(id, group);
        }
    }
    const keys = [...groups.values()].map((group) => {
        const [key] = [...group.spellings].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
        return { key, count: group.count, builtIn: false, label: key };
    }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return [...keys, ...PICKER_BUILT_INS.map((entry) => ({ ...entry, count: 0, builtIn: true }))];
}

/**
 * The values seen for a key across databases, compared ignoring case, most used first.
 * @param {Array<Array<{ value: string, count: number }>>} perDatabase
 * @param {number} [limit] Infinity for every value (to decide whether a key holds dates)
 * @returns {Array<{ value: string, count: number }>}
 */
export function mergePropertyValues(perDatabase, limit = 50) {
    const groups = new Map();
    for (const list of perDatabase || []) {
        for (const { value, count } of list || []) {
            const id = String(value).toLowerCase();
            const group = groups.get(id) || { value, count: 0 };
            group.count += count;
            groups.set(id, group);
        }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, limit);
}

/**
 * Whether the value field is a date field: always for `created_on` and `modified_on`, and
 * for a key whose values all read as ISO dates.
 * @param {string} key
 * @param {Array<{ value: string }>} values
 * @returns {boolean}
 */
export function isDateKey(key, values) {
    const id = String(key ?? '').toLowerCase();
    if (id === 'created_on' || id === 'modified_on') return true;
    if (id === 'word_count') return false;
    return values.length > 0 && values.every(({ value }) => isoParts(value) !== null);
}

function sameCondition(found, key, operator, value) {
    if (!found || found.key.toLowerCase() !== key.toLowerCase() || found.operator !== operator) return false;
    return operator === 'exists' || operator === 'missing' ? true : found.value === value;
}

/**
 * Write the `prop:` part for a condition, in the plainest form the parser reads back as the
 * same condition: `prop:status=draft`, `prop:status="in progress"`, `prop:"due date"<=2026-12-01`,
 * `prop:"owner missing"`.
 *
 * @param {{ key: string, condition: string, value?: string }} input condition is a {@link PICKER_CONDITIONS} id
 * @returns {{ ok: true, part: string } | { ok: false, error: string }}
 */
export function buildPropertyPart({ key, condition, value = '' }) {
    const name = String(key ?? '').trim();
    const chosen = PICKER_CONDITIONS.find((entry) => entry.id === condition);
    if (!name) return { ok: false, error: 'Choose a property.' };
    if (!chosen) return { ok: false, error: 'Choose a condition.' };
    if (name.includes('"')) return { ok: false, error: 'This property name cannot be searched: it holds a double quote.' };
    const needsValue = conditionNeedsValue(chosen.id);
    const text = String(value ?? '').trim();
    if (needsValue && !text) return { ok: false, error: 'Enter a value.' };
    if (text.includes('"')) return { ok: false, error: 'A value cannot hold a double quote.' };
    // The search reads runs of white space as one space, so such a value cannot be matched
    // exactly; say how to find it rather than switch the condition silently.
    if (/\s\s|[\t\r\n]/.test(text)) {
        return { ok: false, error: "Values with repeated spaces or tabs can't be searched exactly. Choose \u201ccontains\u201d and type part of it instead." };
    }
    if (/[=<>!~^]/.test(name)) {
        return { ok: false, error: "Property names with =, <, >, !, ~ or ^ can't be searched." };
    }

    const forms = needsValue
        ? [
            `prop:${name}${chosen.operator}${text}`,
            `prop:${name}${chosen.operator}${quoteSearchValue(text)}`,
            `prop:${quoteSearchValue(name)}${chosen.operator}"${text}"`,
        ]
        : [`prop:${quoteSearchValue(`${name} ${chosen.operator}`)}`];
    let lastError = 'This condition cannot be searched.';
    for (const part of forms) {
        const parsed = parseSearchQuery(part, { context: 'app' });
        const found = parsed.parts.length === 1 && parsed.parts[0].type === 'prop' ? parsed.parts[0].condition : null;
        if (sameCondition(found, name, chosen.operator, text)) return { ok: true, part };
        if (parsed.notices.length) lastError = parsed.notices[0];
    }
    return { ok: false, error: lastError };
}

/**
 * Add a part to the end of a query.
 * @param {string} query
 * @param {string} part
 * @returns {string}
 */
export function appendPart(query, part) {
    const text = String(query ?? '').trim();
    return text ? `${text} ${part}` : part;
}
