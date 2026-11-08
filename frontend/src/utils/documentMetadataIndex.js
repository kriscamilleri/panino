/**
 * The metadata of one database's Documents, in memory: each Document's tags and
 * front matter properties, with the lookups the tag system and search need
 * (docs/specs/active/tag-system.md §7, advanced-search.md §6.3). Pure: the
 * store (`store/documentIndexStore.js`) feeds it rows and keeps it current.
 */
import { canonicalTagName, parseFrontMatter, readTagEntries, unquoteValue } from '@panino/content-merge/front-matter';

/** Front matter is at the top; this much of a body is read (the API's FRONT_MATTER_SCAN_CHARS). */
export const FRONT_MATTER_SCAN_CHARS = 16 * 1024;

/**
 * @typedef {{ tags: string[], tagLabels: Record<string, string>, properties: Record<string, string> }} DocumentMetadata
 */

/** What a Document without tags or properties reads as. */
export const EMPTY_METADATA = Object.freeze({
    tags: Object.freeze([]),
    tagLabels: Object.freeze({}),
    properties: Object.freeze({}),
});

/**
 * A Document's metadata from its text (only the first
 * {@link FRONT_MATTER_SCAN_CHARS} characters are read).
 * @param {string} content
 * @returns {DocumentMetadata}
 */
export function readDocumentMetadata(content) {
    const head = typeof content === 'string' ? content.slice(0, FRONT_MATTER_SCAN_CHARS) : '';
    if (!head.includes('---')) return EMPTY_METADATA;
    const entries = readTagEntries(head);
    const { metadata } = parseFrontMatter(head);
    const keys = Object.keys(metadata);
    if (entries.length === 0 && keys.length === 0) return EMPTY_METADATA;
    const tagLabels = {};
    for (const { name, label } of entries) tagLabels[name] = label;
    const properties = {};
    for (const key of keys) properties[key] = unquoteValue(metadata[key]);
    return Object.freeze({
        tags: Object.freeze(entries.map((entry) => entry.name)),
        tagLabels: Object.freeze(tagLabels),
        properties: Object.freeze(properties),
    });
}

function sameMetadata(a, b) {
    if (a === b) return true;
    if (a.tags.length !== b.tags.length) return false;
    for (let i = 0; i < a.tags.length; i += 1) {
        if (a.tags[i] !== b.tags[i] || a.tagLabels[a.tags[i]] !== b.tagLabels[b.tags[i]]) return false;
    }
    const aKeys = Object.keys(a.properties);
    const bKeys = Object.keys(b.properties);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => b.properties[key] === a.properties[key]);
}

function bump(map, key, by) {
    const next = (map.get(key) || 0) + by;
    if (next > 0) map.set(key, next);
    else map.delete(key);
}

/** The most used key of a count map; ties go to the first in sort order. */
function mostUsed(counts) {
    let best = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
        if (count > bestCount || (count === bestCount && best !== null && key < best)) {
            best = key;
            bestCount = count;
        }
    }
    return best;
}

function byCount(a, b, field) {
    return b.count - a.count || (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0);
}

export class DocumentMetadataIndex {
    constructor() {
        /** @type {Map<string, DocumentMetadata>} Documents with tags or properties */
        this.entries = new Map();
        /** @type {Set<string>} every Document id the index has seen */
        this.known = new Set();
        /** @type {Map<string, Set<string>>} tag → Document ids */
        this.tagDocs = new Map();
        /** @type {Map<string, Map<string, number>>} tag → spelling → Documents */
        this.tagSpellings = new Map();
        /** @type {Map<string, { spellings: Map<string, number>, docs: number, values: Map<string, number> }>} */
        this.propertyStats = new Map();
    }

    /**
     * Record a Document from its text.
     * @param {string} id
     * @param {string} content
     * @returns {boolean} whether its metadata changed
     */
    set(id, content) {
        const next = readDocumentMetadata(content);
        this.known.add(id);
        const previous = this.entries.get(id) || EMPTY_METADATA;
        if (sameMetadata(previous, next)) return false;
        this.#forget(id, previous);
        if (next === EMPTY_METADATA) this.entries.delete(id);
        else this.entries.set(id, next);
        this.#count(id, next);
        return true;
    }

