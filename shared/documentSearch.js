/**
 * The app's search engine (docs/specs/active/advanced-search.md §6.2): one query over every
 * open database, personal and spaces, read with the shared query language (`searchText.js`)
 * and ordered as the AI agents add-on's search orders, so the same query gives the same
 * Documents in the same order in the app and through the API.
 *
 * It needs no Vue, no store and no particular SQLite: each database is given as
 * `{ dbKey, name, labels, execute(sql, params) }`, where `execute` returns row objects (or a
 * promise of them). The app passes its CR-SQLite WASM repositories; the backend's parity test
 * passes better-sqlite3 handles.
 *
 * Per database, SQL does the cheap work on metadata and with LIKE: every word and phrase, the
 * `in:` folders, Trash, and the order (words found in the title, then `updated_at`, then id,
 * all descending), with `limit + 1` candidates. What LIKE cannot decide (letters outside ASCII
 * that have a case, `is:checklist`, `prop:`, `tag:` without the metadata index) is confirmed
 * in JS: then one pass lists every candidate in order (metadata only, at most 5000), and the
 * bodies the checks need are read by id in batches until the page is full, so the table is
 * scanned once per database however many candidates are rejected. The metadata index, when the
 * caller gives one, answers `tag:` and front matter `prop:` as id lists instead. Only the
 * confirmed page's bodies are read for snippets.
 *
 * Every SQL fragment is a fixed string chosen by the part's type; every value is a bound
 * parameter, and LIKE wildcards in terms are escaped.
 */
import {
    countWords,
    foldedIncludes,
    hasCasedNonAscii,
    hasChecklistItem,
    likeContains,
    likeShape,
    parseSearchQuery,
    quoteSearchValue,
    textPartFound,
} from './searchText.js';
import {
    FRONT_MATTER_SCAN_CHARS,
    localBuiltInEntries,
    matchesFilter,
    readProperties,
} from './propertyFilter.js';
import { readTags } from './frontMatter.js';
import { buildFolderIndex, findFoldersByPath, folderSubtree, trashFolderIds } from './trashFolder.js';

export const DEFAULT_SEARCH_LIMIT = 20;
/** Names that may lead an `in:` path for the personal database, as the sidebar labels it. */
export const PERSONAL_LABELS = Object.freeze(['My Notes']);
export const MAX_SEARCH_LIMIT = 100;
/** Most candidates whose bodies one batch reads, by id. */
const MAX_BATCH = 500;
/**
 * Most candidates per database a query with checks in JS considers (the API's property scan
 * has the same cap); past it the answer says it was cut short.
 */
export const CONFIRM_SCAN_CAP = 5000;

/* ------------------------------------------------------------------ *
 * Order
 * ------------------------------------------------------------------ */

/** A UTF-16 code unit mapped so that comparing mapped units compares code points. */
function codePointOrder(unit) {
    if (unit >= 0xe000) return unit - 0x800;
    if (unit >= 0xd800) return unit + 0x2000;
    return unit;
}

/**
 * Order two strings as SQLite's BINARY collation does (UTF-8 bytes, which is code point
 * order), without Node's Buffer, so the app and the API merge databases alike.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function compareBinary(a, b) {
    const x = String(a ?? '');
    const y = String(b ?? '');
    const length = Math.min(x.length, y.length);
    for (let i = 0; i < length; i += 1) {
        const cx = x.charCodeAt(i);
        const cy = y.charCodeAt(i);
        if (cx !== cy) return codePointOrder(cx) - codePointOrder(cy);
    }
    return x.length - y.length;
}

/**
 * The search order: more words found in the title first, then the most recently updated,
 * then the id, all descending (the API's order).
 * @param {{ title_score: number, updated_at?: string|null, id: string }} a
 * @param {{ title_score: number, updated_at?: string|null, id: string }} b
 * @returns {number}
 */
export function compareSearchRows(a, b) {
    return (b.title_score - a.title_score)
        || compareBinary(b.updated_at ?? '', a.updated_at ?? '')
        || compareBinary(b.id, a.id);
}

/** Whether `row` comes after the cursor in the search order. */
function isAfter(row, cursor) {
    return compareSearchRows({ title_score: cursor.score, updated_at: cursor.updatedAt, id: cursor.id }, row) < 0;
}

