// Document properties in the v1 API (docs/specs/proposed/ai-api-expansion.md §4.6):
// built-in ones every Document has (title, folder, word count, created and modified
// on and by, pinned) and the front matter `key: value` pairs at the top of its text.
// Read one Document's properties, list the keys in use, query Documents by property
// (built-in or front matter), and set or remove a front matter one. Setting and removing edit the body, so they follow every write
// rule of an edit (serviceCore.js) and land in revision history.
import { removeFrontMatterKeys, setFrontMatterValues } from '@panino/content-merge/front-matter';
import {
    ApiError,
    announce,
    assertBodySize,
    assertExpected,
    assertNoLiveSession,
    documentSummary,
    locateDocument,
    notFound,
    readFolders,
    readNote,
    requireAgentScope,
    resolveMany,
    snapshotAfter,
    snapshotBefore,
    trashFolderIds,
    updateNote,
    writableDb,
} from './serviceCore.js';
import { documentAuthorship } from './authorship.js';
import { buildFolderIndex, parseLimit } from './keyUtils.js';
import {
    BUILT_IN_FILTER_KEYS,
    builtInKeysIn,
    FRONT_MATTER_SCAN_CHARS,
    matchesFilter,
    parseFilter,
    readProperties,
    requiredKeys,
    validateProperty,
} from './propertyText.js';

/** Documents read per database for a query or a key listing. */
export const PROPERTY_SCAN_CAP = 5000;
const MAX_SAMPLE_VALUES = 5;

/** Words in a body, by the rule the app's Document lists use. */
export function countWords(content) {
    const words = String(content || '').trim().match(/\S+/g);
    return words ? words.length : 0;
}

/**
 * The built-in properties of Documents in one database.
 * @param {object} ctx
 * @param {object} target
 * @param {{ row: object, content?: string }[]} entries rows with id, title, folder_id, created_at, updated_at, pinned
 * @param {object} folderIndex
 * @param {{ authors?: boolean, words?: boolean }} [options] false skips the revision lookup / the word count
 * @returns {Map<string, object>}
 */
