// The v1 Document operations, without HTTP (docs/specs/active/ai-integration.md §7,
// docs/specs/proposed/ai-api-expansion.md §4.1): account, spaces, tree, search, list,
// read (whole, by lines or by section), outline, create, update, exact edits, insertion
// and append. REST and MCP (api/documents.js) are two adapters over these functions, so
// every rule has one implementation; the shared rules are in serviceCore.js and the pure
// text helpers in documentText.js.
import { v4 as uuidv4 } from 'uuid';
import { getAuthDb } from '../../db.js';
import {
    ApiError,
    announce,
    assertBodySize,
    assertExpected,
    assertFolder,
    assertNoLiveSession,
    fullDocument,
    documentSummary,
    locateDocument,
    notFound,
    optionalText,
    reachableTargets,
    readFolders,
    readNote,
    requireAgentScope,
    requireName,
    resolveMany,
    resolveOne,
    snapshotAfter,
    snapshotBefore,
    trashFolderIds,
    TREE_DOCUMENT_CAP,
    updateNote,
    writableDb,
} from './serviceCore.js';
import { appBaseUrl } from './config.js';
import {
    applyEdit,
    compareBinary,
    compareNoCase,
    decodeListCursor,
    documentStats,
    encodeListCursor,
    findHeadings,
    HEADING_POSITIONS,
    INSERT_POSITIONS,
    insertContent,
    LIST_SORTS,
    MAX_OUTLINE_HEADINGS,
    MAX_SEARCH_TERMS,
    parseHeadings,
    parseSearchTerms,
    referencedImageIds,
    SEARCH_FIELDS,
    sliceLines,
    termMatches,
    termsIn,
    trimBlankLines,
} from './documentText.js';
import { buildFolderIndex, makeSnippet, parseLimit } from './keyUtils.js';

export { ApiError, MAX_DOCUMENT_BYTES, requireAgentScope } from './serviceCore.js';

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/** Who the credential belongs to, its access, and the databases it reaches. */
export function getAccount(ctx) {
    requireAgentScope(ctx, 'read');
    const user = getAuthDb().prepare('SELECT id, name, email FROM users WHERE id = ?').get(ctx.userId);
    const databases = reachableTargets(ctx).map((target) => ({
        id: target.spaceId ?? 'personal',
        kind: target.kind,
        name: target.name,
        role: target.role,
    }));
    const { kind, id, name, scope, spaceAccess, expiresAt } = ctx.agent;
    return { user, agent: { kind, id, name, scope, spaceAccess, expiresAt: expiresAt ?? null }, databases };
}

/** Shared spaces the agent can reach. */
export function listSpaces(ctx) {
    requireAgentScope(ctx, 'read');
    const spaces = reachableTargets(ctx)
        .filter((target) => target.kind === 'space')
        .map((target) => ({ id: target.spaceId, name: target.name, role: target.role }));
    return { spaces };
}

/** Folders and Document titles of one database, no bodies. */
export function getTree(ctx, { space } = {}) {
    requireAgentScope(ctx, 'read');
    const target = resolveOne(ctx, space);
    const folders = readFolders(target.db);
    const documents = target.db.prepare(`
        SELECT id, title, folder_id, updated_at FROM notes
         ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?
    `).all(TREE_DOCUMENT_CAP + 1);
    const truncated = documents.length > TREE_DOCUMENT_CAP;
    return {
        space: target.spaceId,
        folders: folders
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_id ?? null })),
        documents: documents.slice(0, TREE_DOCUMENT_CAP).map((row) => ({
            id: row.id, title: row.title, folderId: row.folder_id ?? null, updatedAt: row.updated_at,
        })),
        truncated,
    };
}

/* ------------------------------------------------------------------ *
 * Input helpers
 * ------------------------------------------------------------------ */

/** A whole number from a tool (integer) or a query string (digits), or undefined. */
function wholeNumber(value, label) {
    if (value === undefined || value === null || value === '') return undefined;
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(number)) throw new ApiError(400, 'INVALID_INPUT', `${label} must be a whole number.`);
    return number;
}

function optionalBoolean(value, label) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', `${label} must be true or false.`);
    return value;
}

/** An ISO 8601 time as the canonical UTC string stored timestamps use, or null. */
function isoTime(value, label) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new ApiError(400, 'INVALID_INPUT', `${label} must be an ISO 8601 time, such as 2026-11-01T00:00:00Z.`);
    }
    return new Date(value).toISOString();
}

