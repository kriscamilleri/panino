// /backend/api-service/publicApiSpec.js
// The OpenAPI 3.1 description of the v1 API, served at GET /v1/openapi.json.
// Keep it in step with publicApi.js; tests/integration/publicApi.test.js
// checks every route here is answered by the router.

export const API_USAGE_NOTE = [
    'Panino stores Markdown Documents in folders, in a personal database and in shared spaces.',
    'Authenticate every request with "Authorization: Bearer pnk_…".',
    'Find Documents with GET /search?q=… (all databases) or GET /tree; read one with GET /documents/{id}',
    '(add ?format=markdown for the raw body). Address an existing Document by id alone; the server finds its database.',
    'To create in a space, pass space=<spaceId> (see GET /spaces). Writes need a read-write key.',
    'Prefer POST /documents/{id}/append for adding to a log, and send expectedUpdatedAt from your last read with',
    'PATCH to avoid overwriting someone else\'s edit (409 VERSION_CONFLICT means read again).',
    'DELETE moves a Document to the Trash folder; nothing is removed. Every API edit is kept in revision history.',
].join(' ');

const errorSchema = {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
    required: ['error', 'code'],
};

const documentSummary = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        folderId: { type: ['string', 'null'] },
        folderPath: { type: 'string', description: 'Slash-joined folder names from the root; empty at the root' },
        space: { type: ['string', 'null'], description: 'Space id, or null for the personal database' },
        updatedAt: { type: 'string', format: 'date-time' },
        inTrash: { type: 'boolean' },
    },
};

const fullDocument = {
    allOf: [documentSummary, {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'Markdown body' },
            pinned: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
        },
    }],
};

const spaceQuery = {
    name: 'space',
    in: 'query',
    required: false,
    description: 'Space id. Omit for the personal database (for an existing Document: omit to search every database).',
    schema: { type: 'string' },
};

const idPath = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

const errors = {
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    401: { description: 'Missing, invalid, revoked or expired API key', content: { 'application/json': { schema: errorSchema } } },
    403: { description: 'Read-only key used for a write (INSUFFICIENT_SCOPE)', content: { 'application/json': { schema: errorSchema } } },
    404: { description: 'Document, folder or space not found', content: { 'application/json': { schema: errorSchema } } },
    429: { description: 'Rate limited; see Retry-After', content: { 'application/json': { schema: errorSchema } } },
};

const writeErrors = {
    ...errors,
    409: { description: 'VERSION_CONFLICT or DOCUMENT_IN_LIVE_SESSION', content: { 'application/json': { schema: errorSchema } } },
    413: { description: 'DOCUMENT_TOO_LARGE (over 2 MiB)', content: { 'application/json': { schema: errorSchema } } },
};

function json(schema, description = 'OK') {
    return { description, content: { 'application/json': { schema } } };
}

/** @returns {object} OpenAPI 3.1 document for /v1 */
export function buildOpenApiDocument() {
    return {
        openapi: '3.1.0',
        info: { title: 'Panino API', version: '1.0.0', description: API_USAGE_NOTE },
        servers: [{ url: '/api/v1', description: 'Production (behind /api)' }, { url: '/v1', description: 'Direct to the API service' }],
        security: [{ apiKey: [] }],
        components: {
            securitySchemes: {
                apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'pnk_…', description: 'Create in Settings → API keys' },
            },
            schemas: { Error: errorSchema, DocumentSummary: documentSummary, Document: fullDocument },
        },
        paths: {
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
                    summary: 'Case-insensitive search of titles and bodies; title matches first',
                    parameters: [
                        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 200 } },
                        { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                        { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
                    ],
                    responses: { 200: json({ type: 'object', properties: { results: { type: 'array', items: { allOf: [documentSummary, { type: 'object', properties: { snippet: { type: 'string' }, matchedTitle: { type: 'boolean' }, spaceName: { type: ['string', 'null'] } } }] } } } }), ...errors },
                },
            },
            '/documents': {
                get: {
                    operationId: 'listDocuments',
                    summary: 'Documents, most recently updated first (metadata only)',
                    parameters: [
                        { ...spaceQuery, description: 'Space id, "personal", or "all" (default)' },
                        { name: 'folderId', in: 'query', schema: { type: 'string' }, description: 'Only this folder; "root" for the top level' },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
                        { name: 'cursor', in: 'query', schema: { type: 'string' } },
                        { name: 'includeTrash', in: 'query', schema: { type: 'boolean', default: false } },
                    ],
                    responses: { 200: json({ type: 'object', properties: { documents: { type: 'array', items: documentSummary }, nextCursor: { type: ['string', 'null'] } } }), ...errors },
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
                    summary: 'One Document with its Markdown body',
                    parameters: [idPath, spaceQuery, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'markdown'] } }],
                    responses: {
                        200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { document: fullDocument } } }, 'text/markdown': { schema: { type: 'string' } } } },
                        ...errors,
                    },
                },
                patch: {
                    operationId: 'updateDocument',
                    summary: 'Change title, body, folder or pin',
                    parameters: [idPath, spaceQuery],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, folderId: { type: ['string', 'null'] }, pinned: { type: 'boolean' }, expectedUpdatedAt: { type: 'string', description: 'updatedAt from your last read; mismatch → 409' } } } } } },
                    responses: { 200: json({ type: 'object', properties: { document: fullDocument } }), ...writeErrors },
                },
                delete: {
                    operationId: 'trashDocument',
                    summary: 'Move a Document to the Trash folder (soft delete)',
                    parameters: [idPath, spaceQuery],
                    responses: { 200: json({ type: 'object', properties: { document: fullDocument, previousFolderId: { type: ['string', 'null'] }, alreadyInTrash: { type: 'boolean' } } }), ...writeErrors },
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
            '/folders': {
                post: {
                    operationId: 'createFolder',
                    summary: 'Create a folder',
                    parameters: [spaceQuery],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: ['string', 'null'] } } } } } },
                    responses: { 201: json({ type: 'object' }, 'Created'), ...writeErrors },
                },
            },
        },
    };
}
