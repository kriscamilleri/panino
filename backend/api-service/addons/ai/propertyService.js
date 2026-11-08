// Document properties in the v1 API (docs/specs/proposed/ai-api-expansion.md §4.6):
// built-in ones every Document has (title, folder, word count, created and modified
// on and by, pinned) and the front matter `key: value` pairs at the top of its text.
// Read one Document's properties, list the keys in use, query Documents by property
// (built-in or front matter), and set or remove a front matter one. Setting and removing
// edit the body, so they follow every write rule of an edit (serviceCore.js) and land in
// revision history.
//
// Load: a query or key listing reads up to PROPERTY_SCAN_CAP Documents per database, so it
// is built to keep memory flat and work proportional to what a filter needs:
// - SQL picks and orders the Documents by id alone, so its sorter never holds a body;
// - the rows are then read one at a time, and only the first FRONT_MATTER_SCAN_CHARS of a
//   body reach JS, and only when a front matter key is needed;
// - conditions run cheapest first (front matter and dates, then authors, then word
//   counts), each on the Documents still matching; a word count reads one body at a time.
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
import { countWords, hasCasedNonAscii, likeContains, likeShape } from './documentText.js';
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
const AUTHOR_KEYS = ['created_by', 'modified_by'];

// Whitespace String.prototype.trim removes, for SQLite's ltrim: front matter opens on the
// first non-blank line, so a body whose first non-whitespace text is not `---` has none.
const TRIM_CHARS = 'char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, '
    + '8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)';
// Only the first KB is read for that; a body that starts with more blank space than that
// falls back to looking for `---` anywhere in the part that is parsed.
const FRONT_MATTER_PREFILTER = `(CASE
    WHEN ltrim(substr(coalesce(content, ''), 1, 1024), ${TRIM_CHARS}) = ''
        THEN instr(substr(coalesce(content, ''), 1, ${FRONT_MATTER_SCAN_CHARS}), '---') > 0
    ELSE ltrim(substr(coalesce(content, ''), 1, 1024), ${TRIM_CHARS}) LIKE '---%'
END)`;