function oneOf(value, allowed, fallback, label) {
    if (value === undefined || value === null || value === '') return fallback;
    if (!allowed.includes(value)) throw new ApiError(400, 'INVALID_INPUT', `${label} must be one of ${allowed.join(', ')}.`);
    return value;
}

/** A summary with the fields list and search add to the first release's. */
function listedDocument(row, target, folderIndex) {
    return { ...documentSummary(row, target, folderIndex), createdAt: row.created_at ?? null, pinned: Boolean(row.pinned) };
}

/** Folder ids of `folderId` and everything below it (cycles in corrupted data stop the walk). */
function folderSubtree(folders, folderId) {
    const children = new Map();
    for (const folder of folders) {
        if (!folder.parent_id) continue;
        if (!children.has(folder.parent_id)) children.set(folder.parent_id, []);
        children.get(folder.parent_id).push(folder.id);
    }
    const ids = new Set([folderId]);
    const queue = [folderId];
    while (queue.length) {
        for (const child of children.get(queue.shift()) || []) {
            if (ids.has(child)) continue;
            ids.add(child);
            queue.push(child);
        }
    }
    return [...ids];
}

/* ------------------------------------------------------------------ *
 * Search and list
 * ------------------------------------------------------------------ */

const MAX_SEARCH_OFFSET = 10000;

/**
 * Search titles and bodies across databases. Every term must match (a "quoted phrase" is
 * one term), case-insensitively; Documents matching more terms in the title come first,
 * then the most recently updated. SQL filters and orders on metadata only; bodies are read
 * for the page alone, to count matches and cut snippets.
 */
export function searchDocuments(ctx, {
    query, space, limit, includeTrash = false, in: field, folderId, updatedAfter, offset,
} = {}) {
    requireAgentScope(ctx, 'read');
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length < 2 || q.length > 200) {
        throw new ApiError(400, 'INVALID_INPUT', 'The search text must be 2 to 200 characters.');
    }
    const terms = parseSearchTerms(q);
    if (terms.length === 0) throw new ApiError(400, 'INVALID_INPUT', 'The search text has no words to look for.');
    if (terms.length > MAX_SEARCH_TERMS) {
        throw new ApiError(400, 'INVALID_INPUT', `Search for at most ${MAX_SEARCH_TERMS} words or phrases at once.`);
    }
    const where = oneOf(field, SEARCH_FIELDS, 'all', 'in');
    const max = parseLimit(limit, 20, 100);
    const skip = wholeNumber(offset, 'offset') ?? 0;
    if (skip > MAX_SEARCH_OFFSET) throw new ApiError(400, 'INVALID_INPUT', `offset can be at most ${MAX_SEARCH_OFFSET}.`);
    const after = isoTime(updatedAfter, 'updated_after');
    const folder = typeof folderId === 'string' && folderId ? folderId : null;
    const withTrash = includeTrash === true || folder !== null;

    // Fixed SQL fragments, one per term; the terms themselves are bound parameters.
    const TITLE = 'instr(lower(coalesce(title, \'\')), lower(?)) > 0';
    const BODY = 'instr(lower(coalesce(content, \'\')), lower(?)) > 0';
    const filters = terms.map(() => (where === 'title' ? TITLE : where === 'content' ? BODY : `(${TITLE} OR ${BODY})`));
    const filterParams = terms.flatMap((term) => (where === 'all' ? [term, term] : [term]));
    const titleScore = where === 'content' ? '0' : terms.map(() => `(${TITLE})`).join(' + ');
    const titleParams = where === 'content' ? [] : terms;

    const hits = [];
    let folderSeen = folder === null;
    for (const target of resolveMany(ctx, space)) {
        const db = target.db;
        const folders = readFolders(db);
        let inFolders = null;
        if (folder !== null) {
            if (!folders.some((row) => row.id === folder)) continue;
            folderSeen = true;
            inFolders = folderSubtree(folders, folder);
        }
        const folderIndex = buildFolderIndex(folders);
        const excluded = withTrash ? [] : trashFolderIds(folders, folderIndex);
        const rows = db.prepare(`
            SELECT id, title, folder_id, pinned, created_at, updated_at, ${titleScore} AS title_score
              FROM notes
             WHERE ${filters.join(' AND ')}
               AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
               AND (? IS NULL OR folder_id IN (SELECT value FROM json_each(?)))
               AND (? IS NULL OR updated_at > ?)
             ORDER BY title_score DESC, coalesce(updated_at, '') DESC, id DESC
             LIMIT ?
        `).all(
            ...titleParams, ...filterParams, JSON.stringify(excluded),
            inFolders ? 1 : null, JSON.stringify(inFolders ?? []),
            after, after, skip + max + 1,
        );
        for (const row of rows) hits.push({ row, target, folderIndex });
    }
    if (!folderSeen) throw new ApiError(400, 'FOLDER_NOT_FOUND', 'Folder not found in this database.');

    hits.sort((a, b) => b.row.title_score - a.row.title_score
        || compareBinary(b.row.updated_at ?? '', a.row.updated_at ?? '')
        || compareBinary(b.row.id, a.row.id));
    const page = hits.slice(skip, skip + max);

    // Bodies for this page only.
    const bodies = new Map();
    for (const hit of page) {
        if (!bodies.has(hit.target.dbKey)) bodies.set(hit.target.dbKey, { target: hit.target, ids: [] });
        bodies.get(hit.target.dbKey).ids.push(hit.row.id);
    }
    const contentOf = new Map();
    for (const { target, ids } of bodies.values()) {
        const rows = target.db.prepare('SELECT id, content FROM notes WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids));
        for (const row of rows) contentOf.set(`${target.dbKey}\n${row.id}`, row.content ?? '');
    }

    const results = page.map(({ row, target, folderIndex }) => {
        const content = contentOf.get(`${target.dbKey}\n${row.id}`) ?? '';
        const inBody = where === 'title' ? { matchCount: 0, snippets: [] } : termMatches(content, terms);
        const inTitle = where === 'content' ? 0 : termMatches(row.title, terms, 0).matchCount;
        const firstInBody = terms.find((term) => content.toLowerCase().includes(term.toLowerCase())) ?? terms[0];
        return {
            ...listedDocument(row, target, folderIndex),
            spaceName: target.name,
            matchedTitle: where !== 'content' && termsIn(row.title, terms) === terms.length,
            matchCount: inBody.matchCount + inTitle,
            snippet: makeSnippet(content, firstInBody),
            snippets: inBody.snippets,
        };
    });
    return {
        query: q,
        terms,
        in: where,
        offset: skip,
        results,
        nextOffset: hits.length > skip + max ? skip + max : null,
    };
}

