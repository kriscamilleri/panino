// Revision history in the v1 API (docs/specs/proposed/ai-api-expansion.md §4.4):
// list, read, compare, save a checkpoint and restore, as MCP tools, REST routes and
// OpenAPI paths. The rules are in revisionService.js; this file only adapts.
import { MAX_CONTEXT } from '../lineDiff.js';
import {
    compareRevisions,
    getRevision,
    listRevisions,
    restoreRevision,
    REVISION_PAGE_DEFAULT,
    REVISION_PAGE_MAX,
    saveRevision,
} from '../revisionService.js';
import { ApiError } from '../serviceCore.js';
import { errors, fullDocument, idPath, json, jsonBody, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, handler, spaceParam } from './restKit.js';
import {
    ADDITIVE,
    DESTRUCTIVE,
    EXPECTED,
    ID_HINT,
    int,
    object,
    READ,
    reader,
    SPACE_FOR_EXISTING,
    str,
} from './toolKit.js';

const REVISION_ID_HINT = 'Revision id, as returned by list_revisions.';

function revisionLine(revision, index) {
    const size = revision.size === null ? '' : ` — ${revision.size} bytes`;
    return `${index + 1}. ${revision.createdAt} — ${revision.type} — "${revision.title || '(untitled)'}"${size} — ${revision.who.text} — revision id ${revision.id}`;
}

function revisionHeader(revision) {
    return [
        `Revision: ${revision.id}`,
        `type: ${revision.type}`,
        `created_at: ${revision.createdAt}`,
        `title: ${revision.title || '(untitled)'}`,
        `made: ${revision.who.text}`,
    ].join('\n');
}