/**
 * A cursor as the caller gave it back, or null when it is not one this engine issued.
 * @param {unknown} cursor
 * @returns {{ score: number, updatedAt: string, id: string } | null}
 */
export function readSearchCursor(cursor) {
    if (!cursor || typeof cursor !== 'object') return null;
    const { score, updatedAt, id } = cursor;
    if (!Number.isInteger(score) || score < 0 || typeof updatedAt !== 'string' || typeof id !== 'string' || !id) return null;
    return { score, updatedAt, id };
}

/* ------------------------------------------------------------------ *
 * Folders: `in:` and Trash
 * ------------------------------------------------------------------ */

function sameName(a, b) {
    return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/**
 * Which folders of one database the `in:` parts of a query allow, and whether Trash is
 * searched. A path names folders from the top level of the database; its first name may also
 * be one of the database's `labels` (a space's name), and then the rest is a path inside that
 * database, or the whole database when nothing follows. Trash and everything in it are left
 * out unless a positive `in:` part names a folder inside it (`in:Trash`), or the caller asks
 * for Trash (the API's `include_trash`).
 *
 * @param {import('./trashFolder.js').FolderRow[]} folders
 * @param {Array<{ type: 'in', path: string[], negated: boolean }>} inParts
 * @param {string[]} [labels]
 * @param {{ includeTrash?: boolean }} [options]
 * @returns {{ skip: boolean, include: string[][], exclude: string[], resolved: boolean[], trashIncluded: boolean }}
 *   `skip`: no Document of this database can match. `include`: one folder id list per positive
 *   part that limits folders (each must hold the Document). `exclude`: folder ids no result may
 *   be in. `resolved[i]`: whether part i named anything in this database.
 */
export function resolveFolderScope(folders, inParts, labels = [], { includeTrash = false } = {}) {
    const include = [];
    const excluded = new Set();
    const resolved = [];
    let skip = false;
    let trashIncluded = false;
    const trash = new Set(trashFolderIds(folders));
    for (const part of inParts) {
        const ids = new Set(findFoldersByPath(folders, part.path));
        let whole = false;
        if (labels.some((label) => sameName(label, part.path[0]))) {
            if (part.path.length === 1) whole = true;
            else for (const id of findFoldersByPath(folders, part.path.slice(1))) ids.add(id);
        }
        resolved.push(whole || ids.size > 0);
        if (part.negated) {
            if (whole) skip = true;
            for (const id of folderSubtree(folders, ids)) excluded.add(id);
            continue;
        }
        if (whole) continue;
        if (!ids.size) { skip = true; continue; }
        if ([...ids].some((id) => trash.has(id))) trashIncluded = true;
        include.push([...folderSubtree(folders, ids)]);
    }
    if (!trashIncluded && !includeTrash) for (const id of trash) excluded.add(id);
    return { skip, include, exclude: [...excluded], resolved, trashIncluded };
}

/* ------------------------------------------------------------------ *
 * The plan: SQL fragments and JS checks for a parsed query
 * ------------------------------------------------------------------ */

const TITLE = "coalesce(notes.title, '')";
const BODY = "coalesce(notes.content, '')";

function likeOf(column, part) {
    return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [hasCasedNonAscii(part.value) ? likeShape(part.value) : likeContains(part.value)] };
}

/** "The part's words occur", in SQL: exact for ASCII, a superset (the shape) otherwise. */
function textCondition(part) {
    if (part.field === 'title') return likeOf(TITLE, part);
    if (part.field === 'content') return likeOf(BODY, part);
    const title = likeOf(TITLE, part);
    const body = likeOf(BODY, part);
    return { sql: `(${title.sql} OR ${body.sql})`, params: [...title.params, ...body.params] };
}

/**
 * What one query needs from each database: SQL conditions with their parameters, the title
 * score, and the checks JS must make on candidates.
 */
