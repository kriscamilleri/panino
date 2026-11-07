// Documents in the v1 API: account, spaces, tree, search, list, read, outline, create
// and edit, as MCP tools, REST routes and OpenAPI paths (docs/specs/active/ai-integration.md
// §5.3, docs/specs/proposed/ai-api-expansion.md §4.1). The rules are in documentService.js;
// this file only adapts.
import {
    ApiError,
    appendToDocument,
    createDocument,
    editDocument,
    getAccount,
    getDocument,
    getDocumentOutline,
    getTree,
    insertIntoDocument,
    listDocuments,
    listSpaces,
    searchDocuments,
    updateDocument,
} from '../documentService.js';
import { INSERT_POSITIONS, LIST_SORTS, SEARCH_FIELDS } from '../documentText.js';
import { documentSummary, errors, errorSchema, fullDocument, idPath, json, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, flag, handler, spaceParam, wantsTrash } from './restKit.js';
import {
    ADDITIVE,
    ArgumentError,
    bool,
    DESTRUCTIVE,
    documentHeader,
    documentLine,
    EXPECTED,
    ID_HINT,
    int,
    object,
    READ,
    reader,
    SPACE_FOR_EXISTING,
    SPACE_FOR_NEW,
    str,
    where,
} from './toolKit.js';

/** Line ranges in result text: "lines 3–10 of 40". */
function linesText(range, totalLines) {
    if (!range) return '0 lines';
    return range.startLine === range.endLine
        ? `line ${range.startLine} of ${totalLines}`
        : `lines ${range.startLine}–${range.endLine} of ${totalLines}`;
}

/** The metadata lines get_document adds under the shared header. */
function documentDetails(doc) {
    return [
        `created_at: ${doc.createdAt || 'unknown'}${doc.createdBy ? ` ${doc.createdBy.text}` : ''}`,
        `last change: ${doc.modifiedBy ? doc.modifiedBy.text : 'author not recorded'}`,
        `pinned: ${doc.pinned ? 'yes' : 'no'}`,
        ...(Object.keys(doc.properties || {}).length
            ? [`properties: ${Object.entries(doc.properties).map(([key, value]) => `${key}: ${value}`).join('; ')}`] : []),
        `size: ${doc.wordCount} words, ${doc.characterCount} characters, ${doc.lineCount} lines`,
        `revisions: ${doc.revisionCount}`,
        `images: ${doc.imageIds.length ? doc.imageIds.join(', ') : 'none'}`,
        ...(doc.webUrl ? [`web_url: ${doc.webUrl}`] : []),
        ...(doc.section ? [`section: "${doc.section.text}" (level ${doc.section.level}, slug ${doc.section.slug})`] : []),
        ...(doc.content === undefined
            ? ['text: not included (include_content was false)']
            : doc.partial ? [`showing: ${linesText(doc.range, doc.totalLines)}`] : []),
    ].join('\n');
}

/** Extra facts an error's details give the model, after its next-step sentence. */
const DETAIL_TEXT = {
    EDIT_AMBIGUOUS: (details) => (details?.matchCount ? ` It occurs ${details.matchCount} times.` : ''),
    HEADING_AMBIGUOUS: (details) => (details?.lines?.length ? ` Those headings start on lines ${details.lines.join(', ')}.` : ''),
    INVALID_RANGE: (details) => (Number.isInteger(details?.totalLines) ? ` The Document has ${details.totalLines} lines.` : ''),
};

/**
 * Tool errors whose details matter to the model (a count, line numbers) carry them in the
 * text: the shared error mapping in mcpTools.js adds only the next-step sentence.
 */
function withDetails(run) {
    return async (ctx, args) => {
        try {
            return await run(ctx, args);
        } catch (error) {
            if (error instanceof ApiError && DETAIL_TEXT[error.code] && nextSteps[error.code]) {
                throw new ArgumentError(`${nextSteps[error.code]}${DETAIL_TEXT[error.code](error.details)}`);
            }
            throw error;
        }
    };
}