function builtInProperties(ctx, target, entries, folderIndex, { authors: withAuthors = true, words = true } = {}) {
    const authors = withAuthors ? documentAuthorship(ctx, target, entries.map((entry) => entry.row.id)) : new Map();
    const missing = words ? entries.filter((entry) => entry.content === undefined).map((entry) => entry.row.id) : [];
    const bodies = new Map();
    if (missing.length) {
        for (const row of target.db.prepare('SELECT id, content FROM notes WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(missing))) {
            bodies.set(row.id, row.content ?? '');
        }
    }
    const result = new Map();
    for (const { row, content } of entries) {
        const who = authors.get(row.id) || {};
        result.set(row.id, {
            title: row.title ?? '',
            folder: folderIndex.pathOf(row.folder_id),
            wordCount: words ? countWords(content ?? bodies.get(row.id) ?? '') : null,
            createdOn: row.created_at ?? null,
            createdBy: who.createdBy ?? null,
            modifiedOn: row.updated_at ?? null,
            modifiedBy: who.modifiedBy ?? null,
            pinned: Boolean(row.pinned),
        });
    }
    return result;
}

/** Built-in properties as filterable entries, ahead of front matter so they win on a clash. */
function builtInEntries(builtIn) {
    const actor = (who) => (who ? { value: who.text, alternatives: [who.userName, who.label] } : { value: null });
    return [
        { key: 'word_count', value: builtIn.wordCount === null ? null : String(builtIn.wordCount) },
        { key: 'created_on', value: builtIn.createdOn },
        { key: 'modified_on', value: builtIn.modifiedOn },
        { key: 'created_by', ...actor(builtIn.createdBy) },
        { key: 'modified_by', ...actor(builtIn.modifiedBy) },
    ];
}

function invalid(message) {
    return new ApiError(400, 'INVALID_INPUT', message);
}

function propertiesObject(list) {
    return Object.fromEntries(list.map(({ key, value }) => [key, value]));
}

/** The folder ids at and below `folderId` ("root": top-level Documents only). */
function folderScope(folders, folderId) {
    if (folderId === undefined || folderId === null || folderId === '') return null;
    if (folderId === 'root') return { rootOnly: true };
    if (!folders.some((folder) => folder.id === folderId)) return { ids: new Set() };
    const children = new Map();
    for (const folder of folders) {
        const key = folder.parent_id ?? null;
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(folder.id);
    }
    const ids = new Set([folderId]);
    const queue = [folderId];
    while (queue.length) {
        for (const child of children.get(queue.shift()) || []) {
            if (!ids.has(child)) { ids.add(child); queue.push(child); }
        }
    }
    return { ids };
}

/**
 * The start of every Document with front matter in a database, most recently
 * updated first. Bodies are cut to the first few KB: front matter is at the top.
 */
function scanTarget(target, { includeTrash, folderId, keys = [], anyDocument = false, fullBody = false }) {
    const db = target.db;
    const folders = readFolders(db);
    const folderIndex = buildFolderIndex(folders);
    const excluded = includeTrash ? [] : trashFolderIds(folders, folderIndex);
    const scope = folderScope(folders, folderId);
    const keyFilter = keys.map(() => 'AND instr(lower(head), ?) > 0').join(' ');
    const rows = db.prepare(`
        SELECT * FROM (
            SELECT id, title, folder_id, created_at, updated_at, pinned,
                   substr(coalesce(content, ''), 1, ?) AS head,
                   CASE WHEN ? THEN coalesce(content, '') END AS body
              FROM notes
             WHERE (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
        )
         WHERE (? OR instr(head, '---') > 0) ${keyFilter}
         ORDER BY coalesce(updated_at, '') DESC, id DESC
         LIMIT ?
    `).all(FRONT_MATTER_SCAN_CHARS, fullBody ? 1 : 0, JSON.stringify(excluded), anyDocument ? 1 : 0, ...keys, PROPERTY_SCAN_CAP + 1);
    const truncated = rows.length > PROPERTY_SCAN_CAP;
    const inScope = rows.slice(0, PROPERTY_SCAN_CAP).filter((row) => {
        if (!scope) return true;
        if (scope.rootOnly) return row.folder_id === null || row.folder_id === undefined;
        return scope.ids.has(row.folder_id);
    });
    return {
        folderIndex,
        truncated,
        documents: inScope
            .map((row) => ({ row, properties: readProperties(row.head), ...(fullBody ? { content: row.body } : {}) }))
            .filter((entry) => anyDocument || entry.properties.length > 0),
    };
}

function summaryWithProperties(entry, target, folderIndex, builtIn) {
    return {
        ...documentSummary(entry.row, target, folderIndex),
        spaceName: target.name,
        createdAt: entry.row.created_at,
        pinned: Boolean(entry.row.pinned),
        builtIn,
        properties: propertiesObject(entry.properties),
    };
}

/** One Document's properties: built-in ones and its front matter. */
export function getDocumentProperties(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, note } = locateDocument(ctx, space, id);
    const folderIndex = buildFolderIndex(readFolders(target.db));
    const list = readProperties(note.content ?? '');
    const builtIn = builtInProperties(ctx, target, [{ row: note, content: note.content ?? '' }], folderIndex).get(note.id);
    return {
        document: {
            ...documentSummary(note, target, folderIndex),
            createdAt: note.created_at,
            pinned: Boolean(note.pinned),
        },
        builtIn,
        properties: propertiesObject(list),
        order: list.map((property) => property.key),
    };
}

