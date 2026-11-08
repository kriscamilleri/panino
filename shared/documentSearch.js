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
 * that have a case, `is:checklist`, `prop:`) is confirmed in JS; when that drops candidates,
 * the database is read again from its last candidate until the page is full or the database
 * has no more. Only the confirmed page's bodies are read for snippets, and only the candidates'
 * bodies for confirmation.
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
import { buildFolderIndex, findFoldersByPath, folderSubtree, trashFolderIds } from './trashFolder.js';

export const DEFAULT_SEARCH_LIMIT = 20;
/** Names that may lead an `in:` path for the personal database, as the sidebar labels it. */
export const PERSONAL_LABELS = Object.freeze(['My Notes']);
export const MAX_SEARCH_LIMIT = 100;
/** Most candidates one refill reads from a database. */
const MAX_BATCH = 500;

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
function planQuery(parts) {
    const where = [];
    const confirm = [];
    let needsBody = false;
    let needsHead = false;
    let exactScore = true;
    const scoreParts = [];

    for (const part of parts) {
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
            if (!part.negated) where.push({ sql: `${BODY} LIKE '%[%]%'`, params: [] });
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
        }
    }

    const score = scoreParts.length
        ? scoreParts.map((part) => likeOf(TITLE, part))
        : [];
    return {
        where,
        confirm,
        needsBody,
        needsHead: needsHead && !needsBody,
        exactScore,
        scoreSql: score.length ? score.map((condition) => `(${condition.sql})`).join(' + ') : '0',
        scoreParams: score.flatMap((condition) => condition.params),
        scoreParts,
    };
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
    return conditions;
}