function planQuery(parts, decided = new Set()) {
    const where = [];
    const confirm = [];
    let needsBody = false;
    let needsHead = false;
    let exactScore = true;
    const scoreParts = [];

    for (const part of parts) {
        // A part the metadata index already decided restricts the ids instead.
        if (decided.has(part)) continue;
        if (part.type === 'text') {
            const folded = hasCasedNonAscii(part.value);
            if (!part.negated) {
                where.push(textCondition(part));
                if (part.field !== 'content') {
                    scoreParts.push(part);
                    if (folded) exactScore = false;
                }
                if (folded) {
                    confirm.push((row) => textPartFound(part, row.title, row.content));
                    if (part.field !== 'title') needsBody = true;
                }
            } else if (!folded) {
                const condition = textCondition(part);
                where.push({ sql: `NOT ${condition.sql.startsWith('(') ? condition.sql : `(${condition.sql})`}`, params: condition.params });
            } else {
                // NOT of a superset would drop Documents that do not match; JS decides.
                confirm.push((row) => !textPartFound(part, row.title, row.content));
                if (part.field !== 'title') needsBody = true;
            }
        } else if (part.type === 'is') {
            // A checklist item has a box, `[ ]` or `[x]` (LIKE folds the X): far fewer Documents
            // than every one with a bracket (links), and still a superset of the rule.
            if (!part.negated) where.push({ sql: `(${BODY} LIKE '%[ ]%' OR ${BODY} LIKE '%[x]%')`, params: [] });
            confirm.push(part.negated ? (row) => !hasChecklistItem(row.content) : (row) => hasChecklistItem(row.content));
            needsBody = true;
        } else if (part.type === 'prop') {
            const { condition } = part;
            const key = condition.key.toLowerCase();
            const builtIn = key === 'word_count' || key === 'created_on' || key === 'modified_on';
            if (key === 'word_count') needsBody = true;
            if (!builtIn) needsHead = true;
            // A key a positive condition needs present must appear near the top: a prefilter,
            // so LIKE's ASCII-only folding is enough (readProperties decides).
            if (!part.negated && !builtIn && condition.operator !== 'missing' && condition.operator !== '!=') {
                where.push({
                    sql: `substr(${BODY}, 1, ${FRONT_MATTER_SCAN_CHARS}) LIKE ? ESCAPE '\\'`,
                    params: [hasCasedNonAscii(condition.key) ? likeShape(condition.key) : likeContains(condition.key)],
                });
            }
            const test = (row) => {
                const entries = [
                    ...localBuiltInEntries({
                        wordCount: key === 'word_count' ? countWords(row.content) : null,
                        createdOn: row.created_at ?? null,
                        modifiedOn: row.updated_at ?? null,
                    }),
                    ...(builtIn ? [] : readProperties(String(row.head ?? row.content ?? '').slice(0, FRONT_MATTER_SCAN_CHARS))),
                ];
                return matchesFilter(entries, [condition]);
            };
            confirm.push(part.negated ? (row) => !test(row) : test);
        } else if (part.type === 'tag') {
            // Without the index: the tags of the first 16 KB, read as the index and the API read them.
            needsHead = true;
            if (!part.negated) {
                where.push({ sql: `substr(${BODY}, 1, ${FRONT_MATTER_SCAN_CHARS}) LIKE ? ESCAPE '\\'`, params: [likeContains('tags')] });
            }
            const test = (row) => readTags(String(row.head ?? row.content ?? '').slice(0, FRONT_MATTER_SCAN_CHARS)).includes(part.name);
            confirm.push(part.negated ? (row) => !test(row) : test);
        }
    }

    const score = scoreParts.length
        ? scoreParts.map((part) => likeOf(TITLE, part))
        : [];
    return {
        where,
        confirm,
        // What confirmation reads besides the metadata row: the whole body, its first 16 KB
        // (front matter), or nothing (a title-only check needs only the title).
        loads: needsBody ? 'body' : needsHead ? 'head' : null,
        exactScore,
        scoreSql: score.length ? score.map((condition) => `(${condition.sql})`).join(' + ') : '0',
        scoreParams: score.flatMap((condition) => condition.params),
        scoreParts,
    };
}

/* ------------------------------------------------------------------ *
 * The metadata index: `prop:` and `tag:` without reading bodies
 * ------------------------------------------------------------------ */

const LOCAL_BUILT_INS = new Set(['word_count', 'created_on', 'modified_on']);

/**
 * @typedef {object} MetadataIndex
 * @property {() => Iterable<[string, { tags: string[], properties: Record<string, string> }]>} entries
 *   every Document of the database with tags or front matter properties (the others have neither)
 * @property {(names: string[]) => Set<string>} idsWithTags the Documents carrying every tag (AND)
 */