/** Built-in properties as filterable entries, ahead of front matter so they win on a clash. */
function builtInEntries(builtIn) {
    const actor = (who) => (who ? { value: who.text, alternatives: [who.userName, who.label] } : { value: null });
    return [
        { key: 'word_count', value: builtIn.wordCount === null || builtIn.wordCount === undefined ? null : String(builtIn.wordCount) },
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

/** A word counter for one database that reads one body at a time and remembers the counts. */
function wordCounter(db) {
    const body = db.prepare("SELECT coalesce(content, '') FROM notes WHERE id = ?").pluck();
    const counts = new Map();
    return (id) => {
        if (!counts.has(id)) counts.set(id, countWords(body.get(id) ?? ''));
        return counts.get(id);
    };
}

/**
 * The Documents of one database a query or key listing considers: at most
 * PROPERTY_SCAN_CAP, most recently updated first, in the folder scope and outside Trash
 * unless asked. Without `anyDocument`, only those whose text opens with a front matter
 * block holding every key in `keys`. With `withProperties`, each comes with its front
 * matter properties.
 */
function scanTarget(target, { includeTrash, folderId, keys = [], anyDocument = false, withProperties = true }) {
    const db = target.db;
    const folders = readFolders(db);
    const folderIndex = buildFolderIndex(folders);
    const excluded = includeTrash ? [] : trashFolderIds(folders, folderIndex);
    const scope = folderScope(folders, folderId);
    const scopeMode = !scope ? 0 : scope.rootOnly ? 1 : 2;
    // Each key must appear in the parsed part; a prefilter, so LIKE's ASCII-only case
    // folding is enough (readProperties decides).
    const keyFilter = keys.map(() => `AND substr(coalesce(content, ''), 1, ${FRONT_MATTER_SCAN_CHARS}) LIKE ? ESCAPE '\\'`).join(' ');
    const ids = db.prepare(`
        SELECT id FROM notes
         WHERE (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
           AND (? = 0 OR (? = 1 AND folder_id IS NULL) OR (? = 2 AND folder_id IN (SELECT value FROM json_each(?))))
           AND (? OR ${FRONT_MATTER_PREFILTER})
           ${keyFilter}
         ORDER BY coalesce(updated_at, '') DESC, id DESC
         LIMIT ?
    `).pluck().all(
        JSON.stringify(excluded),
        scopeMode, scopeMode, scopeMode, JSON.stringify(scope?.ids ? [...scope.ids] : []),
        anyDocument ? 1 : 0,
        ...keys.map((key) => (hasCasedNonAscii(key) ? likeShape(key) : likeContains(key))),
        PROPERTY_SCAN_CAP + 1,
    );
    const truncated = ids.length > PROPERTY_SCAN_CAP;
    const capped = ids.slice(0, PROPERTY_SCAN_CAP);
    const order = new Map(capped.map((id, index) => [id, index]));
    const head = withProperties ? `substr(coalesce(content, ''), 1, ${FRONT_MATTER_SCAN_CHARS})` : 'NULL';
    const rows = db.prepare(`
        SELECT id, title, folder_id, created_at, updated_at, pinned, ${head} AS head
          FROM notes WHERE id IN (SELECT value FROM json_each(?))
    `);
    const documents = [];
    for (const { head: text, ...row } of rows.iterate(JSON.stringify(capped))) {
        const properties = withProperties ? readProperties(text) : null;
        if (!anyDocument && !properties?.length) continue;
        documents.push({ row, properties });
    }
    documents.sort((a, b) => order.get(a.row.id) - order.get(b.row.id));
    return { folderIndex, truncated, documents, wordCount: wordCounter(db) };
}

/** Front matter properties of some Documents of one database, read for a page of results. */
function propertiesOf(db, ids) {
    const result = new Map();
    const rows = db.prepare(`SELECT id, substr(coalesce(content, ''), 1, ${FRONT_MATTER_SCAN_CHARS}) AS head
                               FROM notes WHERE id IN (SELECT value FROM json_each(?))`);
    for (const row of rows.iterate(JSON.stringify(ids))) result.set(row.id, readProperties(row.head));
    return result;
}

/**
 * Built-in properties of Documents in one database.
 * @param {Map<string, object>} [authors] from documentAuthorship, if already read
 */
function builtInProperties(row, folderIndex, { authors, wordCount }) {
    const who = authors?.get(row.id) || {};
    return {
        title: row.title ?? '',
        folder: folderIndex.pathOf(row.folder_id),
        wordCount: wordCount ? wordCount(row.id) : null,
        createdOn: row.created_at ?? null,
        createdBy: who.createdBy ?? null,
        modifiedOn: row.updated_at ?? null,
        modifiedBy: who.modifiedBy ?? null,
        pinned: Boolean(row.pinned),
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
    const builtIn = builtInProperties(note, folderIndex, {
        authors: documentAuthorship(ctx, target, [note.id]),
        wordCount: () => countWords(note.content ?? ''),
    });
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

/**
 * Documents whose properties satisfy a filter, most recently updated first. A Document
 * without front matter has every front matter key missing, so `missing` and `!=` consider
 * every Document, as built-in keys do.
 */
export function queryDocumentsByProperty(ctx, { filter, space, folderId, includeTrash = false, limit, offset } = {}) {
    requireAgentScope(ctx, 'read');
    const parsed = parseFilter(filter);
    if (!parsed.ok) throw new ApiError(400, 'INVALID_FILTER', parsed.error);
    const max = parseLimit(limit, 20, 100);
    const start = offset === undefined || offset === null || offset === '' ? 0 : Number(offset);
    if (!Number.isInteger(start) || start < 0) throw invalid('offset must be a whole number of at least 0.');
    const builtIns = builtInKeysIn(parsed.conditions);
    const isBuiltIn = (condition) => builtIns.includes(condition.key.toLowerCase());
    const frontMatter = parsed.conditions.filter((condition) => !isBuiltIn(condition));
    const keys = requiredKeys(frontMatter);
    // Cheapest first: front matter and dates (in the row), then authors (an index lookup per
    // Document), then word counts (a body read per Document).
    const cheap = parsed.conditions.filter((condition) => !isBuiltIn(condition)
        || ['created_on', 'modified_on'].includes(condition.key.toLowerCase()));
    const byAuthor = parsed.conditions.filter((condition) => AUTHOR_KEYS.includes(condition.key.toLowerCase()));
    const byWords = parsed.conditions.filter((condition) => condition.key.toLowerCase() === 'word_count');
    const anyDocument = builtIns.length > 0
        || parsed.conditions.some((condition) => condition.operator === 'missing' || condition.operator === '!=');

    const matches = [];
    let truncated = false;
    for (const target of resolveMany(ctx, space)) {
        const result = scanTarget(target, {
            includeTrash, folderId, keys, anyDocument, withProperties: frontMatter.length > 0,
        });
        truncated ||= result.truncated;
        const builtInOf = (entry, authors) => builtInProperties(entry.row, result.folderIndex, { authors });
        let candidates = result.documents.filter((entry) => matchesFilter(
            [...builtInEntries(builtInOf(entry)), ...(entry.properties || [])], cheap));
        let authors = null;
        if (byAuthor.length && candidates.length) {
            authors = documentAuthorship(ctx, target, candidates.map((entry) => entry.row.id));
            candidates = candidates.filter((entry) => matchesFilter(builtInEntries(builtInOf(entry, authors)), byAuthor));
        }
        if (byWords.length) {
            candidates = candidates.filter((entry) => matchesFilter(builtInEntries({
                ...builtInOf(entry), wordCount: result.wordCount(entry.row.id),
            }), byWords));
        }
        for (const entry of candidates) matches.push({ entry, target, result, authors });
    }
    matches.sort((a, b) => String(b.entry.row.updated_at || '').localeCompare(String(a.entry.row.updated_at || ''))
        || (a.entry.row.id < b.entry.row.id ? 1 : -1));
    const page = matches.slice(start, start + max);
    // Built-in properties and front matter of the returned page, one batch per database;
    // word counts and authors already read for the filter are reused.
    const byTarget = new Map();
    for (const match of page) {
        if (!byTarget.has(match.target)) byTarget.set(match.target, []);
        byTarget.get(match.target).push(match);
    }
    const documents = new Map();
    for (const [target, group] of byTarget) {
        const ids = group.map((match) => match.entry.row.id);
        const authors = group[0].authors ?? documentAuthorship(ctx, target, ids);
        const properties = frontMatter.length ? null : propertiesOf(target.db, ids);
        for (const match of group) {
            const entry = properties ? { ...match.entry, properties: properties.get(match.entry.row.id) || [] } : match.entry;
            const builtIn = builtInProperties(entry.row, match.result.folderIndex, { authors, wordCount: match.result.wordCount });
            documents.set(match, summaryWithProperties(entry, target, match.result.folderIndex, builtIn));
        }
    }
    return {
        filter: filter.trim(),
        conditions: parsed.conditions,
        total: matches.length,
        documents: page.map((match) => documents.get(match)),
        nextOffset: start + max < matches.length ? start + max : null,
        truncated,
        scanned: anyDocument ? 'all' : 'front_matter',
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