export const tools = [
    {
        name: 'list_revisions',
        title: 'List revisions of a Document',
        description: 'The saved versions of one Document, newest first: when, what kind (auto, manual, pre-restore), its title and size, and who made it (a person, or an API key or connected app by name). Use the revision ids with get_revision, compare_revisions or restore_revision. If next_cursor is given, call again with it for older ones.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            id: str(ID_HINT),
            limit: int(`Optional. Page size, 1 to ${REVISION_PAGE_MAX}. Default ${REVISION_PAGE_DEFAULT}.`),
            cursor: str('Optional. next_cursor from the previous call.'),
            before: str('Optional. Only revisions made before this time (ISO 8601). Ignored when cursor is given.'),
            space: str(SPACE_FOR_EXISTING),
        }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = listRevisions(ctx, {
                id: get('id', 'string', { required: true }),
                limit: get('limit', 'integer'),
                cursor: get('cursor', 'string'),
                before: get('before', 'string'),
                space: get('space', 'string'),
            });
            const heading = `Revisions of "${result.document.title || '(untitled)'}" (id ${result.document.id}), newest first, ${result.revisions.length} of ${result.total}:`;
            const lines = result.revisions.map(revisionLine);
            const text = [
                lines.length ? heading : `"${result.document.title || '(untitled)'}" has no ${result.total ? 'more ' : ''}revisions.`,
                ...lines,
                ...(result.nextCursor ? [`next_cursor: ${result.nextCursor}`] : []),
            ].join('\n');
            return { text, structured: result };
        },
    },
    {
        name: 'get_revision',
        title: 'Read a revision',
        description: 'The full Markdown text of one saved version of a Document, with its title, time and who made it. Use start_line and end_line to read part of a long one.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            id: str(ID_HINT),
            revision_id: str(REVISION_ID_HINT),
            start_line: int('Optional. First line to return, from 1.'),
            end_line: int('Optional. Last line to return (inclusive).'),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'revision_id']),
        run(ctx, args) {
            const get = reader(args);
            const result = getRevision(ctx, {
                id: get('id', 'string', { required: true }),
                revisionId: get('revision_id', 'string', { required: true }),
                startLine: get('start_line', 'integer'),
                endLine: get('end_line', 'integer'),
                space: get('space', 'string'),
            });
            const { revision } = result;
            const range = revision.startLine ? `\nlines: ${revision.startLine}-${revision.endLine} of ${revision.lineCount}` : '';
            return { text: `${revisionHeader(revision)}\nDocument: ${result.document.id}${range}\n\n${revision.content}`, structured: result };
        },
    },
    {
        name: 'compare_revisions',
        title: 'Compare revisions',
        description: 'What changed between a saved version of a Document and its current text (the default), or another saved version: a unified line diff ("-" lines only in revision_id, "+" lines only in against) with added and removed line counts. Very different versions are refused; long diffs are cut and say so.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            id: str(ID_HINT),
            revision_id: str(`${REVISION_ID_HINT} The "from" side of the diff.`),
            against: str('Optional. "current" (default) for the Document\'s current text, or another revision id of the same Document. The "to" side of the diff.'),
            context: int(`Optional. Unchanged lines shown around each change, 0 to ${MAX_CONTEXT}. Default 3.`),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'revision_id']),
        run(ctx, args) {
            const get = reader(args);
            const result = compareRevisions(ctx, {
                id: get('id', 'string', { required: true }),
                revisionId: get('revision_id', 'string', { required: true }),
                against: get('against', 'string'),
                context: get('context', 'integer'),
                space: get('space', 'string'),
            });
            const toName = result.to.id === 'current' ? 'the current text' : `revision ${result.to.id}`;
            const lines = [`From revision ${result.from.id} (${result.from.createdAt}) to ${toName}:`];
            if (result.titleChanged) lines.push(`Title: "${result.from.title || ''}" → "${result.to.title || ''}"`);
            if (result.identical) lines.push('No differences.');
            else if (!result.added && !result.removed) lines.push('The text is the same.');
            else {
                lines.push(`${result.added} line(s) added, ${result.removed} removed, in ${result.hunks} hunk(s).`);
                lines.push('', result.diff.trimEnd());
                if (result.truncated) lines.push('', '(The diff was cut here: it is too long to show in full. The counts above are for the whole diff.)');
            }
            return { text: lines.join('\n'), structured: result };
        },
    },
    {
        name: 'save_revision',
        title: 'Save a revision',
        description: 'Save the current text of a Document as a manual checkpoint in its revision history, labelled with this connection\'s name. Useful before a series of edits. If the newest revision already has the same text, nothing new is saved and you are told so. Refused while the Document is open in a live session.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = saveRevision(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const text = result.created
                ? `Saved a checkpoint of "${result.document.title || '(untitled)'}" (revision id ${result.revision.id}).`
                : `Nothing new to save: the newest revision of "${result.document.title || '(untitled)'}" (revision id ${result.revision.id}, ${result.revision.createdAt}) already has this text.`;
            return { text, structured: result };
        },
    },
    {
        name: 'restore_revision',
        title: 'Restore a revision',
        description: 'Put a Document back to a saved version: its title and text become that revision\'s. This is undoable: the current title and text are saved first as a "pre-restore" revision, and its id is returned; to undo, call restore_revision again with that id. Check what will change with compare_revisions first. Refused while the Document is open in a live session.',
        access: 'write',
        annotations: DESTRUCTIVE,
        inputSchema: object({
            id: str(ID_HINT),
            revision_id: str(`${REVISION_ID_HINT} The version to go back to.`),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'revision_id']),
        run(ctx, args) {
            const get = reader(args);
            const result = restoreRevision(ctx, {
                id: get('id', 'string', { required: true }),
                revisionId: get('revision_id', 'string', { required: true }),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            const text = [
                `Restored "${result.document.title || '(untitled)'}" (id ${result.document.id}) to revision ${result.restoredFrom}. updated_at is now ${result.document.updatedAt}.`,
                `The text before the restore was saved as pre-restore revision ${result.preRestoreRevisionId}; restore that revision to undo this.`,
            ].join('\n');
            return { text, structured: result };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    REVISION_NOT_FOUND: 'No revision with that id belongs to this Document. Call list_revisions to see its revision ids.',
    REVISION_CORRUPT: 'This revision\'s stored text is damaged and cannot be read, compared or restored. Pick another revision from list_revisions, or tell the user.',
    DIFF_TOO_LARGE: 'These versions differ too much to compare here. Read them with get_revision (and get_document for the current text) instead, or compare revisions closer in time.',
};

/** A whole-number query parameter, or undefined when absent. */
function intQuery(req, name) {
    const value = first(req.query[name]);
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ApiError(400, 'INVALID_INPUT', `${name} must be a whole number.`);
    return Number(value);
}

/** @param {import('express').Router} router */
export function routes(router) {
    router.get('/documents/:id/revisions', handler((req, res) => {
        res.json(listRevisions(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            limit: first(req.query.limit),
            cursor: first(req.query.cursor),
            before: first(req.query.before),
        }));
    }));

    router.post('/documents/:id/revisions', handler((req, res) => {
        const result = saveRevision(context(req), { id: req.params.id, space: spaceParam(req) });
        res.status(result.created ? 201 : 200).json(result);
    }));

    router.get('/documents/:id/revisions/:revisionId', handler((req, res) => {
        res.json(getRevision(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            revisionId: req.params.revisionId,
            startLine: intQuery(req, 'startLine'),
            endLine: intQuery(req, 'endLine'),
        }));
    }));

    router.get('/documents/:id/revisions/:revisionId/diff', handler((req, res) => {
        res.json(compareRevisions(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            revisionId: req.params.revisionId,
            against: first(req.query.against),
            context: intQuery(req, 'context'),
        }));
    }));

    router.post('/documents/:id/revisions/:revisionId/restore', handler((req, res) => {
        res.json(restoreRevision(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            revisionId: req.params.revisionId,
            expectedUpdatedAt: body(req).expectedUpdatedAt,
        }));
    }));
}

/* ------------------------------------------------------------------ *
 * OpenAPI
 * ------------------------------------------------------------------ */

const who = {
    type: 'object',
    description: 'Who made the revision',
    properties: {
        kind: { type: 'string', enum: ['user', 'api', 'app', 'sync', 'collab', 'system', 'unknown'] },
        label: { type: ['string', 'null'], description: 'The API key\'s or connected app\'s name (kinds api and app)' },
        userId: { type: ['string', 'null'], description: 'Set for the account owner and current space members only' },
        userName: { type: ['string', 'null'] },
        text: { type: 'string', description: 'In the app\'s wording, e.g. "by Kris via Claude Code (API key)"' },
    },
};