/** A Document's front matter properties as the filter reads them. */
function propertyList(properties) {
    return Object.entries(properties || {}).map(([key, value]) => ({ key, value }));
}

/**
 * What a database's metadata index decides about a query's `tag:` and front matter `prop:`
 * parts: Documents that must be among the results (`include`, one id list per part, all of
 * which must hold) and Documents that must not (`exclude`). A Document without tags or front
 * matter is not in the index's entries; whether it passes a part follows from the condition
 * (`owner missing` holds for it, `status = draft` does not), so a part that such Documents
 * pass becomes an exclusion of the indexed ones that fail it, and any other part a list of
 * the ones that pass. Built-in properties (`word_count`, `created_on`, `modified_on`) are not
 * in the index and stay with SQL and the row.
 *
 * @param {import('./searchText.js').SearchPart[]} parts
 * @param {MetadataIndex} index
 * @returns {{ include: string[][], exclude: string[], decided: Set<object> }}
 */
export function metadataRestrictions(parts, index) {
    const include = [];
    const exclude = new Set();
    const decided = new Set();
    let entries = null;
    for (const part of parts) {
        if (part.type === 'tag') {
            const ids = index.idsWithTags([part.name]);
            if (part.negated) for (const id of ids) exclude.add(id);
            else include.push([...ids]);
            decided.add(part);
            continue;
        }
        if (part.type !== 'prop' || LOCAL_BUILT_INS.has(part.condition.key.toLowerCase())) continue;
        entries ??= [...index.entries()];
        const conditions = [part.condition];
        const passes = [];
        const fails = [];
        for (const [id, entry] of entries) {
            (matchesFilter(propertyList(entry.properties), conditions) !== part.negated ? passes : fails).push(id);
        }
        const plainPasses = matchesFilter([], conditions) !== part.negated;
        if (plainPasses) for (const id of fails) exclude.add(id);
        else include.push(passes);
        decided.add(part);
    }
    return { include, exclude: [...exclude], decided };
}

/* ------------------------------------------------------------------ *
 * One database
 * ------------------------------------------------------------------ */

const METADATA = 'notes.id AS id, notes.title AS title, notes.folder_id AS folder_id, notes.pinned AS pinned, notes.created_at AS created_at, notes.updated_at AS updated_at';