/** How each list sort orders rows, in SQL and in JS (for merging databases). */
const LIST_ORDER = {
    updated: {
        key: 'coalesce(updated_at, \'\')',
        descending: true,
        value: (row) => row.updated_at ?? '',
        compare: (a, b) => compareBinary(b.updated_at ?? '', a.updated_at ?? '') || compareBinary(b.id, a.id),
    },
    created: {
        key: 'coalesce(created_at, \'\')',
        descending: true,
        value: (row) => row.created_at ?? '',
        compare: (a, b) => compareBinary(b.created_at ?? '', a.created_at ?? '') || compareBinary(b.id, a.id),
    },
    title: {
        key: 'coalesce(title, \'\') COLLATE NOCASE',
        descending: false,
        value: (row) => row.title ?? '',
        compare: (a, b) => compareNoCase(a.title ?? '', b.title ?? '') || compareBinary(a.id, b.id),
    },
};

/**
 * Documents (metadata only) with cursor paging: most recently updated first by default,
 * or newest first (`created`), or by title A to Z. A cursor carries its sort; one from
 * another sort is refused.
 */
export function listDocuments(ctx, {
    space, folderId, limit, cursor, includeTrash = false, sort, pinnedOnly, updatedAfter,
} = {}) {
    requireAgentScope(ctx, 'read');
    const order = oneOf(sort, LIST_SORTS, 'updated', 'sort');
    const max = parseLimit(limit, 50, 200);
    const position = cursor === undefined || cursor === null || cursor === '' ? null : decodeListCursor(cursor);
    if (cursor && !position) throw new ApiError(400, 'INVALID_INPUT', 'The cursor is not valid.');
    if (position && position.sort !== order) {
        throw new ApiError(400, 'INVALID_INPUT', 'The cursor belongs to a list with another sort. Start again without a cursor.');
    }
    const pinned = optionalBoolean(pinnedOnly, 'pinned_only') ?? false;
    const after = isoTime(updatedAfter, 'updated_after');
    const folder = typeof folderId === 'string' && folderId ? folderId : undefined;
    const withTrash = includeTrash || folder !== undefined;
    const { key, descending, compare } = LIST_ORDER[order];
    // Fixed fragments per sort; never input.
    const beyond = descending ? '<' : '>';
    const direction = descending ? 'DESC' : 'ASC';

    const items = [];
    for (const target of resolveMany(ctx, space)) {
        const db = target.db;
        const folders = readFolders(db);
        const folderIndex = buildFolderIndex(folders);
        const excluded = withTrash ? [] : trashFolderIds(folders, folderIndex);
        const rows = db.prepare(`
            SELECT id, title, folder_id, pinned, created_at, updated_at FROM notes
             WHERE (? IS NULL OR ${key} ${beyond} ? OR (${key} = ? AND id ${beyond} ?))
               AND (? IS NULL OR (CASE WHEN ? = 'root' THEN folder_id IS NULL ELSE folder_id = ? END))
               AND (folder_id IS NULL OR folder_id NOT IN (SELECT value FROM json_each(?)))
               AND (? = 0 OR pinned = 1)
               AND (? IS NULL OR updated_at > ?)
             ORDER BY ${key} ${direction}, id ${direction}
             LIMIT ?
        `).all(
            position ? 1 : null, position?.value ?? '', position?.value ?? '', position?.id ?? '',
            folder ?? null, folder ?? null, folder ?? null,
            JSON.stringify(excluded), pinned ? 1 : 0, after, after, max + 1,
        );
        for (const row of rows) items.push({ row, summary: listedDocument(row, target, folderIndex) });
    }
    items.sort((a, b) => compare(a.row, b.row));
    const page = items.slice(0, max);
    return {
        documents: page.map((item) => item.summary),
        nextCursor: items.length > max ? encodeListCursor(order, page[page.length - 1].row) : null,
    };
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/** The web app's link to a Document, when the app's URL is configured. */
function documentWebUrl(noteId, target) {
    const base = appBaseUrl();
    if (!base || !/^https?:\/\//i.test(base)) return null;
    // The app opens a space Document only when told its database.
    const query = target.kind === 'space' ? `?dbKey=${encodeURIComponent(target.dbKey)}` : '';
    return `${base}/#/doc/${encodeURIComponent(noteId)}${query}`;
}

function revisionCount(db, noteId) {
    return db.prepare('SELECT COUNT(*) AS count FROM note_revisions WHERE note_id = ?').get(noteId).count;
}

function invalidRange(message, totalLines) {
    return new ApiError(400, 'INVALID_RANGE', message, { totalLines });
}

/** One heading by its text (and line, when several share it). */
function resolveHeading(headings, text, line) {
    const matches = findHeadings(headings, text, line);
    if (matches.length === 0) {
        throw new ApiError(400, 'HEADING_NOT_FOUND', 'No heading with that text in this Document.');
    }
    if (matches.length > 1) {
        throw new ApiError(400, 'HEADING_AMBIGUOUS', 'Several headings have that text.', {
            matchCount: matches.length, lines: matches.map((heading) => heading.line),
        });
    }
    return matches[0];
}

/**
 * One Document with its Markdown body and metadata. The body can be limited to lines
 * `startLine`..`endLine` (1-based, inclusive; `endLine` past the end reads to the end) or
 * to one heading's section, or left out with `includeContent: false`.
 */
export function getDocument(ctx, {
    id, space, startLine, endLine, section, headingLine, includeContent,
} = {}) {
    requireAgentScope(ctx, 'read');
    const first = wholeNumber(startLine, 'start_line');
    const last = wholeNumber(endLine, 'end_line');
    const atLine = wholeNumber(headingLine, 'heading_line');
    const sectionName = optionalText(section, 'section');
    const withContent = optionalBoolean(includeContent, 'include_content') ?? true;
    const { target, note } = locateDocument(ctx, space, id);

    const content = note.content ?? '';
    const stats = documentStats(content);
    const totalLines = stats.lineCount;
    let range = totalLines > 0 ? { startLine: 1, endLine: totalLines } : null;
    let sectionInfo;
    if (sectionName !== undefined && sectionName !== '') {
        if (first !== undefined || last !== undefined) {
            throw new ApiError(400, 'INVALID_INPUT', 'Give either section or start_line/end_line, not both.');
        }
        const heading = resolveHeading(parseHeadings(content), sectionName, atLine);
        range = { startLine: heading.line, endLine: heading.endLine };
        sectionInfo = { text: heading.text, level: heading.level, slug: heading.slug, line: heading.line };
    } else if (first !== undefined || last !== undefined) {
        const from = first ?? 1;
        if (from < 1) throw invalidRange('start_line starts at 1.', totalLines);
        if (from > totalLines) throw invalidRange(`start_line is past the end: the Document has ${totalLines} lines.`, totalLines);
        if (last !== undefined && last < from) throw invalidRange('end_line must not be before start_line.', totalLines);
        range = { startLine: from, endLine: Math.min(last ?? totalLines, totalLines) };
    }

    const document = {
        ...fullDocument(note, target, buildFolderIndex(readFolders(target.db))),
        ...stats,
        revisionCount: revisionCount(target.db, note.id),
        imageIds: referencedImageIds(content),
        webUrl: documentWebUrl(note.id, target),
        totalLines,
        range,
        partial: withContent && range !== null && (range.startLine > 1 || range.endLine < totalLines),
        ...(sectionInfo ? { section: sectionInfo } : {}),
    };
    if (!withContent) delete document.content;
    else if (document.partial) document.content = sliceLines(content, range.startLine, range.endLine);
    return { document };
}

/** A Document's headings: level, text, slug, the line each starts on and its section's last line. */
export function getDocumentOutline(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, note } = locateDocument(ctx, space, id);
    const summary = documentSummary(note, target, buildFolderIndex(readFolders(target.db)));
    const headings = parseHeadings(note.content ?? '');
    return {
        document: { id: summary.id, title: summary.title, space: summary.space, folderPath: summary.folderPath, updatedAt: summary.updatedAt },
        totalLines: documentStats(note.content).lineCount,
        headings: headings.slice(0, MAX_OUTLINE_HEADINGS).map(({ level, text, slug, line, endLine }) => ({ level, text, slug, line, endLine })),
        truncated: headings.length > MAX_OUTLINE_HEADINGS,
    };
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/** Create a Document; the body defaults to a heading with the title. */
export function createDocument(ctx, { space, title, content, folderId } = {}) {
    requireAgentScope(ctx, 'write');
    const target = resolveOne(ctx, space);
    const name = requireName(title, 'title');
    const body = optionalText(content, 'content') ?? `# ${name}\n\n`;
    assertBodySize(body);
    const folder = folderId === undefined || folderId === '' || folderId === 'root' ? null : folderId;

    const db = writableDb(target, 'create-document');
    const id = uuidv4();
    const now = new Date().toISOString();
    const created = db.transaction(() => {
        assertFolder(db, folder);
        if (target.kind === 'personal') {
            db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.userId, folder, name, body, now, now);
        } else {
            db.prepare(`INSERT INTO notes (id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)`).run(id, folder, name, body, now, now);
        }
        snapshotAfter(db, id, name, body, ctx);
        return readNote(db, id);
    })();
    announce(ctx, target);
    return { document: fullDocument(created, target, buildFolderIndex(readFolders(db))) };
}

/** Change title, body, folder or pin. */
export function updateDocument(ctx, { id, space, title, content, folderId, pinned, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    const changes = {};
    if (title !== undefined) changes.title = requireName(title, 'title');
    if (content !== undefined) {
        optionalText(content, 'content');
        assertBodySize(content);
        changes.content = content;
    }
    if (folderId !== undefined) changes.folder_id = folderId === 'root' || folderId === '' ? null : folderId;
    if (pinned !== undefined) {
        if (typeof pinned !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'pinned must be true or false.');
        changes.pinned = pinned ? 1 : 0;
    }
    if (Object.keys(changes).length === 0) {
        throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Send at least one of title, content, folderId or pinned.');
    }

    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, 'update-document');
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
        if (changes.folder_id !== undefined) assertFolder(db, changes.folder_id);
        const textChanges = changes.title !== undefined || changes.content !== undefined;
        if (textChanges) snapshotBefore(db, current);
        const row = updateNote(db, current.id, { ...changes, updated_at: new Date().toISOString() });
        if (textChanges) snapshotAfter(db, row.id, row.title, row.content ?? '', ctx);
        return row;
    })();
    announce(ctx, target);
    return { document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) };
}

