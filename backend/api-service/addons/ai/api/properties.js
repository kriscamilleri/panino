// Document properties in the v1 API (docs/specs/proposed/ai-api-expansion.md §4.6), as
// MCP tools, REST routes and OpenAPI paths. The rules are in propertyService.js.
import {
    getDocumentProperties,
    listPropertyKeys,
    queryDocumentsByProperty,
    removeDocumentProperty,
    setDocumentProperty,
} from '../propertyService.js';
import { documentSummary, errors, idPath, json, jsonBody, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, handler, spaceParam, wantsTrash } from './restKit.js';
import {
    bool,
    documentLine,
    EXPECTED,
    ID_HINT,
    int,
    object,
    READ,
    reader,
    REPLACING,
    SPACE_FOR_EXISTING,
    str,
} from './toolKit.js';

const SPACE_FOR_MANY = 'Optional. "all" (default) for every database, "personal", or a space id from list_spaces.';
const FILTER_HELP = [
    'Conditions joined by AND, at most 5. Each is "<property> <operator> <value>" or "<property> exists" / "<property> missing".',
    'A property is a front matter key or a built-in: word_count, created_on, modified_on (ISO times), created_by, modified_by (match a person\'s name, a key or app name with =, or any part of "by Kris via Claude (API key)" with ~).',
    'Operators: = != ~ (contains) ^= (starts with) > < >= <=. Comparisons ignore case; numbers compare as numbers, dates as ISO text.',
    'Quote values with spaces or "and" in them. Example: status = draft AND priority >= 2 AND due exists.',
].join(' ');

function propertyLines(properties) {
    const entries = Object.entries(properties);
    return entries.length ? entries.map(([key, value]) => `  ${key}: ${value}`).join('\n') : '  (none)';
}

function builtInLines(builtIn) {
    if (!builtIn) return [];
    return [
        `folder: ${builtIn.folder || '(top level)'}`,
        `word_count: ${builtIn.wordCount}`,
        `created_on: ${builtIn.createdOn || 'unknown'}`,
        `created_by: ${builtIn.createdBy ? builtIn.createdBy.text : 'not recorded'}`,
        `modified_on: ${builtIn.modifiedOn || 'unknown'}`,
        `modified_by: ${builtIn.modifiedBy ? builtIn.modifiedBy.text : 'not recorded'}`,
        `pinned: ${builtIn.pinned ? 'yes' : 'no'}`,
    ];
}

function changedText(result, verb) {
    if (!result.changed) return `Nothing changed in "${result.document.title}": the property already ${verb === 'Set' ? 'had that value' : 'was absent'}.`;
    return `${verb} on "${result.document.title}" (id ${result.document.id}). updated_at is now ${result.document.updatedAt}. Properties:\n${propertyLines(result.properties)}`;
}