/** Bodies (or their first 16 KB) for some rows, by id, added to the rows. */
async function attachBodies(database, rows, plan, bodies) {
    const missing = rows.filter((row) => !bodies.has(row.id)).map((row) => row.id);
    if (missing.length) {
        const column = plan.needsHead
            ? `substr(${BODY}, 1, ${FRONT_MATTER_SCAN_CHARS}) AS content`
            : `${BODY} AS content`;
        const found = await database.execute(
            `SELECT notes.id AS id, ${column} FROM notes WHERE notes.id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(missing)],
        );
        for (const row of found || []) bodies.set(row.id, row.content ?? '');
    }
    for (const row of rows) {
        const content = bodies.get(row.id) ?? '';
        if (plan.needsHead) row.head = content;
        else row.content = content;
    }
}

function confirmed(row, plan) {
    return plan.confirm.every((check) => check(row));
}

/**
 * Up to `need` Documents of one database that match, in the search order, after `cursor`.
 * @returns {Promise<{ rows: object[], bodies: Map<string, string> } | null>} null when cancelled
 */
async function searchOne(database, plan, scope, cursor, need, isCancelled) {
    const conditions = [...plan.where, ...scopeConditions(scope)];
    const where = conditions.length ? conditions.map((condition) => condition.sql).join('\n   AND ') : '1';
    const whereParams = conditions.flatMap((condition) => condition.params);
    const bodies = new Map();
    const loadsBodies = plan.confirm.length > 0;
    const out = [];

    if (!plan.exactScore) {
        // LIKE cannot count title words with other cased letters exactly, so the order comes
        // from JS: every candidate's metadata (no bodies), scored on its title, then sorted.
        if (isCancelled()) return null;
        const rows = await database.execute(`SELECT ${METADATA} FROM notes WHERE ${where}`, whereParams);
        const ordered = (rows || [])
            .map((row) => ({ ...row, title_score: plan.scoreParts.filter((part) => foldedIncludes(row.title, part.value)).length }))
            .filter((row) => !cursor || isAfter(row, cursor))
            .sort(compareSearchRows);
        let batch = need;
        for (let start = 0; start < ordered.length && out.length < need; start += batch, batch = Math.min(MAX_BATCH, batch * 2)) {
            const slice = ordered.slice(start, start + batch);
            if (loadsBodies) {
                if (isCancelled()) return null;
                await attachBodies(database, slice, plan, bodies);
            }
            for (const row of slice) {
                if (out.length >= need) break;
                if (!loadsBodies || confirmed(row, plan)) out.push(row);
            }
        }
        return { rows: out, bodies };
    }

    let position = cursor;
    let batch = need;
    for (;;) {
        const keyset = position
            ? '\n WHERE title_score < ? OR (title_score = ? AND (sort_updated < ? OR (sort_updated = ? AND id < ?)))'
            : '';
        const keysetParams = position
            ? [position.score, position.score, position.updatedAt, position.updatedAt, position.id]
            : [];
        if (isCancelled()) return null;
        const rows = await database.execute(`
SELECT * FROM (
  SELECT ${METADATA}, coalesce(notes.updated_at, '') AS sort_updated, ${plan.scoreSql} AS title_score
    FROM notes
   WHERE ${where}
)${keyset}
 ORDER BY title_score DESC, sort_updated DESC, id DESC
 LIMIT ?`, [...plan.scoreParams, ...whereParams, ...keysetParams, batch]) || [];
        if (loadsBodies && rows.length) {
            if (isCancelled()) return null;
            await attachBodies(database, rows, plan, bodies);
        }
        for (const row of rows) {
            if (out.length >= need) break;
            if (!loadsBodies || confirmed(row, plan)) out.push(row);
        }
        if (out.length >= need || rows.length < batch || !loadsBodies) break;
        const last = rows[rows.length - 1];
        position = { score: Number(last.title_score), updatedAt: last.sort_updated, id: last.id };
        batch = Math.min(MAX_BATCH, batch * 2);
    }
    return { rows: out, bodies };
}

/* ------------------------------------------------------------------ *
 * Every database
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} SearchDatabase
 * @property {string} dbKey
 * @property {string|null} [name]  the space's name; null for the personal database
 * @property {string[]} [labels]   names that may lead an `in:` path (default: `[name]`)
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
 *   failed?: Array<{ dbKey: string, error: unknown }>, cancelled?: boolean }>} `failed`: databases that
 *   could not be read and were left out
 */
export async function searchDatabases({ databases, query, limit = DEFAULT_SEARCH_LIMIT, cursor = null, isCancelled = () => false }) {
    const max = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_SEARCH_LIMIT));
    const parsed = parseSearchQuery(query, { context: 'app' });
    const notices = [...parsed.notices];
    const empty = { results: [], nextCursor: null, notices, terms: parsed.terms };
    if (!parsed.hasPositive) return empty;
    const position = readSearchCursor(cursor);
    const plan = planQuery(parsed.parts);
    const inParts = parsed.parts.filter((part) => part.type === 'in');
    const named = inParts.map(() => false);
    const found = [];

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
            one = await searchOne(database, plan, scope, position, max + 1, isCancelled);
        } catch (error) {
            // One database that cannot be read (a space still loading) does not stop the rest.
            failed.push({ dbKey: database.dbKey, error });
            continue;
        }
        if (!one) return { ...empty, cancelled: true };
        const folderIndex = buildFolderIndex(folders);
        for (const row of one.rows) found.push({ row, database, folderIndex, bodies: one.bodies });
    }
    inParts.forEach((part, index) => {
        if (!named[index] && !part.negated) notices.push(`No folder matches in:${quoteSearchValue(part.value)}`);
    });
    if (failed.length) notices.push(failed.length === 1 ? 'One database could not be searched.' : `${failed.length} databases could not be searched.`);

    found.sort((a, b) => compareSearchRows(a.row, b.row));
    const page = found.slice(0, max);

    // Bodies for the page only (confirmation may have read some already, but only their
    // first 16 KB when a property was all it needed).
    const byDatabase = new Map();
    for (const hit of page) {
        const known = hit.bodies.has(hit.row.id) && !hit.row.head;
        if (known) continue;
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
        content: contentOf.get(`${database.dbKey}\n${row.id}`) ?? (row.head ? '' : bodies.get(row.id) ?? ''),
        folder_id: row.folder_id ?? null,
        folderPath: folderIndex.segmentsOf(row.folder_id).join(' / '),
        inTrash: folderIndex.isInTrash(row.folder_id),
        title_score: Number(row.title_score) || 0,
        updated_at: row.updated_at ?? null,
        created_at: row.created_at ?? null,
        pinned: row.pinned,
    }));
    const last = page[page.length - 1]?.row;
    return {
        results,
        nextCursor: found.length > max && last
            ? { score: Number(last.title_score) || 0, updatedAt: last.updated_at ?? '', id: last.id }
            : null,
        notices,
        terms: parsed.terms,
        failed,
    };
}