/** Append Markdown to the end of a Document (a blank line apart by default). */
export function appendToDocument(ctx, { id, space, content, separator, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    if (typeof content !== 'string' || !content) {
        throw new ApiError(400, 'INVALID_INPUT', 'content must be non-empty text.');
    }
    if (separator !== undefined && (typeof separator !== 'string' || separator.length > 100)) {
        throw new ApiError(400, 'INVALID_INPUT', 'separator must be text of at most 100 characters.');
    }

    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, 'append-document');
    const updated = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
        const existing = current.content ?? '';
        let next;
        if (!existing.trim()) next = content;
        else if (separator !== undefined) next = existing + separator + content;
        else next = `${existing.replace(/\s+$/, '')}\n\n${content}`;
        assertBodySize(next);
        snapshotBefore(db, current);
        const row = updateNote(db, current.id, { content: next, updated_at: new Date().toISOString() });
        snapshotAfter(db, row.id, row.title, row.content ?? '', ctx);
        return row;
    })();
    announce(ctx, target);
    return { document: fullDocument(updated, target, buildFolderIndex(readFolders(db))) };
}

/**
 * Write a new body under the same rules as updateDocument: a healthy connection, the
 * expected version, no live session, the size cap, revisions before and after, and an
 * announcement. `change(current)` returns `{ content, ...extra }` from the stored body, or
 * throws. An unchanged body is not written.
 */