export const tools = [
    {
        name: 'get_document_properties',
        title: 'Read a Document\'s properties',
        description: 'The properties of one Document. Built-in: title, folder, word count, created on and by, modified on and by (authors come from revision history, in the words the app uses), pinned. Plus its own properties: the "key: value" lines of the front matter block at the top of its text (between --- lines). Cheaper than get_document when you only need properties.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ id: str(ID_HINT), space: str(SPACE_FOR_EXISTING) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = getDocumentProperties(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const doc = result.document;
            const text = [
                `Title: ${doc.title || '(untitled)'}`,
                `id: ${doc.id}`,
                `updated_at: ${doc.updatedAt} (pass as expected_updated_at when you change it)`,
                ...builtInLines(result.builtIn),
                'Front matter properties:',
                propertyLines(result.properties),
            ].join('\n');
            return { text, structured: result };
        },
    },
    {
        name: 'list_document_properties',
        title: 'List the properties in use',
        description: 'Which front matter property keys the user\'s Documents use, how many Documents use each, and their most common values, plus the built-in properties every Document has (word_count, created_on, created_by, modified_on, modified_by). Call it before query_documents_by_property to learn the exact keys and values.',
        access: 'read',
        annotations: READ,
        inputSchema: object({
            space: str(SPACE_FOR_MANY),
            folder_id: str('Optional. Only Documents in this folder and its subfolders (id from list_folders), or "root" for top-level Documents.'),
            include_trash: bool('Optional. Also count Documents in the Trash folder. Default false.'),
        }),
        run(ctx, args) {
            const get = reader(args);
            const result = listPropertyKeys(ctx, {
                space: get('space', 'string'),
                folderId: get('folder_id', 'string'),
                includeTrash: get('include_trash', 'boolean') ?? false,
            });
            const lines = result.keys.map((entry, i) => {
                const values = entry.commonValues.map((value) => `${value.value} (${value.count})`).join(', ');
                return `${i + 1}. ${entry.key} — ${entry.documents} Document${entry.documents === 1 ? '' : 's'}, ${entry.distinctValues} value${entry.distinctValues === 1 ? '' : 's'}: ${values}`;
            });
            const builtIn = `Built-in, on every Document: ${result.builtInKeys.map((entry) => entry.key).join(', ')}.`;
            const text = `${builtIn}\n${lines.length ? `Front matter properties:\n${lines.join('\n')}` : 'No Documents have front matter properties.'}`;
            return { text: result.truncated ? `${text}\n(Only the 5000 most recently updated Documents with front matter per database were read.)` : text, structured: result };
        },
    },
    {
        name: 'query_documents_by_property',
        title: 'Find Documents by property',
        description: `Find Documents whose properties (built-in ones, or front matter "key: value" lines) match a filter, most recently updated first, with each Document's properties. ${FILTER_HELP}`,
        access: 'read',
        annotations: READ,
        inputSchema: object({
            filter: str(`The filter. ${FILTER_HELP}`),
            space: str(SPACE_FOR_MANY),
            folder_id: str('Optional. Only Documents in this folder and its subfolders, or "root" for top-level Documents.'),
            include_trash: bool('Optional. Also match Documents in the Trash folder. Default false.'),
            limit: int('Optional. Most results to return, 1 to 100. Default 20.'),
            offset: int('Optional. Skip this many results (next_offset from the previous call). Default 0.'),
        }, ['filter']),
        run(ctx, args) {
            const get = reader(args);
            const result = queryDocumentsByProperty(ctx, {
                filter: get('filter', 'string', { required: true }),
                space: get('space', 'string'),
                folderId: get('folder_id', 'string'),
                includeTrash: get('include_trash', 'boolean') ?? false,
                limit: get('limit', 'integer'),
                offset: get('offset', 'integer'),
            });
            const lines = result.documents.map((doc, i) => {
                const own = Object.entries(doc.properties).map(([key, value]) => `${key}: ${value}`);
                const b = doc.builtIn;
                const built = b ? [`${b.wordCount} words`, `created ${b.createdOn} ${b.createdBy?.text || ''}`.trim(), `modified ${b.modifiedOn} ${b.modifiedBy?.text || ''}`.trim()] : [];
                return `${documentLine(doc, i)}\n   ${[...built, ...own].join('; ')}`;
            });
            const text = [
                lines.length ? `${result.total} Document${result.total === 1 ? '' : 's'} match "${result.filter}".` : `No Documents match "${result.filter}".`,
                ...lines,
                ...(result.nextOffset !== null ? [`next_offset: ${result.nextOffset}`] : []),
                ...(result.truncated ? [result.scanned === 'all'
                    ? '(Only the 5000 most recently updated Documents per database were read.)'
                    : '(Only the 5000 most recently updated Documents with front matter per database were read.)'] : []),
            ].join('\n');
            return { text, structured: { ...result, next_offset: result.nextOffset } };
        },
    },
    {
        name: 'set_document_property',
        title: 'Set a Document property',
        description: 'Set one property in a Document\'s front matter (the "key: value" lines between --- at the top), replacing the value of the same key (ignoring case) or adding it. A Document without front matter gets a block. Nothing else in the text changes; the previous text stays in revision history.',
        access: 'write',
        annotations: REPLACING,
        inputSchema: object({
            id: str(ID_HINT),
            key: str('Property name, one line, no ":", up to 100 characters.'),
            value: str('Value, one line, up to 1000 characters.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'key', 'value']),
        run(ctx, args) {
            const get = reader(args);
            const result = setDocumentProperty(ctx, {
                id: get('id', 'string', { required: true }),
                key: get('key', 'string', { required: true }),
                value: get('value', 'string', { required: true }),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: changedText(result, 'Set'), structured: result };
        },
    },
    {
        name: 'remove_document_property',
        title: 'Remove a Document property',
        description: 'Remove one property (key compared ignoring case) from a Document\'s front matter. Removing the last one removes the block. The previous text stays in revision history.',
        access: 'write',
        annotations: REPLACING,
        inputSchema: object({
            id: str(ID_HINT),
            key: str('Property name to remove.'),
            expected_updated_at: str(EXPECTED),
            space: str(SPACE_FOR_EXISTING),
        }, ['id', 'key']),
        run(ctx, args) {
            const get = reader(args);
            const result = removeDocumentProperty(ctx, {
                id: get('id', 'string', { required: true }),
                key: get('key', 'string', { required: true }),
                expectedUpdatedAt: get('expected_updated_at', 'string'),
                space: get('space', 'string'),
            });
            return { text: changedText(result, 'Removed'), structured: result };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    INVALID_FILTER: `The filter could not be read. ${FILTER_HELP}`,
};

/** @param {import('express').Router} router */
export function routes(router) {
    router.get('/properties', handler((req, res) => {
        res.json(listPropertyKeys(context(req), {
            space: spaceParam(req),
            folderId: first(req.query.folderId),
            includeTrash: wantsTrash(req),
        }));
    }));

    router.get('/properties/query', handler((req, res) => {
        res.json(queryDocumentsByProperty(context(req), {
            filter: first(req.query.filter),
            space: spaceParam(req),
            folderId: first(req.query.folderId),
            includeTrash: wantsTrash(req),
            limit: first(req.query.limit),
            offset: first(req.query.offset),
        }));
    }));

    router.get('/documents/:id/properties', handler((req, res) => {
        res.json(getDocumentProperties(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.put('/documents/:id/properties/:key', handler((req, res) => {
        const input = body(req);
        res.json(setDocumentProperty(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            key: req.params.key,
            value: input.value,
            expectedUpdatedAt: input.expectedUpdatedAt,
        }));
    }));

    router.delete('/documents/:id/properties/:key', handler((req, res) => {
        res.json(removeDocumentProperty(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            key: req.params.key,
            expectedUpdatedAt: first(req.query.expectedUpdatedAt) ?? body(req).expectedUpdatedAt,
        }));
    }));
}

const propertiesMap = { type: 'object', additionalProperties: { type: 'string' }, description: 'Front matter key → value (unquoted)' };
const keyPath = { name: 'key', in: 'path', required: true, schema: { type: 'string', maxLength: 100 } };
const withProperties = {
    allOf: [documentSummary, { type: 'object', properties: { createdAt: { type: 'string' }, pinned: { type: 'boolean' }, properties: propertiesMap } }],
};
const writeResult = json({ type: 'object', properties: { document: documentSummary, properties: propertiesMap, changed: { type: 'boolean' } } });
const filterErrors = { ...errors, 400: { ...errors[400], description: 'Invalid input, or INVALID_FILTER' } };

export const paths = {
    '/properties': {
        get: {
            operationId: 'listPropertyKeys',
            summary: 'Property keys in use, with Document counts and common values',
            parameters: [
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                { name: 'folderId', in: 'query', schema: { type: 'string' }, description: 'This folder and its subfolders; "root" for top-level Documents' },
                { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
            ],
            responses: { 200: json({ type: 'object', properties: { keys: { type: 'array', items: { type: 'object' } }, documentsWithProperties: { type: 'integer' }, truncated: { type: 'boolean' } } }), ...errors },
        },
    },
    '/properties/query': {
        get: {
            operationId: 'queryDocumentsByProperty',
            summary: 'Documents whose front matter properties match a filter',
            description: FILTER_HELP,
            parameters: [
                { name: 'filter', in: 'query', required: true, schema: { type: 'string', maxLength: 1000 }, example: 'status = draft AND priority >= 2' },
                { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                { name: 'folderId', in: 'query', schema: { type: 'string' } },
                { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            ],
            responses: { 200: json({ type: 'object', properties: { total: { type: 'integer' }, documents: { type: 'array', items: withProperties }, nextOffset: { type: ['integer', 'null'] }, truncated: { type: 'boolean' } } }), ...filterErrors },
        },
    },
    '/documents/{id}/properties': {
        get: {
            operationId: 'getDocumentProperties',
            summary: 'One Document\'s front matter properties and built-in fields',
            parameters: [idPath, spaceQuery],
            responses: { 200: json({ type: 'object', properties: { document: withProperties, properties: propertiesMap, order: { type: 'array', items: { type: 'string' } } } }), ...errors },
        },
    },
    '/documents/{id}/properties/{key}': {
        put: {
            operationId: 'setDocumentProperty',
            summary: 'Set one front matter property',
            parameters: [idPath, keyPath, spaceQuery],
            requestBody: jsonBody({ type: 'object', required: ['value'], properties: { value: { type: 'string', maxLength: 1000 }, expectedUpdatedAt: { type: 'string' } } }),
            responses: { 200: writeResult, ...writeErrors },
        },
        delete: {
            operationId: 'removeDocumentProperty',
            summary: 'Remove one front matter property',
            parameters: [idPath, keyPath, spaceQuery, { name: 'expectedUpdatedAt', in: 'query', schema: { type: 'string' } }],
            responses: { 200: writeResult, ...writeErrors },
        },
    },
};