/** The property keys in use, with how many Documents use each and their commonest values. */
export function listPropertyKeys(ctx, { space, folderId, includeTrash = false } = {}) {
    requireAgentScope(ctx, 'read');
    const keys = new Map();
    let scanned = 0;
    let truncated = false;
    for (const target of resolveMany(ctx, space)) {
        const result = scanTarget(target, { includeTrash, folderId });
        truncated ||= result.truncated;
        scanned += result.documents.length;
        for (const { properties } of result.documents) {
            for (const { key, value } of properties) {
                const id = key.toLowerCase();
                if (!keys.has(id)) keys.set(id, { key, documents: 0, values: new Map() });
                const entry = keys.get(id);
                entry.documents += 1;
                const valueId = value.toLowerCase();
                const seen = entry.values.get(valueId);
                entry.values.set(valueId, { value: seen?.value ?? value, count: (seen?.count ?? 0) + 1 });
            }
        }
    }
    const list = [...keys.values()]
        .sort((a, b) => b.documents - a.documents || a.key.localeCompare(b.key))
        .map((entry) => {
            const values = [...entry.values.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
            return {
                key: entry.key,
                documents: entry.documents,
                distinctValues: values.length,
                commonValues: values.slice(0, MAX_SAMPLE_VALUES),
            };
        });
    return {
        builtInKeys: Object.entries(BUILT_IN_FILTER_KEYS).map(([key, description]) => ({ key, description })),
        keys: list,
        documentsWithProperties: scanned,
        truncated,
    };
}

/** Documents whose properties satisfy a filter, most recently updated first. */
export function queryDocumentsByProperty(ctx, { filter, space, folderId, includeTrash = false, limit, offset } = {}) {
    requireAgentScope(ctx, 'read');
    const parsed = parseFilter(filter);
    if (!parsed.ok) throw new ApiError(400, 'INVALID_FILTER', parsed.error);
    const max = parseLimit(limit, 20, 100);
    const start = offset === undefined || offset === null || offset === '' ? 0 : Number(offset);
    if (!Number.isInteger(start) || start < 0) throw invalid('offset must be a whole number of at least 0.');
    const builtIns = builtInKeysIn(parsed.conditions);
    const keys = requiredKeys(parsed.conditions).filter((key) => !builtIns.includes(key));
    const needsAuthors = builtIns.includes('created_by') || builtIns.includes('modified_by');

    const matches = [];
    let truncated = false;
    for (const target of resolveMany(ctx, space)) {
        const result = scanTarget(target, {
            includeTrash, folderId, keys,
            anyDocument: builtIns.length > 0,
            fullBody: builtIns.includes('word_count'),
        });
        truncated ||= result.truncated;
        let candidates = result.documents;
        if (builtIns.length) {
            const builtIn = builtInProperties(ctx, target, candidates, result.folderIndex, { authors: needsAuthors, words: builtIns.includes('word_count') });
            candidates = candidates.filter((entry) => matchesFilter([...builtInEntries(builtIn.get(entry.row.id)), ...entry.properties], parsed.conditions));
        } else {
            candidates = candidates.filter((entry) => matchesFilter(entry.properties, parsed.conditions));
        }
        for (const entry of candidates) matches.push({ entry, target, folderIndex: result.folderIndex });
    }
    matches.sort((a, b) => String(b.entry.row.updated_at || '').localeCompare(String(a.entry.row.updated_at || ''))
        || (a.entry.row.id < b.entry.row.id ? 1 : -1));
    const page = matches.slice(start, start + max);
    // Built-in properties of the returned page only, one batch per database.
    const byTarget = new Map();
    for (const match of page) {
        if (!byTarget.has(match.target)) byTarget.set(match.target, []);
        byTarget.get(match.target).push(match);
    }
    const pageBuiltIns = new Map();
    for (const [target, group] of byTarget) {
        const values = builtInProperties(ctx, target, group.map((match) => ({ row: match.entry.row, content: match.entry.content })), group[0].folderIndex);
        for (const [id, value] of values) pageBuiltIns.set(`${target.dbKey}|${id}`, value);
    }
    return {
        filter: filter.trim(),
        conditions: parsed.conditions,
        total: matches.length,
        documents: page.map((match) => summaryWithProperties(match.entry, match.target, match.folderIndex, pageBuiltIns.get(`${match.target.dbKey}|${match.entry.row.id}`))),
        nextOffset: start + max < matches.length ? start + max : null,
        truncated,
    };
}

/** Change a Document's body through `edit(content)`, with every write rule of an edit. */
function editProperties(ctx, { id, space, expectedUpdatedAt }, operation, edit) {
    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, operation);
    const result = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        const before = current.content ?? '';
        const next = edit(before);
        if (next === before) return { row: current, changed: false };
        assertNoLiveSession(db, target, current.id);
        assertBodySize(next);
        snapshotBefore(db, current);
        const row = updateNote(db, current.id, { content: next, updated_at: new Date().toISOString() });
        snapshotAfter(db, row.id, row.title, row.content ?? '', ctx);
        return { row, changed: true };
    })();
    if (result.changed) announce(ctx, target);
    const folderIndex = buildFolderIndex(readFolders(db));
    return {
        document: { ...documentSummary(result.row, target, folderIndex), createdAt: result.row.created_at, pinned: Boolean(result.row.pinned) },
        properties: propertiesObject(readProperties(result.row.content ?? '')),
        changed: result.changed,
    };
}

/** Set one property (adding the front matter block if the Document has none). */
export function setDocumentProperty(ctx, { id, space, key, value, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    const checked = validateProperty(key, value);
    if (!checked.ok) throw invalid(checked.error);
    return editProperties(ctx, { id, space, expectedUpdatedAt }, 'set-property',
        (content) => setFrontMatterValues(content, { [checked.key]: checked.value }));
}

/** Remove one property; removing the last one removes the block. */
export function removeDocumentProperty(ctx, { id, space, key, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    const checked = validateProperty(key, undefined, { requireValue: false });
    if (!checked.ok) throw invalid(checked.error);
    return editProperties(ctx, { id, space, expectedUpdatedAt }, 'remove-property',
        (content) => removeFrontMatterKeys(content, [checked.key]));
}