function scopeConditions(scope) {
    const conditions = scope.include.map((ids) => ({
        sql: 'notes.folder_id IN (SELECT value FROM json_each(?))',
        params: [JSON.stringify(ids)],
    }));
    if (scope.exclude.length) {
        conditions.push({
            sql: '(notes.folder_id IS NULL OR notes.folder_id NOT IN (SELECT value FROM json_each(?)))',
            params: [JSON.stringify(scope.exclude)],
        });
    }
    for (const ids of scope.includeIds || []) {
        conditions.push({ sql: 'notes.id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(ids)] });
    }
    if (scope.excludeIds?.length) {
        conditions.push({ sql: 'notes.id NOT IN (SELECT value FROM json_each(?))', params: [JSON.stringify(scope.excludeIds)] });
    }
    return conditions;
}

/** Bodies (or their first 16 KB, as `plan.loads` says) of some rows, by id. */
async function readBodies(database, rows, plan) {
    const column = plan.loads === 'head'
        ? `substr(${BODY}, 1, ${FRONT_MATTER_SCAN_CHARS}) AS content`
        : `${BODY} AS content`;
    const found = await database.execute(
        `SELECT notes.id AS id, ${column} FROM notes WHERE notes.id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(rows.map((row) => row.id))],
    );
    const texts = new Map();
    for (const row of found || []) texts.set(row.id, row.content ?? '');
    return texts;
}

function confirmed(row, plan) {
    return plan.confirm.every((check) => check(row));
}

/**
 * Confirm one batch of candidates, in order, adding those that match to `out` until it holds
 * `need`. Bodies read for the check are kept only for the rows that match (and only whole
 * bodies, which the page's snippets can reuse); a rejected row's body is dropped with the
 * batch, so a query that rejects most candidates never holds more than one batch of bodies.
 * The candidate rows are never changed: the check sees a copy with the body attached.
 * @returns {Promise<boolean>} false when cancelled
 */
async function confirmBatch(database, rows, plan, { out, kept, need, stats, isCancelled }) {
    let texts = null;
    if (plan.loads && rows.length) {
        if (isCancelled()) return false;
        texts = await readBodies(database, rows, plan);
        stats.bodiesRead += texts.size;
    }
    for (const row of rows) {
        if (out.length >= need) break;
        const text = texts ? texts.get(row.id) ?? '' : null;
        const candidate = text === null ? row : plan.loads === 'head' ? { ...row, head: text } : { ...row, content: text };
        if (plan.confirm.length && !confirmed(candidate, plan)) continue;
        out.push(row);
        if (text !== null && plan.loads === 'body') kept.set(row.id, text);
    }
    return true;
}

/**
 * Up to `need` Documents of one database that match, in the search order, after `cursor`.
 * @returns {Promise<{ rows: object[], bodies: Map<string, string> } | null>} null when cancelled;
 *   `bodies` holds the whole bodies already read for the rows returned, and nothing else
 */
async function searchOne(database, plan, scope, cursor, need, isCancelled, stats) {
    const conditions = [...plan.where, ...scopeConditions(scope)];
    const where = conditions.length ? conditions.map((condition) => condition.sql).join('\n   AND ') : '1';
    const whereParams = conditions.flatMap((condition) => condition.params);
    const kept = new Map();
    const out = [];
    const context = { out, kept, need, stats, isCancelled };

    if (!plan.exactScore) {
        // LIKE cannot count title words with other cased letters exactly, so the order comes
        // from JS: every candidate's metadata (no bodies), scored on its title, then sorted.
        if (isCancelled()) return null;
        const rows = await database.execute(`SELECT ${METADATA} FROM notes WHERE ${where}`, whereParams);
        stats.scans += 1;
        let ordered = (rows || [])
            .map((row) => ({ ...row, title_score: plan.scoreParts.filter((part) => foldedIncludes(row.title, part.value)).length }))
            .filter((row) => !cursor || isAfter(row, cursor))
            .sort(compareSearchRows);
        const cut = ordered.length > CONFIRM_SCAN_CAP && plan.confirm.length > 0;
        if (cut) ordered = ordered.slice(0, CONFIRM_SCAN_CAP);
        let batch = need;
        for (let start = 0; start < ordered.length && out.length < need; start += batch, batch = Math.min(MAX_BATCH, batch * 2)) {
            if (!await confirmBatch(database, ordered.slice(start, start + batch), plan, context)) return null;
        }
        // Cut short with the page not full: the candidates after the last one checked were not
        // looked at, so the merged page must stop there (see `boundary` in searchDatabases).
        if (cut && out.length < need) {
            stats.truncated = true;
            return { rows: out, bodies: kept, boundary: ordered[ordered.length - 1] };
        }
        return { rows: out, bodies: kept, boundary: null };
    }

    const keyset = cursor
        ? '\n WHERE title_score < ? OR (title_score = ? AND (sort_updated < ? OR (sort_updated = ? AND id < ?)))'
        : '';
    const keysetParams = cursor ? [cursor.score, cursor.score, cursor.updatedAt, cursor.updatedAt, cursor.id] : [];
    // Without checks in JS every row SQL returns matches, so `need` rows are the page. With
    // checks, ONE pass returns every candidate's metadata in order (no bodies, so the sorter
    // holds a few columns per row), capped; the bodies the checks need are then read in
    // batches by id (primary-key lookups), never by scanning the table again. Reading the
    // pages of every body is what a scan costs in the browser, so a query whose checks reject
    // most candidates costs one scan plus the bodies of the candidates, not one scan per batch.
    const limit = plan.confirm.length ? CONFIRM_SCAN_CAP + 1 : need;
    if (isCancelled()) return null;
    let rows = await database.execute(`
SELECT * FROM (
  SELECT ${METADATA}, coalesce(notes.updated_at, '') AS sort_updated, ${plan.scoreSql} AS title_score
    FROM notes
   WHERE ${where}
)${keyset}
 ORDER BY title_score DESC, sort_updated DESC, id DESC
 LIMIT ?`, [...plan.scoreParams, ...whereParams, ...keysetParams, limit]) || [];
    stats.scans += 1;
    const cut = rows.length > CONFIRM_SCAN_CAP;
    if (cut) rows = rows.slice(0, CONFIRM_SCAN_CAP);
    let batch = need;
    for (let start = 0; start < rows.length && out.length < need; start += batch, batch = Math.min(MAX_BATCH, batch * 2)) {
        if (!await confirmBatch(database, rows.slice(start, start + batch), plan, context)) return null;
    }
    // Cut short only matters when the candidates checked did not fill the page; then the merged
    // page must not go past the last candidate checked (see `boundary` in searchDatabases).
    if (cut && out.length < need) {
        stats.truncated = true;
        const last = rows[rows.length - 1];
        return { rows: out, bodies: kept, boundary: { ...last, updated_at: last.sort_updated } };
    }
    return { rows: out, bodies: kept, boundary: null };
}

/* ------------------------------------------------------------------ *
 * Every database
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} SearchDatabase
 * @property {string} dbKey
 * @property {string|null} [name]  the space's name; null for the personal database
 * @property {string[]} [labels]   names that may lead an `in:` path (default: `[name]`)
 * @property {() => Promise<MetadataIndex|null>} [index] the database's metadata index, asked
 *   for only when the query has `tag:` or a front matter `prop:`; null (or no function) means
 *   the first 16 KB of the candidates' bodies are read instead
 * @property {(sql: string, params?: unknown[]) => (object[] | Promise<object[]>)} execute
 */

/**
 * @typedef {object} SearchResultRow
 * @property {string} id
 * @property {string} dbKey
 * @property {string|null} spaceName
 * @property {string|null} title
 * @property {string} content       the body, for snippets
 * @property {string|null} folder_id
 * @property {string} folderPath    names from the top, joined by " / "; '' at the top level
 * @property {boolean} inTrash
 * @property {number} title_score
 * @property {string|null} updated_at
 * @property {string|null} created_at
 * @property {unknown} pinned
 */

/**
 * Search every database. A newer search should make `isCancelled` return true; the older one
 * then stops before its next query and resolves `{ cancelled: true }`.
 *
 * @param {object} input
 * @param {SearchDatabase[]} input.databases
 * @param {string} input.query
 * @param {number} [input.limit] results per page, 1 to 100 (default 20)
 * @param {{ score: number, updatedAt: string, id: string } | null} [input.cursor] `nextCursor` of the page before
 * @param {() => boolean} [input.isCancelled]
 * @returns {Promise<{ results: SearchResultRow[], nextCursor: object|null, notices: string[], terms: string[],
 *   failed?: Array<{ dbKey: string, error: unknown }>, stats?: { bodiesRead: number, bodiesKept: number, indexed: number },
 *   cancelled?: boolean }>} `failed`: databases that could not be read and were left out; `stats`:
 *   bodies read to confirm candidates, and how many of them were kept for the page
 */
export async function searchDatabases({ databases, query, limit = DEFAULT_SEARCH_LIMIT, cursor = null, isCancelled = () => false }) {
    const max = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_SEARCH_LIMIT));
    const parsed = parseSearchQuery(query, { context: 'app', tags: true });
    const notices = [...parsed.notices];
    const empty = { results: [], nextCursor: null, notices, terms: parsed.terms };
    if (!parsed.hasPositive) return empty;
    const position = readSearchCursor(cursor);
    const plan = planQuery(parsed.parts);
    const usesMetadata = parsed.parts.some((part) => part.type === 'tag'
        || (part.type === 'prop' && !LOCAL_BUILT_INS.has(part.condition.key.toLowerCase())));
    const inParts = parsed.parts.filter((part) => part.type === 'in');
    const named = inParts.map(() => false);
    const found = [];
    /** The last candidate checked in a database whose one pass was cut before the page filled. */
    const boundaries = [];
    // How many bodies confirmation read, and how many it kept for the page (at most the page
    // size plus one per database): a check on memory use.
    const stats = { bodiesRead: 0, bodiesKept: 0, indexed: 0, scans: 0, truncated: false };

    const failed = [];
    for (const database of databases || []) {
        if (isCancelled()) return { ...empty, cancelled: true };
        let one;
        let folders;
        try {
            folders = (await database.execute('SELECT id, name, parent_id, created_at FROM folders')) || [];
            const labels = database.labels ?? (database.name ? [database.name] : []);
            const scope = resolveFolderScope(folders, inParts, labels);
            scope.resolved.forEach((resolved, index) => { if (resolved) named[index] = true; });
            if (scope.skip) continue;
            let dbPlan = plan;
            const index = usesMetadata && typeof database.index === 'function' ? await database.index() : null;
            if (isCancelled()) return { ...empty, cancelled: true };
            if (index) {
                const restricted = metadataRestrictions(parsed.parts, index);
                if (restricted.include.some((ids) => ids.length === 0)) continue;
                scope.includeIds = restricted.include;
                scope.excludeIds = restricted.exclude;
                dbPlan = planQuery(parsed.parts, restricted.decided);
                stats.indexed += 1;
            }
            one = await searchOne(database, dbPlan, scope, position, max + 1, isCancelled, stats);
        } catch (error) {
            // One database that cannot be read (a space still loading) does not stop the rest.
            failed.push({ dbKey: database.dbKey, error });
            continue;
        }
        if (!one) return { ...empty, cancelled: true };
        stats.bodiesKept += one.bodies.size;
        if (one.boundary) boundaries.push(one.boundary);
        const folderIndex = buildFolderIndex(folders);
        for (const row of one.rows) found.push({ row, database, folderIndex, bodies: one.bodies });
    }
    inParts.forEach((part, index) => {
        if (!named[index] && !part.negated) notices.push(`No folder matches in:${quoteSearchValue(part.value)}`);
    });
    if (stats.truncated) {
        notices.push(`Only the first ${CONFIRM_SCAN_CAP} Documents that could match in a database were checked; add words or in: to narrow the search.`);
    }
    if (failed.length) notices.push(failed.length === 1 ? 'One database could not be searched.' : `${failed.length} databases could not be searched.`);

    found.sort((a, b) => compareSearchRows(a.row, b.row));
    // A database cut short has unchecked candidates after its last checked one, and they may
    // sort before other databases' rows. So the page stops at the earliest such boundary: rows
    // after it wait for the next page, which starts from the last row shown (or from the
    // boundary itself when nothing comes before it). One cursor, no row skipped or repeated.
    const boundary = boundaries.length ? boundaries.reduce((a, b) => (compareSearchRows(a, b) <= 0 ? a : b)) : null;
    const within = boundary ? found.filter((hit) => compareSearchRows(hit.row, boundary) <= 0) : found;
    const page = within.slice(0, max);

    // Bodies for the page only (confirmation may have read some whole bodies already).
    const byDatabase = new Map();
    for (const hit of page) {
        if (hit.bodies.has(hit.row.id)) continue;
        if (!byDatabase.has(hit.database)) byDatabase.set(hit.database, []);
        byDatabase.get(hit.database).push(hit.row.id);
    }
    const contentOf = new Map();
    for (const [database, ids] of byDatabase) {
        if (isCancelled()) return { ...empty, cancelled: true };
        const rows = await database.execute(
            `SELECT notes.id AS id, ${BODY} AS content FROM notes WHERE notes.id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(ids)],
        );
        for (const row of rows || []) contentOf.set(`${database.dbKey}\n${row.id}`, row.content ?? '');
    }

    const results = page.map(({ row, database, folderIndex, bodies }) => ({
        id: row.id,
        dbKey: database.dbKey,
        spaceName: database.name ?? null,
        title: row.title ?? null,
        content: contentOf.get(`${database.dbKey}\n${row.id}`) ?? bodies.get(row.id) ?? '',
        folder_id: row.folder_id ?? null,
        folderPath: folderIndex.segmentsOf(row.folder_id).join(' / '),
        inTrash: folderIndex.isInTrash(row.folder_id),
        title_score: Number(row.title_score) || 0,
        updated_at: row.updated_at ?? null,
        created_at: row.created_at ?? null,
        pinned: row.pinned,
    }));
    const cursorAt = (row) => ({ score: Number(row.title_score) || 0, updatedAt: row.updated_at ?? '', id: row.id });
    const last = page[page.length - 1]?.row;
    let nextCursor = null;
    if (within.length > max || (boundary && last)) nextCursor = cursorAt(last);
    else if (boundary) nextCursor = cursorAt(boundary);
    return {
        results,
        nextCursor,
        notices,
        terms: parsed.terms,
        failed,
        stats,
    };
}