const revisionSummary = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        type: { type: 'string', description: 'auto, manual or pre-restore' },
        createdAt: { type: 'string', format: 'date-time' },
        title: { type: ['string', 'null'] },
        size: { type: ['integer', 'null'], description: 'Body size in bytes (UTF-8)' },
        who,
    },
};

const documentRef = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        title: { type: ['string', 'null'] },
        space: { type: ['string', 'null'] },
        updatedAt: { type: 'string', format: 'date-time' },
    },
};

const revisionIdPath = { name: 'revisionId', in: 'path', required: true, schema: { type: 'string' } };

const revisionErrors = {
    ...errors,
    404: { description: 'Document, revision (REVISION_NOT_FOUND) or space not found', content: errors[404].content },
    422: { description: 'REVISION_CORRUPT: the stored revision cannot be read', content: errors[404].content },
};

export const paths = {
    '/documents/{id}/revisions': {
        get: {
            operationId: 'listRevisions',
            summary: 'A Document\'s revisions, newest first (no bodies)',
            parameters: [
                idPath,
                spaceQuery,
                { name: 'limit', in: 'query', schema: { type: 'integer', default: REVISION_PAGE_DEFAULT, maximum: REVISION_PAGE_MAX } },
                { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'nextCursor from the previous page' },
                { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only revisions made before this time; ignored with cursor' },
            ],
            responses: {
                200: json({ type: 'object', properties: { document: documentRef, revisions: { type: 'array', items: revisionSummary }, total: { type: 'integer' }, nextCursor: { type: ['string', 'null'] } } }),
                ...errors,
            },
        },
        post: {
            operationId: 'saveRevision',
            summary: 'Save the current body as a manual revision, attributed to the key',
            parameters: [idPath, spaceQuery],
            responses: {
                201: json({ type: 'object', properties: { document: documentRef, created: { type: 'boolean' }, revision: revisionSummary } }, 'Saved'),
                200: json({ type: 'object', properties: { document: documentRef, created: { type: 'boolean' }, reason: { type: 'string', enum: ['duplicate-latest'] }, revision: revisionSummary } }, 'The newest revision already has this body; nothing saved'),
                ...writeErrors,
            },
        },
    },
    '/documents/{id}/revisions/{revisionId}': {
        get: {
            operationId: 'getRevision',
            summary: 'One revision with its body',
            parameters: [
                idPath, revisionIdPath, spaceQuery,
                { name: 'startLine', in: 'query', schema: { type: 'integer', minimum: 1 } },
                { name: 'endLine', in: 'query', schema: { type: 'integer', minimum: 1 } },
            ],
            responses: {
                200: json({ type: 'object', properties: { document: documentRef, revision: { allOf: [revisionSummary, { type: 'object', properties: { content: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, lineCount: { type: 'integer' } } }] } } }),
                ...revisionErrors,
            },
        },
    },
    '/documents/{id}/revisions/{revisionId}/diff': {
        get: {
            operationId: 'compareRevisions',
            summary: 'Unified line diff from a revision to the current body or another revision',
            parameters: [
                idPath, revisionIdPath, spaceQuery,
                { name: 'against', in: 'query', schema: { type: 'string', default: 'current' }, description: '"current" or another revision id' },
                { name: 'context', in: 'query', schema: { type: 'integer', default: 3, minimum: 0, maximum: MAX_CONTEXT } },
            ],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        document: documentRef,
                        from: revisionSummary,
                        to: { type: 'object', description: 'A revision summary, or { id: "current", type: "current", createdAt, title }' },
                        titleChanged: { type: 'boolean' },
                        identical: { type: 'boolean' },
                        added: { type: 'integer' },
                        removed: { type: 'integer' },
                        hunks: { type: 'integer' },
                        diff: { type: 'string', description: 'Unified diff text; empty when identical' },
                        truncated: { type: 'boolean', description: 'The diff text was cut at about 100 KB; counts are still complete' },
                    },
                }),
                ...revisionErrors,
                422: { description: 'REVISION_CORRUPT, or DIFF_TOO_LARGE (over 20000 lines either side, or over 2000 changed lines)', content: errors[404].content },
            },
        },
    },
    '/documents/{id}/revisions/{revisionId}/restore': {
        post: {
            operationId: 'restoreRevision',
            summary: 'Restore a revision; the current body is saved first as a pre-restore revision',
            parameters: [idPath, revisionIdPath, spaceQuery],
            requestBody: jsonBody({ type: 'object', properties: { expectedUpdatedAt: { type: 'string', description: 'updatedAt from your last read; mismatch → 409' } } }, false),
            responses: {
                200: json({ type: 'object', properties: { document: fullDocument, restoredFrom: { type: 'string' }, preRestoreRevisionId: { type: 'string', description: 'Restore this one to undo' }, revisionId: { type: 'string', description: 'The revision recording the restored body' } } }),
                ...writeErrors,
                404: revisionErrors[404],
                422: revisionErrors[422],
            },
        },
    },
};