function rewriteBody(ctx, { id, space, expectedUpdatedAt, operation }, change) {
    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, operation);
    let wrote = false;
    const { row, extra } = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertExpected(current, expectedUpdatedAt);
        assertNoLiveSession(db, target, current.id);
        const { content: next, ...rest } = change(current.content ?? '');
        if (next === (current.content ?? '')) return { row: current, extra: rest };
        assertBodySize(next);
        snapshotBefore(db, current);
        const updated = updateNote(db, current.id, { content: next, updated_at: new Date().toISOString() });
        snapshotAfter(db, updated.id, updated.title, updated.content ?? '', ctx);
        wrote = true;
        return { row: updated, extra: rest };
    })();
    if (wrote) announce(ctx, target);
    return { document: fullDocument(row, target, buildFolderIndex(readFolders(db))), ...extra };
}

/**
 * Replace exact text in a Document's body. `oldText` must occur exactly once, unless
 * `replaceAll`; an empty `newText` deletes it.
 */
export function editDocument(ctx, { id, space, oldText, newText, replaceAll, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    if (typeof oldText !== 'string' || oldText === '') {
        throw new ApiError(400, 'INVALID_INPUT', 'old_text must be non-empty text: the exact text to replace.');
    }
    if (typeof newText !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'new_text must be text (empty to delete old_text).');
    const all = optionalBoolean(replaceAll, 'replace_all') ?? false;
    return rewriteBody(ctx, { id, space, expectedUpdatedAt, operation: 'edit-document' }, (content) => {
        const result = applyEdit(content, oldText, newText, all);
        if (!result.ok && result.reason === 'no_match') {
            throw new ApiError(400, 'EDIT_NO_MATCH', 'old_text does not occur in the Document.');
        }
        if (!result.ok) {
            throw new ApiError(400, 'EDIT_AMBIGUOUS', 'old_text occurs more than once in the Document.', { matchCount: result.matchCount });
        }
        return { content: result.content, replacements: result.replacements, line: result.line };
    });
}

/**
 * Insert Markdown at the start (after any front matter), at the end, before or after a
 * heading, or at the end of a heading's section, a blank line apart from its neighbours.
 */
export function insertIntoDocument(ctx, { id, space, content, position, heading, headingLine, expectedUpdatedAt } = {}) {
    requireAgentScope(ctx, 'write');
    if (typeof content !== 'string' || trimBlankLines(content) === '') {
        throw new ApiError(400, 'INVALID_INPUT', 'content must be non-empty text.');
    }
    if (!INSERT_POSITIONS.includes(position)) {
        throw new ApiError(400, 'INVALID_INPUT', `position must be one of ${INSERT_POSITIONS.join(', ')}.`);
    }
    const byHeading = HEADING_POSITIONS.includes(position);
    if (byHeading && (typeof heading !== 'string' || !heading.trim())) {
        throw new ApiError(400, 'INVALID_INPUT', `heading is required for position ${position}: the text of a heading in the Document.`);
    }
    const atLine = wholeNumber(headingLine, 'heading_line');
    return rewriteBody(ctx, { id, space, expectedUpdatedAt, operation: 'insert-document' }, (body) => {
        const target = byHeading ? resolveHeading(parseHeadings(body), heading, atLine) : undefined;
        const result = insertContent(body, content, position, target);
        return { content: result.content, line: result.line };
    });
}