export const tools = [

    {
        name: 'get_account',
        title: 'Panino account',
        description: 'Who this connection belongs to, whether it may write, and which databases (personal and shared spaces) it can reach. Call it first if you are unsure what you can do.',
        access: 'read',
        annotations: READ,
        inputSchema: object(),
        run(ctx) {
            const result = getAccount(ctx);
            const lines = [
                `Signed in as ${result.user?.name || 'unknown'}${result.user?.email ? ` <${result.user.email}>` : ''}.`,
                `Access: ${result.agent.scope === 'write' ? 'read and write' : 'read only'} (${result.agent.kind === 'app' ? 'connected app' : 'API key'} "${result.agent.name}").`,
                'Databases:',
                ...result.databases.map((db) => `- ${db.kind === 'personal' ? 'Personal (space "personal")' : `${db.name} (space id ${db.id}, ${db.role})`}`),
            ];
            return { text: lines.join('\n'), structured: result };
        },
    },
    {
        name: 'list_spaces',
        title: 'List shared spaces',
        description: 'The shared spaces this connection can reach, with their ids. Pass a space id as "space" to other tools to work in that space.',
        access: 'read',
        annotations: READ,
        inputSchema: object(),
        run(ctx) {
            const result = listSpaces(ctx);
            const text = result.spaces.length
                ? result.spaces.map((space, i) => `${i + 1}. ${space.name} — space id ${space.id} — role ${space.role}`).join('\n')
                : 'No shared spaces are reachable. Everything is in the personal database.';
            return { text, structured: result };
        },
    },
    {
        name: 'search_documents',
        title: 'Search Documents',
        description: 'Find Documents across every reachable database. Every word must occur (case-insensitive); put a phrase in "double quotes" to keep it together. Documents with the words in the title come first, then the most recently updated. Each result has an id, a match count and up to 3 snippets with line numbers (read around them with get_document start_line/end_line). Use this before reading or editing a Document.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            query: str('Words to look for, 2 to 200 characters in all. All must occur. "Quoted phrases" stay together. No other operators.'),
            in: { type: 'string', enum: [...SEARCH_FIELDS], description: 'Optional. Where to look: "all" (default, title or text), "title", or "content" (text only).' },
            folder_id: str('Optional. Only this folder (id from list_folders) and its subfolders.'),
            updated_after: str('Optional. Only Documents updated after this ISO 8601 time, such as 2026-11-01T00:00:00Z.'),
            space: str('Optional. "all" (default) for every database, "personal", or a space id from list_spaces.'),
            limit: int('Optional. Most results to return, 1 to 100. Default 20.'),
            offset: int('Optional. Skip this many results, for the next page. Default 0.'),
            include_trash: bool('Optional. Also search Documents in the Trash folder. Default false.'),
        }, ['query']),
        run(ctx, args) {
            const get = reader(args);
            const result = searchDocuments(ctx, {
                query: get('query', 'string', { required: true }),
                in: get('in', 'string'),
                folderId: get('folder_id', 'string'),
                updatedAfter: get('updated_after', 'string'),
                space: get('space', 'string'),
                limit: get('limit', 'integer'),
                offset: get('offset', 'integer'),
                includeTrash: get('include_trash', 'boolean') ?? false,
            });
            const lines = result.results.map((doc, i) => [
                `${documentLine(doc, result.offset + i)} — ${doc.matchCount} ${doc.matchCount === 1 ? 'match' : 'matches'}`,
                ...doc.snippets.map((snippet) => `   line ${snippet.line}: ${snippet.text}`),
                ...(doc.snippets.length === 0 && doc.snippet ? [`   ${doc.snippet}`] : []),
            ].join('\n'));
            let text;
            if (lines.length) {
                text = [...lines, ...(result.nextOffset !== null ? [`More results: call again with offset ${result.nextOffset}.`] : [])].join('\n');
            } else {
                text = result.offset > 0 ? 'No more results.' : `No Documents match ${result.terms.map((term) => `"${term}"`).join(' and ')}.`;
            }
            return { text, structured: result };
        },
    },
    {
        name: 'list_documents',
        title: 'List Documents',
        description: 'Documents without their text: most recently updated first, newest first (sort "created"), or by title. Use folder_id to list one folder, pinned_only for pinned Documents, updated_after for recent changes. If next_cursor is given, call again with it (and the same sort) for the next page.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str('Optional. "all" (default), "personal", or a space id from list_spaces.'),
            folder_id: str('Optional. Only this folder (id from list_folders), or "root" for the top level.'),
            sort: { type: 'string', enum: [...LIST_SORTS], description: 'Optional. "updated" (default, most recent first), "created" (newest first) or "title" (A to Z).' },
            pinned_only: bool('Optional. Only pinned Documents. Default false.'),
            updated_after: str('Optional. Only Documents updated after this ISO 8601 time, such as 2026-11-01T00:00:00Z.'),
            limit: int('Optional. Page size, 1 to 200. Default 50.'),
            cursor: str('Optional. next_cursor from the previous call, with the same sort.'),
            include_trash: bool('Optional. Include Documents in the Trash folder. Default false.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const sort = get('sort', 'string');
            const result = listDocuments(ctx, {
                space: get('space', 'string'),
                folderId: get('folder_id', 'string'),
                sort,
                pinnedOnly: get('pinned_only', 'boolean'),
                updatedAfter: get('updated_after', 'string'),
                limit: get('limit', 'integer'),
                cursor: get('cursor', 'string'),
                includeTrash: get('include_trash', 'boolean') ?? false,
            });
            const lines = result.documents.map((doc, i) => [
                documentLine(doc, i),
                ...(sort === 'created' ? [`created ${doc.createdAt || 'unknown'}`] : []),
                ...(doc.pinned ? ['pinned'] : []),
            ].join(' — '));
            const text = [lines.length ? lines.join('\n') : 'No Documents.', ...(result.nextCursor ? [`next_cursor: ${result.nextCursor}`] : [])].join('\n');
            return { text, structured: { documents: result.documents, next_cursor: result.nextCursor } };
        },
    },
    {
        name: 'list_folders',
        title: 'List folders',
        description: 'The folder tree of one database with the titles and ids of its Documents (no text). Use it to find folder ids for create_document or list_documents.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str('Optional. "personal" (default) or a space id from list_spaces.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const result = getTree(ctx, { space: get('space', 'string') });
            const children = new Map();
            for (const folder of result.folders) {
                const key = folder.parentId ?? 'root';
                if (!children.has(key)) children.set(key, []);
                children.get(key).push(folder);
            }
            const docsIn = new Map();
            for (const doc of result.documents) {
                const key = doc.folderId ?? 'root';
                if (!docsIn.has(key)) docsIn.set(key, []);
                docsIn.get(key).push(doc);
            }
            const lines = [];
            const seen = new Set();
            const walk = (key, depth) => {
                for (const doc of docsIn.get(key) || []) lines.push(`${'  '.repeat(depth)}- ${doc.title || '(untitled)'} (id ${doc.id})`);
                for (const folder of children.get(key) || []) {
                    if (seen.has(folder.id)) continue;
                    seen.add(folder.id);
                    lines.push(`${'  '.repeat(depth)}+ ${folder.name}/ (folder id ${folder.id})`);
                    walk(folder.id, depth + 1);
                }
            };
            walk('root', 0);
            if (result.truncated) lines.push('(Only the first 5000 Documents are shown.)');
            return { text: lines.length ? lines.join('\n') : 'This database is empty.', structured: result };
        },
    },
    {
        name: 'get_document',
        title: 'Read a Document',
        description: 'The Markdown text of one Document with its title, folder, updated_at, word and line counts, revision count, referenced image ids and web link. For a long Document read part of it: one section by its heading (section), or a range of lines (start_line/end_line); get_document_outline lists the headings with their lines. Keep updated_at: pass it as expected_updated_at when you edit.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            id: str(ID_HINT),
            section: str('Optional. Read only this heading\'s section: the heading text (case-insensitive), from the heading to the next heading of the same or a higher level.'),
            heading_line: int('Optional. With section, when several headings share that text: the line the heading starts on (from get_document_outline).'),
            start_line: int('Optional. First line to read, from 1. Default 1. Not with section.'),
            end_line: int('Optional. Last line to read (inclusive). Default: the last line. Not with section.'),
            include_content: bool('Optional. false returns the metadata only, without the text. Default true.'),
            space: str(SPACE_FOR_EXISTING),
        }, ['id']),
        run: withDetails((ctx, args) => {
            const get = reader(args);
            const { document } = getDocument(ctx, {
                id: get('id', 'string', { required: true }),
                section: get('section', 'string'),
                headingLine: get('heading_line', 'integer'),
                startLine: get('start_line', 'integer'),
                endLine: get('end_line', 'integer'),
                includeContent: get('include_content', 'boolean'),
                space: get('space', 'string'),
            });
            const header = `${documentHeader(document)}\n${documentDetails(document)}`;
            return { text: document.content === undefined ? header : `${header}\n\n${document.content}`, structured: { document } };
        }),
    },
    {
        name: 'get_document_outline',
        title: 'Outline of a Document',
        description: 'The headings of one Document, in order, with their level, text, slug, the line each starts on and the last line of its section. Use it to read one section of a long Document (get_document with section, or start_line/end_line), or to pick a heading for insert_into_document.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = getDocumentOutline(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const title = result.document.title || '(untitled)';
            const headingLine = (heading) => `${'  '.repeat(heading.level - 1)}${'#'.repeat(heading.level)} ${heading.text || '(empty heading)'}`
                + ` — ${linesText({ startLine: heading.line, endLine: heading.endLine }, result.totalLines)} — slug ${heading.slug}`;
            const text = result.headings.length
                ? [
                    `Outline of "${title}" (id ${result.document.id}), ${result.totalLines} lines, updated_at ${result.document.updatedAt}:`,
                    ...result.headings.map(headingLine),
                    ...(result.truncated ? ['(Only the first 1000 headings are shown.)'] : []),
                ].join('\n')
                : `"${title}" (id ${result.document.id}) has no headings. It has ${result.totalLines} lines.`;
            return { text, structured: result };
        },
    },
    {
        name: 'create_document',
        title: 'Create a Document',
        description: 'Create a new Markdown Document. Returns its id and updated_at.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            title: str('Title, 1 to 255 characters, one line.'),
            content: str('Optional. Markdown text. Default: a heading with the title.'),
            folder_id: str('Optional. Folder id from list_folders, or "root" (default) for the top level.'),
            space: str(SPACE_FOR_NEW),
        }, ['title']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = createDocument(ctx, {
                title: get('title', 'string', { required: true }),
                content: get('content', 'string'),
                folderId: get('folder_id', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Created "${document.title}"${where(document)} (id ${document.id}). updated_at is ${document.updatedAt}.`, structured: { document } };
        },
    },
    {
        name: 'update_document',
        title: 'Change a Document',
        description: 'Change a Document\'s title, replace its whole text, move it to another folder, or pin it. To change part of the text use edit_document, to add text at a place use insert_into_document, and to add to the end use append_to_document: they do not resend the whole text and leave the rest untouched. The previous text stays in Panino\'s revision history.',
        access: 'write',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        inputSchema: object({
            id: str(ID_HINT),
            title: str('Optional. New title.'),
            content: str('Optional. New Markdown text, replacing all of the current text.'),
            folder_id: str('Optional. Move to this folder id, or "root" for the top level.'),
            pinned: bool('Optional. Pin or unpin the Document.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = updateDocument(ctx, {
                id: get('id', 'string', { required: true }),
                title: get('title', 'string'),
                content: get('content', 'string'),
                folderId: get('folder_id', 'string'),
                pinned: get('pinned', 'boolean'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Updated "${document.title}" (id ${document.id}). updated_at is now ${document.updatedAt}.`, structured: { document } };
        },
    },
    {
        name: 'edit_document',
        title: 'Edit part of a Document',
        description: 'Replace exact text in a Document: old_text becomes new_text and the rest is untouched. Prefer this to update_document for any change smaller than the whole text. old_text must match exactly once (copy it from get_document, with enough surrounding text to be unique), unless replace_all is true. An empty new_text deletes old_text. The previous text stays in Panino\'s revision history.',
        access: 'write',
        annotations: DESTRUCTIVE,
        inputSchema: object({
            id: str(ID_HINT),
            old_text: str('The exact text to replace, as it appears in the Document, including spaces and line breaks.'),
            new_text: str('The text to put in its place. Empty to delete old_text.'),
            replace_all: bool('Optional. Replace every occurrence of old_text instead of requiring exactly one. Default false.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'old_text', 'new_text']),
        run: withDetails((ctx, args) => {
            const get = reader(args);
            const result = editDocument(ctx, {
                id: get('id', 'string', { required: true }),
                oldText: get('old_text', 'string', { required: true }),
                newText: get('new_text', 'string', { required: true }),
                replaceAll: get('replace_all', 'boolean'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            const { document, replacements, line } = result;
            const what = replacements === 1 ? `1 occurrence at line ${line}` : `${replacements} occurrences, the first at line ${line}`;
            return {
                text: `Edited "${document.title}" (id ${document.id}): replaced ${what}. updated_at is now ${document.updatedAt}.`,
                structured: result,
            };
        }),
    },
    {
        name: 'insert_into_document',
        title: 'Insert into a Document',
        description: 'Add Markdown at a place in a Document without resending it: at the start (after any front matter), at the end, just before or after a heading, or at the end of a heading\'s section (before the next heading of the same or a higher level). It is kept a blank line apart from the text around it. Nothing already there is changed.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            id: str(ID_HINT),
            content: str('Markdown to insert.'),
            position: { type: 'string', enum: [...INSERT_POSITIONS], description: 'Where: "start", "end", "before_heading", "after_heading" or "end_of_section". The last three need heading.' },
            heading: str('For before_heading, after_heading and end_of_section: the heading\'s text (case-insensitive), as get_document_outline lists it.'),
            heading_line: int('Optional. When several headings share that text: the line the one you mean starts on (from get_document_outline).'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'content', 'position']),
        run: withDetails((ctx, args) => {
            const get = reader(args);
            const result = insertIntoDocument(ctx, {
                id: get('id', 'string', { required: true }),
                content: get('content', 'string', { required: true }),
                position: get('position', 'string', { required: true }),
                heading: get('heading', 'string'),
                headingLine: get('heading_line', 'integer'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            const { document, line } = result;
            return {
                text: `Inserted into "${document.title}" (id ${document.id}) at line ${line}. updated_at is now ${document.updatedAt}.`,
                structured: result,
            };
        }),
    },
    {
        name: 'append_to_document',
        title: 'Append to a Document',
        description: 'Add Markdown to the end of a Document, after a blank line. Best for logs, journals and running notes: nothing already there is changed.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            id: str(ID_HINT),
            content: str('Markdown to add.'),
            separator: str('Optional. Text placed between the existing text and yours, up to 100 characters. Default: a blank line.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'content']),
        run(ctx, args) {
            const get = reader(args);
            const { document } = appendToDocument(ctx, {
                id: get('id', 'string', { required: true }),
                content: get('content', 'string', { required: true }),
                separator: get('separator', 'string'),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: `Appended to "${document.title}" (id ${document.id}). updated_at is now ${document.updatedAt}.`, structured: { document } };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    VERSION_CONFLICT: 'The Document changed since you read it. Call get_document again, then retry with its new updated_at as expected_updated_at.',
    DOCUMENT_IN_LIVE_SESSION: 'Someone is editing this Document live in Panino right now. Try again later, or tell the user.',
    NOT_FOUND: 'No Document with that id is reachable. Use search_documents or list_documents to find the right id.',
    SPACE_NOT_FOUND: 'No space with that id is reachable. Use list_spaces, or leave "space" out.',
    FOLDER_NOT_FOUND: 'No folder with that id in this database. Use list_folders to find folder ids.',
    DOCUMENT_TOO_LARGE: 'The Document would exceed 2 MiB. Split the text into several Documents.',
    EDIT_NO_MATCH: 'old_text does not occur in the Document exactly as given. Read it again with get_document (a section or start_line/end_line for a long one) and copy the text exactly, including spaces, punctuation and line breaks.',
    EDIT_AMBIGUOUS: 'old_text occurs more than once. Include more of the surrounding text so it matches exactly once, or set replace_all to true to change every occurrence.',
    HEADING_NOT_FOUND: 'No heading in the Document has that text. Call get_document_outline and use a heading text from it.',
    HEADING_AMBIGUOUS: 'Several headings have that text. Call get_document_outline and pass the line of the one you mean as heading_line.',
    INVALID_RANGE: 'That line range is not in the Document. Use start_line from 1 up to its line count and end_line at or after start_line, or read a section by its heading instead.',
};

/** @param {import('express').Router} router */
export function routes(router) {
    router.get('/me', handler((req, res) => {
        const { user, agent, databases } = getAccount(context(req));
        const key = { id: agent.id, name: agent.name, scope: agent.scope, spaceAccess: agent.spaceAccess, expiresAt: agent.expiresAt };
        res.json({ user, key, databases });
    }));

    router.get('/spaces', handler((req, res) => {
        res.json(listSpaces(context(req)));
    }));

    router.get('/tree', handler((req, res) => {
        res.json(getTree(context(req), { space: spaceParam(req) }));
    }));

    router.get('/search', handler((req, res) => {
        res.json(searchDocuments(context(req), {
            query: first(req.query.q),
            space: spaceParam(req),
            limit: first(req.query.limit),
            offset: first(req.query.offset),
            in: first(req.query.in),
            folderId: first(req.query.folderId),
            updatedAfter: first(req.query.updatedAfter),
            includeTrash: wantsTrash(req),
        }));
    }));

    router.get('/documents', handler((req, res) => {
        res.json(listDocuments(context(req), {
            space: spaceParam(req),
            folderId: first(req.query.folderId),
            limit: first(req.query.limit),
            cursor: first(req.query.cursor),
            sort: first(req.query.sort),
            pinnedOnly: flag(req, 'pinnedOnly'),
            updatedAfter: first(req.query.updatedAfter),
            includeTrash: wantsTrash(req),
        }));
    }));

    router.get('/documents/:id', handler((req, res) => {
        const includeContent = first(req.query.includeContent);
        const { document } = getDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            startLine: first(req.query.startLine),
            endLine: first(req.query.endLine),
            section: first(req.query.section),
            headingLine: first(req.query.headingLine),
            includeContent: includeContent === undefined ? undefined : !(includeContent === 'false' || includeContent === '0'),
        });
        const accept = String(req.headers.accept || '');
        const format = first(req.query.format);
        const asMarkdown = format === 'markdown'
            || (format === undefined && accept.includes('text/markdown') && !accept.includes('application/json'));
        if (!asMarkdown) return res.json({ document });
        res.setHeader('X-Panino-Document-Id', document.id);
        res.setHeader('X-Panino-Title', encodeURIComponent(document.title ?? ''));
        res.setHeader('X-Panino-Updated-At', document.updatedAt ?? '');
        res.setHeader('X-Panino-Folder-Path', encodeURIComponent(document.folderPath));
        res.setHeader('X-Panino-Total-Lines', String(document.totalLines));
        if (document.range) res.setHeader('X-Panino-Line-Range', `${document.range.startLine}-${document.range.endLine}`);
        if (document.space) res.setHeader('X-Panino-Space', document.space);
        res.type('text/markdown; charset=utf-8');
        return res.send(document.content ?? '');
    }));

    router.get('/documents/:id/outline', handler((req, res) => {
        res.json(getDocumentOutline(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.post('/documents', handler((req, res) => {
        const input = body(req);
        res.status(201).json(createDocument(context(req), {
            space: spaceParam(req), title: input.title, content: input.content, folderId: input.folderId ?? null,
        }));
    }));

    router.patch('/documents/:id', handler((req, res) => {
        const input = body(req);
        res.json(updateDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            title: input.title,
            content: input.content,
            folderId: input.folderId,
            pinned: input.pinned,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));

    router.post('/documents/:id/append', handler((req, res) => {
        const input = body(req);
        res.json(appendToDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            content: input.content,
            separator: input.separator,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));

    router.post('/documents/:id/edit', handler((req, res) => {
        const input = body(req);
        res.json(editDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            oldText: input.oldText,
            newText: input.newText,
            replaceAll: input.replaceAll,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));

    router.post('/documents/:id/insert', handler((req, res) => {
        const input = body(req);
        res.json(insertIntoDocument(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            content: input.content,
            position: input.position,
            heading: input.heading,
            headingLine: input.headingLine,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));
}

/* ------------------------------------------------------------------ *
 * OpenAPI schemas of this area
 * ------------------------------------------------------------------ */

const listedSummary = {
    allOf: [documentSummary, { type: 'object', properties: { createdAt: { type: ['string', 'null'], format: 'date-time' }, pinned: { type: 'boolean' } } }],
};

const lineRange = {
    type: ['object', 'null'],
    description: 'Lines of the body returned (1-based, inclusive); null for an empty body',
    properties: { startLine: { type: 'integer' }, endLine: { type: 'integer' } },
};

const actorSchema = {
    type: ['object', 'null'],
    properties: {
        kind: { type: 'string', enum: ['user', 'api', 'app', 'sync', 'collab', 'system', 'unknown'] },
        label: { type: ['string', 'null'], description: 'API key or connected app name' },
        userId: { type: ['string', 'null'] },
        userName: { type: ['string', 'null'] },
        text: { type: 'string', description: 'In the app\'s wording, e.g. "by Kris via Claude Code (API key)"' },
    },
};

const documentDetail = {
    allOf: [fullDocument, {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'Markdown body, or only the requested lines or section; absent with includeContent=false' },
            wordCount: { type: 'integer' },
            characterCount: { type: 'integer' },
            lineCount: { type: 'integer' },
            revisionCount: { type: 'integer', description: 'Rows in the Document\'s revision history' },
            createdBy: { ...actorSchema, description: 'Author of the oldest revision (the owner, in the personal database, when history does not say)' },
            modifiedBy: { ...actorSchema, description: 'Author of the newest attributed revision' },
            properties: { type: 'object', additionalProperties: { type: 'string' }, description: 'Front matter key → value' },
            imageIds: { type: 'array', items: { type: 'string' }, description: 'Ids of images the body links (/images/<id>), first appearance first, at most 500' },
            webUrl: { type: ['string', 'null'], description: '<FRONTEND_URL>/#/doc/<id> (plus ?dbKey= for a space), or null when the app URL is not configured' },
            totalLines: { type: 'integer' },
            range: lineRange,
            partial: { type: 'boolean', description: 'true when content is less than the whole body' },
            section: { type: 'object', properties: { text: { type: 'string' }, level: { type: 'integer' }, slug: { type: 'string' }, line: { type: 'integer' } } },
        },
    }],
};

const heading = {
    type: 'object',
    properties: {
        level: { type: 'integer', minimum: 1, maximum: 6 },
        text: { type: 'string', description: 'As written, without the # markers' },
        slug: { type: 'string', description: 'GitHub-style anchor slug, de-duplicated with -1, -2, …' },
        line: { type: 'integer', description: 'Line the heading starts on' },
        endLine: { type: 'integer', description: 'Last line of its section' },
    },
};

const contentErrors = {
    ...errors,
    400: { description: 'Invalid input, or INVALID_RANGE, HEADING_NOT_FOUND, HEADING_AMBIGUOUS (details.lines)', content: { 'application/json': { schema: errorSchema } } },
};

const editErrors = {
    ...writeErrors,
    400: { description: 'Invalid input, EDIT_NO_MATCH, EDIT_AMBIGUOUS (details.matchCount), HEADING_NOT_FOUND or HEADING_AMBIGUOUS (details.lines)', content: { 'application/json': { schema: errorSchema } } },
};

const query = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });

export const paths = {

    '/me': {
        get: {
            operationId: 'getMe',
            summary: 'Who the key belongs to, its access, and the databases it reaches',
            responses: { 200: json({ type: 'object' }), ...errors },
        },
    },
    '/spaces': {
        get: {
            operationId: 'listSpaces',
            summary: 'Shared spaces the key can reach',
            responses: { 200: json({ type: 'object', properties: { spaces: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } } }), ...errors },
        },
    },
    '/tree': {
        get: {
            operationId: 'getTree',
            summary: 'Folders and Document titles of one database (no bodies)',
            parameters: [spaceQuery],
            responses: { 200: json({ type: 'object' }), ...errors },
        },
    },
    '/search': {
        get: {
            operationId: 'searchDocuments',
            summary: 'Search titles and bodies: every word must occur (a "quoted phrase" is one term); title matches first',
            parameters: [
                { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 200 } },
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                query('in', { type: 'string', enum: ['all', 'title', 'content'], default: 'all' }, 'Where the terms must occur'),
                query('folderId', { type: 'string' }, 'Only this folder and its subfolders'),
                query('updatedAfter', { type: 'string', format: 'date-time' }, 'Only Documents updated after this time'),
                query('limit', { type: 'integer', default: 20, maximum: 100 }),
                query('offset', { type: 'integer', default: 0, maximum: 10000 }, 'Results to skip; pass nextOffset for the next page'),
                query('includeTrash', { type: 'boolean', default: false }),
            ],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        terms: { type: 'array', items: { type: 'string' } },
                        in: { type: 'string' },
                        offset: { type: 'integer' },
                        nextOffset: { type: ['integer', 'null'] },
                        results: {
                            type: 'array',
                            items: {
                                allOf: [listedSummary, {
                                    type: 'object',
                                    properties: {
                                        snippet: { type: 'string' },
                                        matchedTitle: { type: 'boolean', description: 'Every term occurs in the title' },
                                        matchCount: { type: 'integer', description: 'Occurrences of the terms in the searched fields' },
                                        snippets: { type: 'array', maxItems: 3, items: { type: 'object', properties: { line: { type: 'integer' }, text: { type: 'string' } } } },
                                        spaceName: { type: ['string', 'null'] },
                                    },
                                }],
                            },
                        },
                    },
                }),
                ...errors,
            },
        },
    },
    '/documents': {
        get: {
            operationId: 'listDocuments',
            summary: 'Documents (metadata only): most recently updated first, newest first, or by title',
            parameters: [
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                query('folderId', { type: 'string' }, 'Only this folder; "root" for the top level'),
                query('sort', { type: 'string', enum: ['updated', 'created', 'title'], default: 'updated' }, 'A cursor only continues the sort it came from'),
                query('pinnedOnly', { type: 'boolean', default: false }),
                query('updatedAfter', { type: 'string', format: 'date-time' }, 'Only Documents updated after this time'),
                query('limit', { type: 'integer', default: 50, maximum: 200 }),
                query('cursor', { type: 'string' }),
                query('includeTrash', { type: 'boolean', default: false }),
            ],
            responses: { 200: json({ type: 'object', properties: { documents: { type: 'array', items: listedSummary }, nextCursor: { type: ['string', 'null'] } } }), ...errors },
        },
        post: {
            operationId: 'createDocument',
            summary: 'Create a Document',
            parameters: [spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, content: { type: 'string' }, folderId: { type: ['string', 'null'] } } } } } },
            responses: { 201: json({ type: 'object', properties: { document: fullDocument } }, 'Created'), ...writeErrors },
        },
    },
    '/documents/{id}': {
        get: {
            operationId: 'getDocument',
            summary: 'One Document with its Markdown body (all of it, some lines, or one section) and metadata',
            parameters: [
                idPath,
                spaceQuery,
                query('format', { type: 'string', enum: ['json', 'markdown'] }),
                query('startLine', { type: 'integer', minimum: 1 }, 'First line to return (1-based)'),
                query('endLine', { type: 'integer', minimum: 1 }, 'Last line to return (inclusive); past the end reads to the end'),
                query('section', { type: 'string' }, 'Heading text (case-insensitive): that heading through to the next heading of the same or a higher level. Not with startLine/endLine'),
                query('headingLine', { type: 'integer' }, 'With section, when several headings share the text: the line the wanted one starts on'),
                query('includeContent', { type: 'boolean', default: true }, 'false returns metadata only'),
            ],
            responses: {
                200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { document: documentDetail } } }, 'text/markdown': { schema: { type: 'string' } } } },
                ...contentErrors,
            },
        },
        patch: {
            operationId: 'updateDocument',
            summary: 'Change title, body, folder or pin',
            parameters: [idPath, spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, folderId: { type: ['string', 'null'] }, pinned: { type: 'boolean' }, expectedUpdatedAt: { type: 'string', description: 'updatedAt from your last read; mismatch → 409' } } } } } },
            responses: { 200: json({ type: 'object', properties: { document: fullDocument } }), ...writeErrors },
        },
    },
    '/documents/{id}/append': {
        post: {
            operationId: 'appendToDocument',
            summary: 'Append Markdown to the end of a Document',
            parameters: [idPath, spaceQuery],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' }, separator: { type: 'string', description: 'Default: a blank line' }, expectedUpdatedAt: { type: 'string' } } } } } },
            responses: { 200: json({ type: 'object', properties: { document: fullDocument } }), ...writeErrors },
        },
    },
    '/documents/{id}/outline': {
        get: {
            operationId: 'getDocumentOutline',
            summary: 'The Document\'s headings with level, text, slug, line and section end (fenced code ignored)',
            parameters: [idPath, spaceQuery],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        document: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, space: { type: ['string', 'null'] }, folderPath: { type: 'string' }, updatedAt: { type: 'string' } } },
                        totalLines: { type: 'integer' },
                        headings: { type: 'array', items: heading, maxItems: 1000 },
                        truncated: { type: 'boolean' },
                    },
                }),
                ...errors,
            },
        },
    },
    '/documents/{id}/edit': {
        post: {
            operationId: 'editDocument',
            summary: 'Replace exact text: oldText must occur once unless replaceAll; empty newText deletes it',
            parameters: [idPath, spaceQuery],
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object', required: ['oldText', 'newText'], properties: {
                    oldText: { type: 'string', minLength: 1 },
                    newText: { type: 'string' },
                    replaceAll: { type: 'boolean', default: false },
                    expectedUpdatedAt: { type: 'string', description: 'updatedAt from your last read; mismatch → 409' },
                } } } },
            },
            responses: {
                200: json({ type: 'object', properties: { document: fullDocument, replacements: { type: 'integer' }, line: { type: 'integer', description: 'Line where the first replacement starts' } } }),
                ...editErrors,
            },
        },
    },
    '/documents/{id}/insert': {
        post: {
            operationId: 'insertIntoDocument',
            summary: 'Insert Markdown at the start, the end, or around a heading, a blank line apart',
            parameters: [idPath, spaceQuery],
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object', required: ['content', 'position'], properties: {
                    content: { type: 'string', minLength: 1 },
                    position: { type: 'string', enum: ['start', 'end', 'before_heading', 'after_heading', 'end_of_section'], description: 'start is after any front matter' },
                    heading: { type: 'string', description: 'Heading text, for the heading positions' },
                    headingLine: { type: 'integer', description: 'When several headings share the text: the line the wanted one starts on' },
                    expectedUpdatedAt: { type: 'string' },
                } } } },
            },
            responses: {
                200: json({ type: 'object', properties: { document: fullDocument, line: { type: 'integer', description: 'Line where the inserted text starts' } } }),
                ...editErrors,
            },
        },
    },
};