    /**
     * Forget a Document.
     * @param {string} id
     * @returns {boolean} whether it held any metadata
     */
    remove(id) {
        this.known.delete(id);
        const previous = this.entries.get(id);
        if (!previous) return false;
        this.entries.delete(id);
        this.#forget(id, previous);
        return true;
    }

    #count(id, metadata) {
        for (const name of metadata.tags) {
            if (!this.tagDocs.has(name)) this.tagDocs.set(name, new Set());
            this.tagDocs.get(name).add(id);
            if (!this.tagSpellings.has(name)) this.tagSpellings.set(name, new Map());
            bump(this.tagSpellings.get(name), metadata.tagLabels[name], 1);
        }
        for (const [key, value] of Object.entries(metadata.properties)) {
            const lower = key.toLowerCase();
            let stats = this.propertyStats.get(lower);
            if (!stats) {
                stats = { spellings: new Map(), docs: 0, values: new Map() };
                this.propertyStats.set(lower, stats);
            }
            stats.docs += 1;
            bump(stats.spellings, key, 1);
            bump(stats.values, value, 1);
        }
    }

    #forget(id, metadata) {
        for (const name of metadata.tags) {
            const docs = this.tagDocs.get(name);
            docs?.delete(id);
            if (docs && docs.size === 0) this.tagDocs.delete(name);
            const spellings = this.tagSpellings.get(name);
            if (spellings) {
                bump(spellings, metadata.tagLabels[name], -1);
                if (spellings.size === 0) this.tagSpellings.delete(name);
            }
        }
        for (const [key, value] of Object.entries(metadata.properties)) {
            const lower = key.toLowerCase();
            const stats = this.propertyStats.get(lower);
            if (!stats) continue;
            stats.docs -= 1;
            bump(stats.spellings, key, -1);
            bump(stats.values, value, -1);
            if (stats.docs <= 0) this.propertyStats.delete(lower);
        }
    }

    /**
     * @param {string} id
     * @returns {DocumentMetadata|null} null for a Document the index has not seen
     */
    entry(id) {
        return this.entries.get(id) || (this.known.has(id) ? EMPTY_METADATA : null);
    }

    /**
     * The Documents carrying every one of the tags (AND). Names are
     * canonicalised; an empty list or an unusable name matches nothing.
     * @param {string[]} names
     * @returns {Set<string>}
     */
    idsWithTags(names) {
        const wanted = [...new Set((names || []).map(canonicalTagName))];
        if (wanted.length === 0 || wanted.includes(null)) return new Set();
        const sets = wanted.map((name) => this.tagDocs.get(name) || new Set()).sort((a, b) => a.size - b.size);
        const [smallest, ...rest] = sets;
        const result = new Set();
        for (const id of smallest) if (rest.every((set) => set.has(id))) result.add(id);
        return result;
    }

    /** @returns {Map<string, number>} canonical tag → Documents */
    tagCounts() {
        const counts = new Map();
        for (const [name, docs] of this.tagDocs) counts.set(name, docs.size);
        return counts;
    }

    /**
     * The most used spelling of a tag in this database, or null.
     * @param {string} name canonical name
     * @returns {string|null}
     */
    tagLabel(name) {
        const spellings = this.tagSpellings.get(name);
        return spellings ? mostUsed(spellings) : null;
    }

    /** @returns {{ key: string, count: number }[]} property keys, most used first */
    propertyKeys() {
        return [...this.propertyStats.values()]
            .map((stats) => ({ key: mostUsed(stats.spellings), count: stats.docs }))
            .sort((a, b) => byCount(a, b, 'key'));
    }

    /**
     * @param {string} key compared case-insensitively
     * @returns {{ value: string, count: number }[]} values seen for the key, most used first
     */
    propertyValues(key) {
        const stats = this.propertyStats.get(String(key ?? '').toLowerCase());
        if (!stats) return [];
        return [...stats.values].map(([value, count]) => ({ value, count })).sort((a, b) => byCount(a, b, 'value'));
    }
}
